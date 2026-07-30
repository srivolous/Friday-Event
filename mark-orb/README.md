# MARK

A local, voice-first desktop assistant. No cloud LLM — the brain is **Ollama running Llama 3**
on your own machine. Electron app, holographic orb UI.

Built by combining three open repos (see **Attribution** below) rather than starting from
scratch — each piece is noted in the source files that reuse it.

## What's actually running

| Layer | What it is | Where it came from |
|---|---|---|
| Orb UI | Three.js wireframe orb, bloom/chromatic-aberration post-processing, mouse + hand-gesture control | Ported verbatim from `ultron-by-sagar-builds` (`lib/orbScene.ts`, `lib/handTracker.ts`), with one addition: a `setEnergy()` hook so the core visibly pulses while MARK is listening/speaking |
| HUD styling | Amber holographic HUD, scanlines, vignette, grain | `ultron-by-sagar-builds/app/globals.css`, extended with a transcript panel + mic control |
| Brain | Local Llama 3 via Ollama's `/api/chat`, with a hand-rolled JSON tool-calling convention (Ollama's base `llama3` has no native function-calling API the way Gemini does) | New — replaces the Gemini Live/Realtime model both `friday_jarvis` and `Mark-L` are built around |
| Tool routing / persona tone | "Efficient, direct, address the user as sir" system prompt | Adapted from `Mark-L/core/prompt.txt` |
| `open_app` tool | App-name alias table + per-OS launch strategy | Ported from `Mark-L/actions/open_app.py` (Python subprocess → Node child_process) |
| `set_volume` tool | Cross-platform volume control | Same intent as `Mark-L/actions/computer_settings.py` (which used pycaw/osascript/pactl directly); implemented here via the `loudness` npm package for less OS-specific code |
| `get_weather` tool | Free, key-less weather lookup | Same wttr.in endpoint `friday_jarvis/tools.py` used, switched to its structured JSON output |
| `search_web` tool | DuckDuckGo HTML scrape | Same source both `Mark-L`'s DDG fallback and `friday_jarvis`'s `DuckDuckGoSearchRun` ultimately hit |
| Speech-to-text | Whisper (`Xenova/whisper-base`) running fully offline in the renderer via `@xenova/transformers` (WASM) | New — `friday_jarvis`/`Mark-L` got STT "for free" from Gemini's realtime audio model, which Ollama has no equivalent of |
| Text-to-speech | Web Speech API (`speechSynthesis`), using your OS's installed voices, fully offline | New, same reason as above |

## Prerequisites

1. **[Ollama](https://ollama.com)** installed and running, with Llama 3 pulled:
   ```
   ollama pull llama3
   ollama serve      # if it isn't already running as a background service
   ```
2. **Node.js 18+**
3. A microphone (for voice) and, optionally, a webcam (for hand-gesture orb control).

## Run it

```
npm install
npm run dev
```

This opens the Electron app with hot reload. First launch will download the Whisper model
(~150MB) from Hugging Face's CDN and cache it — after that, STT works fully offline.

## Package a distributable build

```
npm run dist
```

Uses `electron-builder` to produce an installer/app for your current OS in `dist/`.

## Using it

- **Hold Space** (or the mic button) to talk, release to send.
- Or type into the text box and hit Enter.
- **Drag** to spin the orb, **scroll** to zoom, **R** to reset the view.
- **G** or the "GESTURES OFF" button turns on webcam hand tracking: pinch one hand and move
  it to spin, pinch both hands and spread/pinch apart to zoom.

## Tools MARK can currently call

- `get_weather(city)`
- `search_web(query, max_results?)`
- `open_app(app_name)`
- `set_volume(level)`
- `open_url(url)`

Add more by dropping a new file in `src/main/tools/`, registering it in
`src/main/tools/index.js`, and it will automatically show up in the system prompt the next
time the app starts — no changes needed in the renderer.

## Known limitations / things to check on your machine

- **Windows volume control** relies on the `loudness` npm package, which uses a prebuilt
  native binary. If `npm install` couldn't fetch it (e.g. no internet at install time), the
  `set_volume` tool will fail with a clear error rather than silently doing nothing.
- **Linux TTS** depends on `speech-dispatcher`/`espeak` being installed system-wide for
  `speechSynthesis` to have any voices to use. If MARK stops talking but text still shows up
  in the transcript, this is almost certainly why.
- **Ollama's plain `llama3`** doesn't reliably support native tool-calling, so tool use here
  is driven by asking the model to emit a JSON line and parsing it ourselves. It's not as
  robust as a model with real function-calling (e.g. `llama3.1`/`llama3.2` in newer Ollama
  versions) — if you hit flaky tool calls, try swapping the model string in
  `src/renderer/src/llm/ollamaClient.js`.
- The `open_app` alias table covers common apps; anything not listed falls back to trying
  the raw name you gave it via PATH lookup / `open -a` / `xdg-open`.

## Attribution

- **Orb UI**: [`ultron-by-sagar-builds`](https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds)
  by Sagar Tamang — MIT licensed. Full original license kept at `LICENSE-ultron-orb.txt`.
- **Tool/persona patterns**: [`Mark-L`](https://github.com/FatihMakes/Mark-L) by FatihMakes —
  **CC BY-NC 4.0 (non-commercial)**. This project inherits that restriction: personal,
  non-commercial use only, per your stated use case. Do not distribute or sell a build of
  this project without addressing that license first.
- **Weather/search tool shape**: [`friday_jarvis`](https://github.com/ruxakK/friday_jarvis)
  by ruxakK.

This project itself (the Electron scaffold, IPC wiring, Ollama integration, STT/TTS layer,
and ported/adapted tool code) is MIT-licensed — see `LICENSE`. The CC BY-NC 4.0 obligation
above only follows the parts adapted from `Mark-L`.
