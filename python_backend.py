import os
import sys
import json
import logging
import inspect
import asyncio
import tempfile
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# Ensure repository root is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, ".env"))

import numpy as np
import sounddevice as sd
from scipy.io.wavfile import write
from faster_whisper import WhisperModel
from kokoro import KPipeline
import ollama

from prompts import AGENT_INSTRUCTION, SESSION_INSTRUCTION
import tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s - [FridayBackend] - %(levelname)s - %(message)s")

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:latest")

# --- SPEECH SYSTEMS INITIALIZATION (PRE-WARMED IN RAM FOR ZERO DELAY) ---
logging.info("Pre-warming Faster-Whisper STT model...")
WHISPER_MODEL_SIZE = "base.en"
whisper_client = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
logging.info("Faster-Whisper STT ready.")

logging.info("Pre-warming Kokoro TTS engine...")
KOKORO_SAMPLE_RATE = 24000
KOKORO_VOICE = "af_bella"
kokoro_pipeline = KPipeline(lang_code="a")
logging.info("Kokoro TTS ready.")

def clean_friday_response(text: str) -> str:
    if not text:
        return ""
    import re
    # Strip any parenthetical notes like (Note: ...), (note: ...), (Since ...), (Because ...)
    text = re.sub(r'\(?\s*[Nn]ote\s*:.*?\)?', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\(\s*(Since|Because|As|No tool|Tool|Input|Question)\s+.*?\)', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'No (function|tool) call.*', '', text, flags=re.IGNORECASE | re.DOTALL)
    
    # Join non-empty lines with a space so multi-line replies keep the actual data
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    text = " ".join(lines)
    
    text = text.strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    return text

OFFLINE_TOOL_GUARDRAIL = (
    "\n\nSTRICT INSTRUCTION REGARDING TOOLS & RESPONSE FORMAT:\n"
    "1. You have tools available, but ONLY call a tool if explicitly required.\n"
    "2. NEVER include any notes, explanations, parenthetical comments, or meta-commentary about tool usage.\n"
    "3. DO NOT explain why tools were or were not called.\n"
    "4. Respond strictly in character as Friday in ONE short spoken sentence."
)

# Initialize RAG Database on startup
try:
    tools.configure_rag_backend("offline", offline_model=OLLAMA_MODEL)
    tools.initialize_rag_database()
except Exception as e:
    logging.error(f"Error initializing RAG database: {e}")

# ——— PLAIN TOOL WRAPPERS (no LiveKit @function_tool wrapping) ———
# Calling tools.get_weather directly would invoke LiveKit's function_tool
# machinery which spawns semaphore-backed subprocesses and crashes the HTTP server.
# These wrappers call the underlying logic directly via requests/smtplib.

import requests as _requests
import smtplib as _smtplib
from email.mime.multipart import MIMEMultipart as _MIMEMultipart
from email.mime.text import MIMEText as _MIMEText

async def _tool_get_weather(city: str, **kwargs) -> str:
    try:
        r = _requests.get(f"https://wttr.in/{city}?format=3", timeout=8)
        if r.status_code == 200:
            return r.text.strip()
        return f"Could not retrieve weather for {city}."
    except Exception as e:
        return f"Weather lookup error: {e}"

async def _tool_search_web(query: str, **kwargs) -> str:
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = ddgs.text(query, max_results=5)
        if not results:
            return "No good search results were found, sir."
        snippets = [f"{r.get('title', '')}: {r.get('body', '')}" for r in results]
        return "\n".join(snippets)
    except Exception as e:
        return f"Web search error: {e}"

async def _tool_query_knowledge_base(query: str, **kwargs) -> str:
    try:
        result = tools.query_knowledge_base(query)
        if inspect.isawaitable(result):
            result = await result
        return str(result)
    except Exception as e:
        return f"Knowledge base error: {e}"

async def _tool_send_email(to_email: str, subject: str, message: str, cc_email: str = None, **kwargs) -> str:
    try:
        smtp_server = "smtp.gmail.com"
        smtp_port = 587
        gmail_user = os.getenv("GMAIL_USER")
        gmail_password = os.getenv("GMAIL_APP_PASSWORD")
        if not gmail_user or not gmail_password:
            return "Email sending failed: Credentials missing from environment configuration."
        msg = _MIMEMultipart()
        msg['From'] = gmail_user
        msg['To'] = to_email
        msg['Subject'] = subject
        recipients = [to_email]
        if cc_email:
            msg['Cc'] = cc_email
            recipients.append(cc_email)
        msg.attach(_MIMEText(message, 'plain'))
        server = _smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(gmail_user, gmail_password)
        server.sendmail(gmail_user, recipients, msg.as_string())
        server.quit()
        return f"Email transmitted successfully to {to_email}."
    except Exception as e:
        return f"Email pipeline transmission error: {str(e)}"

import subprocess as _subprocess
import webbrowser as _webbrowser
import sys as _sys

async def _tool_open_url(url: str, **kwargs) -> str:
    """Open a URL in the default web browser (cross-platform)."""
    try:
        # Ensure URL has a scheme
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        _webbrowser.open(url)
        return f"Opened {url} in the default browser."
    except Exception as e:
        return f"Failed to open URL: {e}"

async def _tool_open_app(app_name: str, **kwargs) -> str:
    """Launch an application by name (cross-platform: macOS, Windows, Linux)."""
    try:
        platform = _sys.platform
        if platform == "darwin":  # macOS
            _subprocess.Popen(["open", "-a", app_name])
        elif platform == "win32":  # Windows
            # 'start' is a shell built-in on Windows
            _subprocess.Popen(["cmd", "/c", "start", "", app_name], shell=False)
        else:  # Linux / other Unix
            # Try xdg-open first, then fall back to launching by name
            try:
                _subprocess.Popen(["xdg-open", app_name])
            except FileNotFoundError:
                _subprocess.Popen([app_name])
        return f"Launched {app_name}."
    except Exception as e:
        # Last resort: try subprocess directly by name
        try:
            _subprocess.Popen([app_name])
            return f"Launched {app_name}."
        except Exception as e2:
            return f"Could not launch {app_name}: {e2}"

AVAILABLE_PYTHON_TOOLS = {
    "query_knowledge_base": _tool_query_knowledge_base,
    "get_weather": _tool_get_weather,
    "search_web": _tool_search_web,
    "send_email": _tool_send_email,
    "open_url": _tool_open_url,
    "open_app": _tool_open_app,
}

TOOL_DESCRIPTIONS = """- query_knowledge_base({"query": "string"}) — Search local lecture notes and document archives for technical answers.
- get_weather({"city": "string"}) — Get current weather for a city.
- search_web({"query": "string"}) — Search live web results.
- send_email({"to_email": "string", "subject": "string", "message": "string", "cc_email": "string, optional"}) — Send email via SMTP.
- open_app({"app_name": "string"}) — Launch an application by name (e.g. Spotify, Chrome, VSCode, Terminal).
- open_url({"url": "string"}) — Open a URL in the default browser."""

async def execute_tool(name: str, args: dict):
    if name in AVAILABLE_PYTHON_TOOLS:
        fn = AVAILABLE_PYTHON_TOOLS[name]
        res = fn(**args)
        if inspect.isawaitable(res):
            res = await res
        return res
    return f"Unknown or external system tool: {name}"

is_speaking = False

def speak_text_kokoro(text: str):
    global is_speaking
    clean_text = clean_friday_response(text)
    if not clean_text:
        return
    is_speaking = True
    try:
        audio_chunks = []
        generator = kokoro_pipeline(clean_text, voice=KOKORO_VOICE, speed=1.0)
        for _, _, audio in generator:
            audio_chunks.append(np.asarray(audio))
        if audio_chunks:
            full_audio = np.concatenate(audio_chunks)
            sd.play(full_audio, samplerate=KOKORO_SAMPLE_RATE)
            sd.wait()
    except Exception as e:
        logging.error(f"Kokoro TTS playback error: {e}")
    finally:
        is_speaking = False

def should_pass_tools(user_text: str) -> bool:
    if not user_text:
        return False
    text = user_text.lower().strip()
    
    # Common small talk, greetings, confirmations never need tools
    greetings = [
        "salam", "hello", "hi", "hey", "good morning", "good evening", "good afternoon",
        "how are you", "what is up", "whats up", "thanks", "thank you", "das fine",
        "that's fine", "ok", "okay", "cool", "nice", "yes", "no", "who are you",
        "what is your name", "tell me a joke"
    ]
    is_greeting = text in greetings or any(text.startswith(g) for g in ["salam", "hello", "hi", "hey", "das fine", "thanks"])
    
    tool_keywords = [
        "lecture", "note", "class", "document", "pdf", "file", "course", "syllabus", "m1s1", "assignment", "homework",
        "weather", "temperature", "forecast", "rain", "sunny",
        "search", "lookup", "find out", "google", "ddg", "who is", "what is the news", "latest news",
        "email", "send email", "mail", "gmail", "send an email",
        "open", "launch", "start", "run",
        "volume", "set volume", "mute", "unmute",
        "http://", "https://", "www.", ".com", ".org"
    ]
    has_tool_keyword = any(kw in text for kw in tool_keywords)
    
    if is_greeting and not has_tool_keyword:
        return False
    return has_tool_keyword

async def process_chat(history: list):
    system_content = AGENT_INSTRUCTION + OFFLINE_TOOL_GUARDRAIL
    formatted_messages = [{"role": "system", "content": system_content}]
    
    last_user_msg = ""
    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "")
        if role in ["user", "assistant", "system"] and content:
            formatted_messages.append({"role": role, "content": content})
            if role == "user":
                last_user_msg = content

    use_tools = should_pass_tools(last_user_msg)

    # Ollama tool schemas defined inline (avoids LiveKit @function_tool decorator issues)
    OLLAMA_TOOL_SCHEMAS = [
        {"type": "function", "function": {"name": "get_weather", "description": "Get the current weather for a city.", "parameters": {"type": "object", "properties": {"city": {"type": "string", "description": "City name"}}, "required": ["city"]}}},
        {"type": "function", "function": {"name": "search_web", "description": "Search the live web for current information.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}}, "required": ["query"]}}},
        {"type": "function", "function": {"name": "query_knowledge_base", "description": "Search local lecture notes and documents.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}}, "required": ["query"]}}},
        {"type": "function", "function": {"name": "send_email", "description": "Send an email.", "parameters": {"type": "object", "properties": {"to_email": {"type": "string"}, "subject": {"type": "string"}, "message": {"type": "string"}, "cc_email": {"type": "string"}}, "required": ["to_email", "subject", "message"]}}},
        {"type": "function", "function": {"name": "open_url", "description": "Open a URL in the default web browser.", "parameters": {"type": "object", "properties": {"url": {"type": "string", "description": "Full URL including https://"}}, "required": ["url"]}}},
        {"type": "function", "function": {"name": "open_app", "description": "Launch a macOS application by name (e.g. Safari, Spotify, VSCode, Chrome, Terminal).", "parameters": {"type": "object", "properties": {"app_name": {"type": "string", "description": "Application name as it appears in /Applications"}}, "required": ["app_name"]}}},
    ]

    ollama_tools = OLLAMA_TOOL_SCHEMAS if use_tools else None

    executed_tools = []
    
    try:
        logging.info(f"Sending chat request to Ollama (use_tools={use_tools})...")
        chat_kwargs = {
            "model": OLLAMA_MODEL,
            "messages": formatted_messages,
            "options": {"temperature": 0.4, "num_predict": 48, "top_p": 0.9},
            "keep_alive": "60m"
        }
        if use_tools:
            chat_kwargs["tools"] = ollama_tools

        response = ollama.chat(**chat_kwargs)
        
        message = response.get("message", {})
        
        # Extract inline JSON tool calls if Ollama outputted tool calls in the content text (Llama 3 fallback)
        content_text = message.get("content", "")
        if not message.get("tool_calls") and "{" in content_text and "}" in content_text:
            import re
            json_match = re.search(r'(\{\s*"name"\s*:\s*"[^"]+".*?\})', content_text, re.DOTALL)
            if json_match:
                try:
                    parsed_tc = json.loads(json_match.group(1))
                    t_name = parsed_tc.get("name")
                    t_params = parsed_tc.get("parameters", {})
                    if t_name in AVAILABLE_PYTHON_TOOLS:
                        message["tool_calls"] = [{"function": {"name": t_name, "arguments": t_params}}]
                        logging.info(f"Extracted inline JSON tool call: {t_name}({t_params})")
                except Exception as e:
                    logging.warning(f"Failed to parse inline JSON tool call: {e}")

        if message.get("tool_calls"):
            for tool_call in message["tool_calls"]:
                function_name = tool_call["function"]["name"]
                arguments = tool_call["function"]["arguments"]
                logging.info(f"Executing tool call: {function_name}({arguments})")
                executed_tools.append({"tool": function_name, "args": arguments})
                
                tool_result = await execute_tool(function_name, arguments)
                logging.info(f"Tool result: {tool_result}")
                
                # Build the follow-up conversation with the tool result as a user message
                # so the model is forced to actually answer the question.
                formatted_messages.append(message)
                formatted_messages.append({
                    "role": "tool",
                    "content": str(tool_result),
                    "name": function_name
                })
                # Inject a user follow-up that forces the model to state the data
                formatted_messages.append({
                    "role": "user",
                    "content": f"The tool returned this data: {tool_result}. Now tell me this exact information concisely. Do NOT say 'Will do' or 'I have retrieved'. Just state the actual result."
                })
                
                final_res = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=formatted_messages,
                    options={"temperature": 0.2, "num_predict": 128, "top_p": 0.9},
                    keep_alive="60m"
                )
                raw_final = final_res.get("message", {}).get("content", "").strip()
                logging.info(f"Post-tool model response: {raw_final}")
                
                # Safety net: if model still gives a generic dodge, build the reply directly
                dodge_phrases = ["will do", "i have retrieved", "i have obtained", "i have accessed", "i've retrieved", "i'll look into"]
                if not raw_final or any(p in raw_final.lower() for p in dodge_phrases):
                    logging.warning("Model dodged tool result, using direct tool_result as reply")
                    raw_final = str(tool_result)

                final_text = clean_friday_response(raw_final)
                return {
                    "content": final_text,
                    "tool_calls": executed_tools,
                    "tool_result": str(tool_result)
                }

        content = clean_friday_response(message.get("content", ""))
        return {
            "content": content,
            "tool_calls": [],
            "tool_result": None
        }
    except Exception as e:
        logging.error(f"Chat execution error: {e}")
        return {
            "content": f"My apologies, Sir. An error occurred in my core backend: {str(e)}",
            "error": str(e),
            "tool_calls": []
        }

class FridayHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        parsed_path = urlparse(self.path).path
        if parsed_path == "/health":
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "status": "ok",
                "agent": "Friday",
                "model": OLLAMA_MODEL,
                "stt": "faster-whisper",
                "tts": "kokoro"
            }).encode("utf-8"))
        elif parsed_path == "/tools":
            self._set_headers(200)
            self.wfile.write(json.dumps({
                "tools": list(AVAILABLE_PYTHON_TOOLS.keys()),
                "descriptions": TOOL_DESCRIPTIONS
            }).encode("utf-8"))
        elif parsed_path == "/speaking_status":
            self._set_headers(200)
            self.wfile.write(json.dumps({"is_speaking": is_speaking}).encode("utf-8"))
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def do_POST(self):
        parsed_path = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        if parsed_path == "/transcribe":
            if not post_data:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "No audio data received"}).encode("utf-8"))
                return
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(post_data)
                tmp_path = tmp.name

            try:
                logging.info(f"Transcribing audio with Faster-Whisper ({len(post_data)} bytes)...")
                segments, _ = whisper_client.transcribe(tmp_path, beam_size=1)
                text = " ".join([seg.text for seg in segments]).strip()
                logging.info(f"Transcribed text: '{text}'")
                self._set_headers(200)
                self.wfile.write(json.dumps({"text": text}).encode("utf-8"))
            except Exception as e:
                logging.error(f"Transcription error: {e}")
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e), "text": ""}).encode("utf-8"))
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        elif parsed_path == "/tts":
            try:
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}
            except Exception:
                payload = {}
            text = payload.get("text", "")
            if text:
                logging.info(f"Synthesizing Kokoro TTS for text: '{text[:40]}...'")
                global is_speaking
                is_speaking = True
                threading.Thread(target=speak_text_kokoro, args=(text,), daemon=True).start()
                self._set_headers(200)
                self.wfile.write(json.dumps({"status": "speaking", "engine": "kokoro"}).encode("utf-8"))
            else:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Empty text"}).encode("utf-8"))

        elif parsed_path == "/chat":
            try:
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}
            except Exception:
                payload = {}
            history = payload.get("messages", [])
            if not history and "prompt" in payload:
                history = [{"role": "user", "content": payload["prompt"]}]
            
            result = asyncio.run(process_chat(history))
            self._set_headers(200)
            self.wfile.write(json.dumps(result).encode("utf-8"))
        
        elif parsed_path == "/tools/call":
            try:
                payload = json.loads(post_data.decode("utf-8")) if post_data else {}
            except Exception:
                payload = {}
            tool_name = payload.get("name")
            tool_args = payload.get("args", {})
            result = asyncio.run(execute_tool(tool_name, tool_args))
            self._set_headers(200)
            self.wfile.write(json.dumps({"ok": True, "result": result}).encode("utf-8"))
            
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))

    def log_message(self, format, *args):
        return

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True

def run_server(port=5001):
    server_address = ("127.0.0.1", port)
    httpd = ReusableHTTPServer(server_address, FridayHandler)
    logging.info(f"Friday Agent Python Backend running on http://127.0.0.1:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logging.info("Shutting down Friday Agent Backend.")
        httpd.server_close()

if __name__ == "__main__":
    port = 5001
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_server(port)

