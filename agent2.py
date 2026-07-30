import os
from dotenv import load_dotenv

from livekit import agents
from livekit.agents import JobContext, WorkerOptions
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import noise_cancellation, ollama, silero, deepgram
from prompts import AGENT_INSTRUCTION

# Import your custom async tools
from tools import get_weather, search_web, send_email

load_dotenv()

async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    # 1. Initialize the Local Ollama LLM Component
    # This automatically connects to your local instance at http://localhost:11434
    ollama_llm = ollama.LLM(
        model="llama3", # Change this to the exact local model you want to target
    )
    
    # 2. Build the Voice Pipeline Agent
    agent = VoicePipelineAgent(
        # Voice Activity Detection (Filters out background silence)
        vad=silero.VAD.load(),
        
        # Speech-to-Text (Converts your spoken voice into text tokens for Ollama)
        # Deepgram is standard, or you can switch to local plugins like openai.Whisper
        stt=deepgram.STT(),
        
        # Core Intelligence Engine
        llm=ollama_llm,
        
        # Text-to-Speech (Converts Ollama's text stream back into spoken audio)
        # Deepgram or Cartesia work well here for low-latency voice delivery
        tts=deepgram.TTS(),
        
        # System instructions
        chat_ctx=ollama_llm.create_context(system_instruction=AGENT_INSTRUCTION),
        
        # Register your async functional tools
        fnc_ctx=agents.llm.FunctionContext(),
    )
    
    # Register your tools to the agent context so Ollama can trigger them
    agent.fnc_ctx.register_fnc(get_weather)
    agent.fnc_ctx.register_fnc(search_web)
    agent.fnc_ctx.register_fnc(send_email)

    # 3. Boot up the agent session inside the LiveKit Room
    # Using audio-only options since Ollama processed pipelines are built for voice interactions
    await agent.start(ctx.room)
    
    # Optional: Force the agent to speak an opening line immediately when connecting
    await agent.say("Hi, my name is Friday, your personal assistant. How may I help you?", allow_interruptions=True)

if __name__ == "__main__":
    agents.cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
