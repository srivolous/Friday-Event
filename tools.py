# tools.py
import os
import json
import logging
from pathlib import Path
import requests
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import time
from typing import Optional
from ddgs import DDGS
from ddgs.exceptions import DDGSException, RatelimitException, TimeoutException
import ollama
from livekit.agents import function_tool

# Lazy import google.genai to avoid native DLL crash on Python 3.13
_genai = None
def _ensure_genai():
    global _genai
    if _genai is None:
        from google import genai as _g
        _genai = _g

# Resolve relative to this file's location, NOT the process's current working
# directory (which can differ depending on how/where the agent is launched).
FOLDER_PATH = str(Path(__file__).resolve().parent / "lectures")
GEMINI_EMBED_MODEL = "text-embedding-004"
OLLAMA_EMBED_MODEL = "mxbai-embed-large"
CACHE_FILE = Path(".embeddings_cache.json")
TOP_K = 3
SIMILARITY_THRESHOLD = 0.35

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

_gemini_client = None
RAG_DATABASE = []

def get_gemini_client():
    """Lazily construct the Gemini client, checking for active API key variables."""
    global _gemini_client
    if _gemini_client is None:
        key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("No GOOGLE_API_KEY or GEMINI_API_KEY found in environment variables.")
        _ensure_genai()
        _gemini_client = _genai.Client(api_key=key)
    return _gemini_client

# Which LLM generates the final answer from retrieved RAG context.
# "online"  -> Gemini API (used by the LiveKit online agent)
# "offline" -> local Ollama model (used by run_offline_loop, no network calls)
RAG_LLM_BACKEND = "online"
OFFLINE_LLM_MODEL = "llama3.1:latest"

def configure_rag_backend(mode: str, offline_model: Optional[str] = None):
    """Call this once at startup to point RAG answer generation at the right backend."""
    global RAG_LLM_BACKEND, OFFLINE_LLM_MODEL
    if mode not in ("online", "offline"):
        raise ValueError("mode must be 'online' or 'offline'")
    RAG_LLM_BACKEND = mode
    if offline_model:
        OFFLINE_LLM_MODEL = offline_model
    logging.info(f"RAG generation backend set to '{RAG_LLM_BACKEND}'"
                 + (f" (model: {OFFLINE_LLM_MODEL})" if mode == "offline" else " (Gemini)"))

def _get_active_embed_model():
    """Return the name of the embedding model currently in use."""
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    return GEMINI_EMBED_MODEL if key else OLLAMA_EMBED_MODEL

def get_ollama_client():
    """Construct an Ollama client, checking for custom endpoint configurations."""
    url = os.getenv("OLLAMA_URL", "").strip()
    if url:
        return ollama.Client(host=url)
    return ollama.Client()

def get_local_embedding(text):
    """Generate an embedding vector for text. Gemini preferred, Ollama fallback."""
    gemini_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if gemini_key:
        try:
            client = get_gemini_client()
            result = client.models.embed_content(
                model=GEMINI_EMBED_MODEL,
                contents=text
            )
            return result.embeddings[0].values
        except Exception as e:
            logging.warning(f"Gemini embedding failed ({e}), falling back to Ollama.")
    client = get_ollama_client()
    response = client.embed(model=OLLAMA_EMBED_MODEL, input=text)
    return response["embeddings"][0]

def cosine_similarity(a, b):
    return sum(x * y for x, y in zip(a, b)) / ((sum(x**2 for x in a)**0.5) * (sum(y**2 for y in b)**0.5))

def load_cache():
    if CACHE_FILE.exists():
        try:
            raw = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            # Invalidate cache if embedding model changed
            cached_model = raw.get("_embed_model")
            active_model = _get_active_embed_model()
            if cached_model and cached_model != active_model:
                logging.info(f"Embedding model changed ({cached_model} -> {active_model}), invalidating cache.")
                return {}
            return raw
        except Exception:
            return {}
    # Legacy cache migration: if old cache exists, start fresh
    old_cache = Path(".embeddings_cache_mxbai.json")
    if old_cache.exists():
        logging.info("Old Ollama embeddings cache found; ignoring (model mismatch).")
    return {}

