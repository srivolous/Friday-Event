import sys
from dotenv import load_dotenv
load_dotenv()

EXECUTION_MODE = "online"
if "--mode" in sys.argv:
    try:
        mode_idx = sys.argv.index("--mode") + 1
        parsed_mode = sys.argv[mode_idx].lower()
        if parsed_mode in ["online", "offline"]:
            EXECUTION_MODE = parsed_mode
            sys.argv.pop(mode_idx)
            sys.argv.pop(mode_idx - 1)
    except IndexError:
        pass

print(f"Booting Jarvis in system configuration mode: {EXECUTION_MODE.upper()}")

# --- OFFLINE EXECUTION ROUTINE (RAW LOCAL LOOP WITH NATIVE TOOL CALLING) ---
def run_offline_loop():
    import os
    import queue
    import time
    import threading
    import numpy as np
    import sounddevice as sd
    from scipy.io.wavfile import write
    from faster_whisper import WhisperModel
    import ollama
    from prompts import AGENT_INSTRUCTION, SESSION_INSTRUCTION
    import tools

    WHISPER_MODEL_SIZE = "base.en"
    OLLAMA_MODEL = "llama3.1:latest"
    SAMPLE_RATE = 16000
    SILENCE_THRESHOLD = 0.02
    SILENCE_DURATION = 1.6

    from kokoro import KPipeline

    print("loading speech systems")
    KOKORO_SAMPLE_RATE = 24000
    KOKORO_VOICE = "af_bella"
    kokoro_pipeline = KPipeline(lang_code="a")
    print("Kokoro TTS ready.")

    print("offline db init")
    whisper_client = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    audio_queue = queue.Queue()
    tts_queue = queue.Queue()
    computer_is_speaking = threading.Event()
    
    tools.configure_rag_backend("offline", offline_model=OLLAMA_MODEL)
    tools.initialize_rag_database()

    available_tools = {
        "query_knowledge_base": tools.query_knowledge_base,
        "get_weather": tools.get_weather,
        "search_web": tools.search_web,
        "send_email": tools.send_email
    }

    def tts_worker():
        while True:
            text = tts_queue.get()
            if text is None:
                break
            computer_is_speaking.set()
            try:
                audio_chunks = []
                generator = kokoro_pipeline(text, voice=KOKORO_VOICE)
                for _, _, audio in generator:
                    audio_chunks.append(np.asarray(audio))
                if audio_chunks:
                    full_audio = np.concatenate(audio_chunks)
                    sd.play(full_audio, samplerate=KOKORO_SAMPLE_RATE)
                    sd.wait()
            except Exception as e:
                print(f"Kokoro TTS error: {e}")
            tts_queue.task_done()
            if tts_queue.empty():
                time.sleep(0.3)
                computer_is_speaking.clear()

    threading.Thread(target=tts_worker, daemon=True).start()

    def audio_callback(indata, frames, time_info, status):
        if not computer_is_speaking.is_set():
            audio_queue.put(indata.copy())

    def speak(text: str):
        clean_text = text.replace('"', '').replace("'", "").strip()
        if clean_text:
            computer_is_speaking.set()
            tts_queue.put(clean_text)

    OFFLINE_TOOL_GUARDRAIL = (
        "\n\nT/Users/sreeragmanoj/Desktop/rustedinterfacerOOL USE POLICY: You have tools available, but most messages do NOT need one. "
        "Only call a tool when the user's message explicitly requires it:\n"
        "- query_knowledge_base: ONLY when the user asks something about their lecture notes, "
        "class files, or reference documents.\n"
        "- get_weather: ONLY when the user asks about current weather.\n"
        "- search_web: ONLY when the user asks for current events or facts you would need to look up.\n"
        "- send_email: ONLY when the user explicitly asks you to send an email.\n"
        "For greetings, small talk, opinions, follow-up remarks, complaints, or anything you can "
        "answer directly from the conversation, respond with plain text and do NOT call any tool. "
        "When in doubt, do not call a tool."
    )

    async def handle_offline_tool_calling(user_prompt: str):
        messages = [
            {"role": "system", "content": AGENT_INSTRUCTION + OFFLINE_TOOL_GUARDRAIL},
            {"role": "user", "content": user_prompt}
        ]
        
        ollama_tools = [
            tools.query_knowledge_base,
            tools.get_weather,
            tools.search_web,
            tools.send_email
        ]
        
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=messages,
            tools=ollama_tools
        )
        
        message = response.get('message', {})
        
        if message.get('tool_calls'):
            for tool_call in message['tool_calls']:
                function_name = tool_call['function']['name']
                arguments = tool_call['function']['arguments']
                
                if function_name in available_tools:
                    print(f"\nRunning local offline tool [{function_name}]...")
                    speak("Will do, Sir.")
                    
                    import inspect
                    fn = available_tools[function_name]
                    tool_result = fn(**arguments)
                    if inspect.isawaitable(tool_result):
                        tool_result = await tool_result
                        
                    print(f"Friday: {tool_result}")
                    speak(tool_result)
                    return True
        return False

    print("\n(OFFLINE MODE) (Ctrl+C to power down)")
    speak(SESSION_INSTRUCTION)
    
    import asyncio

    async def main_voice_input_loop():
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, callback=audio_callback):
            while True:
                if computer_is_speaking.is_set():
                    await asyncio.sleep(0.1)
                    continue
                    
                recording = []
                silence_start = None
                is_speaking = False
                
                while not audio_queue.empty():
                    audio_queue.get_nowait()
                    
                print("\nListening...")
                
                while True:
                    if computer_is_speaking.is_set():
                        break
                    try:
                        data = audio_queue.get_nowait()
                        recording.append(data)
                        rms = np.sqrt(np.mean(data**2))
                        
                        if rms > SILENCE_THRESHOLD:
                            is_speaking = True
                            silence_start = None
                        else:
                            if is_speaking:
                                if silence_start is None:
                                    silence_start = time.time()
                                if time.time() - silence_start >= SILENCE_DURATION:
                                    break
                    except queue.Empty:
                        await asyncio.sleep(0.05)
                        continue

                if computer_is_speaking.is_set() or not recording or len(recording) < 10:
                    continue
                    
                print("Processing voice command...")
                audio_np = np.concatenate(recording, axis=0)
                if np.max(np.abs(audio_np)) < 0.001:
                    continue

                temp_filename = "temp_input.wav"
                write(temp_filename, SAMPLE_RATE, audio_np)
                
                try:
                    segments, _ = whisper_client.transcribe(temp_filename, beam_size=1)
                    user_text = " ".join([seg.text for seg in segments]).strip()
                except Exception:
                    user_text = ""
                finally:
                    if os.path.exists(temp_filename):
                        os.remove(temp_filename)
                
                if not user_text or len(user_text) < 2:
                    continue
                    
                print(f"User: {user_text}")
                computer_is_speaking.set()
                
                # Check for native function calls via local model configurations
                was_tool_called = await handle_offline_tool_calling(user_text)
                
                if not was_tool_called:
                    print("Friday: ", end="", flush=True)
                    response_stream = ollama.generate(
                        model=OLLAMA_MODEL,
                        system=AGENT_INSTRUCTION,
                        prompt=user_text,
                        stream=True
                    )
                    
                    sentence_buffer = ""
                    for chunk in response_stream:
                        token = chunk['response']
                        print(token, end="", flush=True)
                        sentence_buffer += token
                        if any(char in token for char in ['.', '!', '?', ',']):
                            speak(sentence_buffer)
                            sentence_buffer = ""
                    if sentence_buffer.strip():
                        speak(sentence_buffer)
                print()

    asyncio.run(main_voice_input_loop())