def save_cache(cache):
    cache["_embed_model"] = _get_active_embed_model()
    CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")

def extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        logging.error("pypdf is not installed; skipping PDF file %s. Run: pip install pypdf", path.name)
        return ""
    try:
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        logging.error(f"Failed to extract text from PDF {path.name}: {e}")
        return ""

def extract_docx_text(path: Path) -> str:
    try:
        import docx
    except ImportError:
        logging.error("python-docx is not installed; skipping DOCX file %s. Run: pip install python-docx", path.name)
        return ""
    try:
        document = docx.Document(str(path))
        return "\n".join(p.text for p in document.paragraphs)
    except Exception as e:
        logging.error(f"Failed to extract text from DOCX {path.name}: {e}")
        return ""

def chunk_text(text, chunk_size=1000, overlap=200):
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    return chunks

def load_docs(folder):
    cache = load_cache()
    db = []
    target_folder = Path(folder).resolve()
    
    if not target_folder.exists():
        logging.warning(f"RAG target folder {target_folder} does not exist. Creating it.")
        target_folder.mkdir(parents=True, exist_ok=True)
        return db
        
    SUPPORTED_SUFFIXES = {".txt", ".md", ".py", ".pdf", ".docx"}
    files = list(target_folder.glob("**/*"))
    for p in files:
        if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES:
            try:
                path_str = str(p.resolve())
                mtime = str(p.stat().st_mtime)

                if p.suffix.lower() == ".pdf":
                    text = extract_pdf_text(p)
                elif p.suffix.lower() == ".docx":
                    text = extract_docx_text(p)
                else:
                    text = p.read_text(encoding="utf-8", errors="ignore")

                if not text.strip():
                    logging.warning(f"No extractable text found in {p.name}; skipping.")
                    continue
                
                if path_str in cache and cache[path_str]["mtime"] == mtime:
                    file_chunks = cache[path_str]["chunks"]
                else:
                    raw_chunks = chunk_text(text)
                    file_chunks = []
                    for chunk in raw_chunks:
                        embedding = get_local_embedding(chunk)
                        file_chunks.append({"text": chunk, "embedding": embedding})
                    cache[path_str] = {"mtime": mtime, "chunks": file_chunks}
                
                for chunk_data in file_chunks:
                    db.append({
                        "path": path_str,
                        "text": chunk_data["text"],
                        "embedding": chunk_data["embedding"]
                    })
            except Exception as e:
                logging.error(f"Error indexing document {p.name}: {e}")
                
    save_cache(cache)
    return db

def initialize_rag_database():
    """Deferred initialization routine executed inside the runner task context."""
    global RAG_DATABASE
    if not RAG_DATABASE:
        print("Loading RAG database index partitions into memory...")
        RAG_DATABASE = load_docs(FOLDER_PATH)
        print(f"RAG operational. Indexed {len(RAG_DATABASE)} contextual fragments.")

# --- LIVEKIT FUNCTION TOOLS ---

@function_tool()
async def query_knowledge_base(query: str) -> str:
    """
    Search your private local knowledge base documents and lecture files for technical answers.
    Use this tool whenever the user asks questions about class files, technical notes, or reference logs.
    
    Args:
        query: The explicit technical question or topic to search inside the documents.
    """
    if not RAG_DATABASE:
        return "The local knowledge base archive directories are empty, sir."
        
    try:
        q_emb = get_local_embedding(query)
        scored_chunks = []
        
        for item in RAG_DATABASE:
            score = cosine_similarity(q_emb, item["embedding"])
            if score >= SIMILARITY_THRESHOLD:
                scored_chunks.append((score, item))
        
        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        top_matches = [item for score, item in scored_chunks[:TOP_K]]
        
        if not top_matches:
            return "Based on a scan of the system registers, no relevant information was found in your documents, sir."
            
        combined_context = "\n\n---\n\n".join([f"Source ({Path(m['path']).name}):\n{m['text']}" for m in top_matches])
        
        prompt = f"Context:\n{combined_context}\n\nQuestion: {query}\nAnswer strictly and exclusively using only the provided context. Keep your response down to one short sentence."

        if RAG_LLM_BACKEND == "online":
            try:
                _ensure_genai()
                response = get_gemini_client().models.generate_content(
                    model="gemini-3.5-flash",
                    contents=prompt,
                    config=_genai.types.GenerateContentConfig(temperature=0.0)
                )
                return response.text
            except Exception as e:
                logging.warning(f"Gemini RAG generation failed ({e}), trying Ollama fallback.")
                try:
                    response = ollama.chat(
                        model=OFFLINE_LLM_MODEL,
                        messages=[{"role": "user", "content": prompt}],
                        options={"temperature": 0.0}
                    )
                    return response["message"]["content"]
                except Exception:
                    pass
            return "An error occurred while generating a response from the knowledge base."

        response = ollama.chat(
            model=OFFLINE_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.0}
        )
        return response["message"]["content"]
        
    except Exception as e:
        logging.error(f"RAG generation failure (backend={RAG_LLM_BACKEND}): {e}")
        if RAG_LLM_BACKEND == "offline":
            return "An internal error occurred while generating a response from the local model."
        return "An internal timeout error occurred while routing data through the Gemini API archives."

@function_tool()
async def get_weather(city: str) -> str:
    try:
        response = requests.get(f"https://wttr.in/{city}?format=3")
        if response.status_code == 200:
            return response.text.strip()
        return f"Could not retrieve weather for {city}."
    except Exception as e:
        logging.error(f"Error retrieving weather: {e}")
        return "An error occurred while retrieving weather grids."

@function_tool()
async def search_web(query: str) -> str:
    """
    Search the live web for current information (news, facts, anything outside
    the local knowledge base). Retries once on rate limiting before giving up.
    """
    last_error = None
    for attempt in range(2):
        try:
            with DDGS() as ddgs:
                results = ddgs.text(query, max_results=5)
            if not results:
                return "No good search results were found, sir."
            snippets = [f"{r.get('title', '')}: {r.get('body', '')}" for r in results]
            return "\n".join(snippets)
        except RatelimitException as e:
            last_error = e
            logging.warning(f"DuckDuckGo rate limit hit (attempt {attempt + 1}), retrying...")
            time.sleep(2)
        except TimeoutException as e:
            last_error = e
            logging.error(f"DuckDuckGo search timed out: {e}")
            break
        except DDGSException as e:
            last_error = e
            logging.error(f"DuckDuckGo search error: {e}")
            break
        except Exception as e:
            last_error = e
            logging.error(f"Error searching the web: {e}")
            break

    return f"An error occurred while scanning external data archives ({last_error})."

@function_tool()
def send_email(to_email: str, subject: str, message: str, cc_email: Optional[str] = None) -> str:
    try:
        smtp_server = "smtp.gmail.com"
        smtp_port = 587
        gmail_user = os.getenv("GMAIL_USER")
        gmail_password = os.getenv("GMAIL_APP_PASSWORD")
        
        if not gmail_user or not gmail_password:
            return "Email sending failed: Credentials missing from environment configuration."
        
        msg = MIMEMultipart()
        msg['From'] = gmail_user
        msg['To'] = to_email
        msg['Subject'] = subject
        
        recipients = [to_email]
        if cc_email:
            msg['Cc'] = cc_email
            recipients.append(cc_email)
        
        msg.attach(MIMEText(message, 'plain'))
        
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(gmail_user, gmail_password)
        server.sendmail(gmail_user, recipients, msg.as_string())
        server.quit()
        
        return f"Email transmitted successfully to {to_email}."
    except Exception as e:
        logging.error(f"Error sending email: {e}")
        return f"Email pipeline transmission error: {str(e)}"