if EXECUTION_MODE == "online":
    from livekit import agents
    from livekit.agents import AgentSession, Agent, RoomInputOptions
    from livekit.plugins import noise_cancellation, google
    from prompts import AGENT_INSTRUCTION, SESSION_INSTRUCTION
    from tools import get_weather, search_web, send_email, query_knowledge_base

    class Assistant(Agent):
        def __init__(self) -> None:
            super().__init__(
                instructions=AGENT_INSTRUCTION,
                llm=google.beta.realtime.RealtimeModel(
                    voice="Puck",
                    temperature=0.8,
                ),
                tools=[
                    query_knowledge_base,
                    get_weather,
                    search_web,
                    send_email
                ],
            )

    async def entrypoint(ctx: agents.JobContext):
        session = AgentSession()
        await session.start(
            room=ctx.room,
            agent=Assistant(),
            room_input_options=RoomInputOptions(
                video_enabled=True,
                noise_cancellation=noise_cancellation.BVC(),
            ),
        )
        await ctx.connect()
        
        import tools
        tools.configure_rag_backend("online")
        tools.initialize_rag_database()

        await session.generate_reply(instructions=SESSION_INSTRUCTION)

    if __name__ == "__main__":
        agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))

else:
    if __name__ == "__main__":
        try:
            run_offline_loop()
        except KeyboardInterrupt:
            print("\n System powered down.")
