import { createOrbScene } from './orb/orbScene'
import { HandTracker } from './orb/handTracker'
import { buildSystemPrompt } from './llm/systemPrompt'
import { startRecording, stopRecordingAndTranscribe } from './voice/stt'
import { speak, stopSpeaking } from './voice/tts'

// ——— DOM refs ———
const orbRoot = document.getElementById('orb-root')
const transcriptEl = document.getElementById('transcript')
const micBtn = document.getElementById('mic-btn')
const micLabel = document.getElementById('mic-label')
const dotLlm = document.getElementById('dot-llm')
const llmState = document.getElementById('llm-state')
const dotMic = document.getElementById('dot-mic')
const micState = document.getElementById('mic-state')
const textInput = document.getElementById('text-input')
const btnSend = document.getElementById('btn-send')
const btnZoomIn = document.getElementById('btn-zoom-in')
const btnZoomOut = document.getElementById('btn-zoom-out')
const btnReset = document.getElementById('btn-reset')
const btnGestures = document.getElementById('btn-gestures')
const cameraPanel = document.getElementById('camera-panel')
const cameraVideo = document.getElementById('camera-video')
const cameraOverlay = document.getElementById('camera-overlay')
const cameraStatus = document.getElementById('camera-status')

const btnPauseOrb = document.getElementById('btn-pause-orb')
const btnMode = document.getElementById('btn-mode')
const btnEarth = document.getElementById('btn-earth')
const hudLocation = document.getElementById('hud-location')
const locationName = document.getElementById('location-name')
const locationCoords = document.getElementById('location-coords')

// ——— Orb scene ———
const scene = createOrbScene(orbRoot)
btnZoomIn.addEventListener('click', () => scene.zoomIn())
btnZoomOut.addEventListener('click', () => scene.zoomOut())
btnReset.addEventListener('click', () => scene.resetView())

function toggleOrbAnimation() {
  const isPaused = scene.isPaused()
  scene.setPaused(!isPaused)
  if (btnPauseOrb) {
    btnPauseOrb.textContent = !isPaused ? 'ORB: PAUSED (MAX CPU SPEED)' : 'ORB: ON'
    btnPauseOrb.style.background = !isPaused ? 'rgba(255, 60, 0, 0.4)' : ''
  }
}
if (btnPauseOrb) btnPauseOrb.addEventListener('click', toggleOrbAnimation)

window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') scene.zoomIn()
  if (e.key === '-' || e.key === '_') scene.zoomOut()
  if (e.key === 'r' || e.key === 'R') scene.resetView()
  if (e.key === 'g' || e.key === 'G') toggleGestures()
  if ((e.key === 'p' || e.key === 'P') && document.activeElement !== textInput) toggleOrbAnimation()
})

// ——— Hand gestures ———
let tracker = null
async function toggleGestures() {
  if (tracker) {
    tracker.stop()
    tracker = null
    cameraPanel.classList.remove('visible')
    btnGestures.textContent = 'GESTURES OFF'
    btnGestures.setAttribute('aria-pressed', 'false')
    return
  }
  btnGestures.textContent = 'INITIALIZING…'
  tracker = new HandTracker(cameraVideo, cameraOverlay, {
    onRotate: (dt, dp) => scene.rotateBy(dt, dp),
    onZoom: (factor) => scene.zoomBy(factor),
    onStatus: (status) => {
      cameraStatus.textContent =
        status.hands > 0 ? `${status.hands} HAND${status.hands > 1 ? 'S' : ''} · ${status.mode.toUpperCase()}` : 'SHOW HANDS'
    }
  })
  try {
    await tracker.start()
    cameraPanel.classList.add('visible')
    btnGestures.textContent = 'GESTURES ON'
    btnGestures.setAttribute('aria-pressed', 'true')
  } catch (err) {
    tracker = null
    btnGestures.textContent = 'GESTURES OFF'
    console.warn('hand tracking failed to start', err)
  }
}
btnGestures.addEventListener('click', toggleGestures)

// ——— Mode Switcher (PTT vs LIVE LISTEN) ———
let isLiveListenMode = false
let liveAudioCtx = null
let liveAnalyser = null
let liveMicStream = null
let liveVadInterval = null
let isUserSpeakingVad = false
let liveVadRecorder = null
let liveVadChunks = []
let isAiSpeaking = false
let isEchoCoolingDown = false

function toggleMode() {
  isLiveListenMode = !isLiveListenMode
  if (isLiveListenMode) {
    if (btnMode) {
      btnMode.textContent = 'MODE: LIVE LISTEN'
      btnMode.style.background = 'rgba(0, 240, 255, 0.4)'
      btnMode.style.borderColor = '#00f0ff'
      btnMode.style.color = '#00f0ff'
    }
    scene.setLiveListenMode(true)
    startLiveListen()
  } else {
    if (btnMode) {
      btnMode.textContent = 'MODE: PTT'
      btnMode.style.background = ''
      btnMode.style.borderColor = ''
      btnMode.style.color = ''
    }
    scene.setLiveListenMode(false)
    stopLiveListen()
  }
}
if (btnMode) btnMode.addEventListener('click', toggleMode)

// ——— Earth Mode ———
let isEarthMode = false
let earthContext = null   // { lat, lon, placeName }
let earthGeoInterval = null

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=json`
    const res = await fetch(url, { headers: { 'User-Agent': 'FridayJarvis/1.0' } })
    const data = await res.json()
    if (data && data.display_name) return data.display_name
  } catch (_) { /* silent fail */ }
  return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
}

function toggleEarthMode() {
  isEarthMode = !isEarthMode
  scene.setEarthMode(isEarthMode)

  if (isEarthMode) {
    if (btnEarth) { btnEarth.classList.add('earth-active') }
    if (hudLocation) { hudLocation.classList.add('earth-active') }
    if (btnEarth) btnEarth.textContent = '🌍 EARTH: ON'
    // Stop Live Listen / PTT while in Earth Mode (not required, but avoids confusion)
    // Start coordinate polling
    earthGeoInterval = setInterval(async () => {
      if (!isEarthMode || !scene) return
      const coords = scene.getViewCoordinates()
      if (!coords) return
      const place = await reverseGeocode(coords.lat, coords.lon)
      earthContext = { lat: coords.lat, lon: coords.lon, placeName: place }
      if (locationName) {
        // Show only first meaningful segment (city / country)
        const parts = place.split(',').map(p => p.trim()).filter(Boolean)
        locationName.textContent = parts[0] || '—'
      }
      if (locationCoords) {
        locationCoords.textContent =
          `${Math.abs(coords.lat.toFixed(2))}°${coords.lat >= 0 ? 'N' : 'S'}  ` +
          `${Math.abs(coords.lon.toFixed(2))}°${coords.lon >= 0 ? 'E' : 'W'}`
      }
    }, 1800)
  } else {
    if (btnEarth) { btnEarth.classList.remove('earth-active') }
    if (hudLocation) { hudLocation.classList.remove('earth-active') }
    if (btnEarth) btnEarth.textContent = '🌍 EARTH'
    clearInterval(earthGeoInterval)
    earthGeoInterval = null
    earthContext = null
  }
}
if (btnEarth) btnEarth.addEventListener('click', toggleEarthMode)
// Keyboard shortcut: E
window.addEventListener('keydown', (e) => {
  if ((e.key === 'e' || e.key === 'E') && document.activeElement !== textInput) toggleEarthMode()
})

async function startLiveListen() {
  try {
    liveMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const source = liveAudioCtx.createMediaStreamSource(liveMicStream)
    liveAnalyser = liveAudioCtx.createAnalyser()
    liveAnalyser.fftSize = 512
    source.connect(liveAnalyser)

    setMicStatus('ok', 'live listen active')
    micLabel.textContent = 'LIVE LISTENING…'

    const timeDomainArray = new Uint8Array(liveAnalyser.fftSize)
    let silentFrameCount = 0

    liveVadInterval = setInterval(async () => {
      if (!isLiveListenMode || !liveAnalyser) return
      
      // Stop VAD checks completely while AI is generating/speaking or cooling down room echo
      if (isAiSpeaking || isEchoCoolingDown) {
        silentFrameCount = 0
        isUserSpeakingVad = false
        return
      }

      // Calculate true Time-Domain Audio RMS
      liveAnalyser.getByteTimeDomainData(timeDomainArray)
      let sumSquares = 0
      for (let i = 0; i < timeDomainArray.length; i++) {
        const norm = (timeDomainArray[i] - 128) / 128.0
        sumSquares += norm * norm
      }
      const rms = Math.sqrt(sumSquares / timeDomainArray.length)
      const volNorm = Math.min(1.0, Math.max(0, (rms - 0.015) * 8.0))

      if (volNorm > 0.04) {
        scene.setEnergy(volNorm * 1.4)
      } else {
        scene.setEnergy(0)
      }

      // Human Speech VAD Threshold
      const IS_SPEECH = rms > 0.028

      if (IS_SPEECH) {
        silentFrameCount = 0
        if (!isUserSpeakingVad) {
          isUserSpeakingVad = true
          startVadRecording()
        }
      } else if (isUserSpeakingVad) {
        silentFrameCount++
        // 8 consecutive silent frames (~640ms silence) -> triggers processing
        if (silentFrameCount >= 8) {
          isUserSpeakingVad = false
          silentFrameCount = 0
          stopVadRecordingAndProcess()
        }
      }
    }, 80)
  } catch (err) {
    console.error('Failed to start Live Listen mode:', err)
    setMicStatus('error', 'mic unavailable')
  }
}

function stopLiveListen() {
  if (liveVadInterval) clearInterval(liveVadInterval)
  liveVadInterval = null
  if (liveMicStream) {
    liveMicStream.getTracks().forEach((t) => t.stop())
    liveMicStream = null
  }
  if (liveAudioCtx) {
    liveAudioCtx.close()
    liveAudioCtx = null
  }
  isUserSpeakingVad = false
  micLabel.textContent = 'HOLD TO TALK'
  setMicStatus('ok', 'idle')
}

function startVadRecording() {
  if (!liveMicStream || isAiSpeaking || isEchoCoolingDown) return
  liveVadChunks = []
  try {
    liveVadRecorder = new MediaRecorder(liveMicStream)
    liveVadRecorder.ondataavailable = (e) => { if (e.data.size > 0) liveVadChunks.push(e.data) }
    liveVadRecorder.start()
    setMicStatus('busy', 'user speaking…')
  } catch (e) {
    console.error('VAD recorder start error:', e)
  }
}

async function stopVadRecordingAndProcess() {
  if (!liveVadRecorder || liveVadRecorder.state === 'inactive') return
  setMicStatus('busy', 'transcribing…')
  
  const blob = await new Promise((resolve) => {
    liveVadRecorder.onstop = () => resolve(new Blob(liveVadChunks, { type: 'audio/webm' }))
    liveVadRecorder.stop()
  })
  liveVadRecorder = null

  if (blob.size < 500 || isAiSpeaking || isEchoCoolingDown) {
    setMicStatus('ok', 'live listen active')
    return
  }

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioCtx = new AudioContext()
    const decoded = await audioCtx.decodeAudioData(arrayBuffer)
    
    const pcmData = decoded.getChannelData(0)
    const dataLength = pcmData.length * 2
    const wavBuffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(wavBuffer)

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i))
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataLength, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, decoded.sampleRate, true)
    view.setUint32(28, decoded.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, dataLength, true)

    let offset = 44
    for (let i = 0; i < pcmData.length; i++) {
      const s = Math.max(-1, Math.min(1, pcmData[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      offset += 2
    }
    audioCtx.close()

    const res = await window.mark.agentTranscribe(wavBuffer)
    if (res && res.ok && res.text) {
      const textClean = res.text.trim().toLowerCase()
      // Filter out Whisper noise hallucinations or AI self-echo phrases
      const noiseHallucinations = ["you", "thank you.", "subtitles by", "amara.org", "bye.", "uh"]
      const lastAssistantMsg = conversation.slice(-1)[0]?.content?.toLowerCase() || ""
      
      if (!textClean || noiseHallucinations.includes(textClean) || (lastAssistantMsg && lastAssistantMsg.includes(textClean))) {
        loggingConsole('Filtered AI echo / noise hallucination:', res.text)
      } else {
        await handleUserTurn(res.text)
      }
    }
  } catch (e) {
    console.error('VAD process error:', e)
  } finally {
    setMicStatus('ok', 'live listen active')
  }
}

function loggingConsole(msg, val) {
  console.log(`[EchoProtection] ${msg}`, val)
}

// ——— Orb energy pulse while Friday is speaking ———
let energyRaf = null
function driveEnergyWhileSpeaking() {
  const tick = () => {
    scene.setEnergy(0.35 + Math.random() * 0.65)
    energyRaf = requestAnimationFrame(tick)
  }
  tick()
}
function stopEnergyDrive() {
  if (energyRaf) cancelAnimationFrame(energyRaf)
  energyRaf = null
  scene.setEnergy(0)
}

// ——— Conversation state ———
let toolDescriptions = ''
let conversation = []

function addMessage(role, text) {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  transcriptEl.appendChild(el)
  transcriptEl.scrollTop = transcriptEl.scrollHeight
  while (transcriptEl.children.length > 40) transcriptEl.removeChild(transcriptEl.firstChild)
}

function setLlmStatus(state, label) {
  dotLlm.className = `dot ${state}`
  llmState.textContent = label
}
function setMicStatus(state, label) {
  dotMic.className = `dot ${state}`
  micState.textContent = label
}

async function checkBackendHealth() {
  try {
    const health = await window.mark.agentHealth()
    if (health && health.ok) {
      const backend = health.llm_backend || 'unknown'
      const model = health.model || 'local'
      const label = backend === 'gemini' ? `GEMINI · ${model}` : `OLLAMA · ${model}`
      setLlmStatus('ok', label)
      return true
    }
  } catch (e) {
    console.warn('Backend health check error:', e)
  }
  setLlmStatus('error', 'backend offline')
  return false
}

async function init() {
  try {
    toolDescriptions = await window.mark.describeTools()
  } catch (e) {
    console.warn('Failed to describe tools:', e)
  }
  conversation = [{ role: 'system', content: buildSystemPrompt(toolDescriptions) }]

  const isOk = await checkBackendHealth()
  if (!isOk) {
    setTimeout(checkBackendHealth, 3000)
  }
}
init()

function muteMicTracks() {
  if (liveMicStream) {
    liveMicStream.getAudioTracks().forEach((t) => { t.enabled = false })
  }
}

function unmuteMicTracks() {
  if (liveMicStream) {
    liveMicStream.getAudioTracks().forEach((t) => { t.enabled = true })
  }
}

async function handleUserTurn(userText) {
  isAiSpeaking = true
  isEchoCoolingDown = true
  muteMicTracks()
  
  if (liveVadRecorder && liveVadRecorder.state === 'recording') {
    try { liveVadRecorder.stop() } catch {}
  }
  isUserSpeakingVad = false

  addMessage('user', userText)

  // Build messages with optional Earth Mode context injection
  let msgToSend = userText
  if (isEarthMode && earthContext) {
    const { lat, lon, placeName } = earthContext
    msgToSend = `[EARTH MODE] I am currently looking at the globe and viewing: "${placeName}" ` +
      `(latitude: ${lat.toFixed(4)}, longitude: ${lon.toFixed(4)}). ` +
      `With this location as context, please answer my question: ${userText}`
  }

  conversation.push({ role: 'user', content: msgToSend })
  setLlmStatus('busy', 'thinking…')

  try {
    const agentRes = await window.mark.agentChat({ messages: conversation })
    
    if (agentRes && agentRes.ok) {
      const replyText = agentRes.content || 'Will do, Sir.'
      
      if (agentRes.tool_calls && agentRes.tool_calls.length > 0) {
        for (const tc of agentRes.tool_calls) {
          const tName = tc.tool || tc.name
          const tArgs = tc.args || {}
          addMessage('tool', `→ ${tName}(${JSON.stringify(tArgs)})`)
        }
      }
      
      conversation.push({ role: 'assistant', content: replyText })
      addMessage('assistant', replyText)
      setLlmStatus('ok', 'ready')

      driveEnergyWhileSpeaking()
      await speak(replyText, { onEnd: stopEnergyDrive })
    } else {
      throw new Error(agentRes?.error || 'No response from Friday backend')
    }
  } catch (err) {
    setLlmStatus('error', String(err?.message || err))
    addMessage('tool', `error: ${String(err?.message || err)}`)
  } finally {
    // Keep microphone hardware-muted for 1200ms after TTS finishes to guarantee zero loopback
    setTimeout(() => {
      unmuteMicTracks()
      isEchoCoolingDown = false
      isAiSpeaking = false
    }, 1200)
  }
}

// ——— Text input ———
btnSend.addEventListener('click', submitText)
textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitText() })
function submitText() {
  const val = textInput.value.trim()
  if (!val) return
  textInput.value = ''
  handleUserTurn(val)
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement !== textInput) textInput.focus()
})

// ——— Push-to-talk ———
let isRecording = false

async function beginListening() {
  if (isRecording || isLiveListenMode) return
  isRecording = true
  stopSpeaking()
  micBtn.classList.add('listening')
  micLabel.textContent = 'LISTENING…'
  setMicStatus('busy', 'listening')
  try {
    await startRecording()
  } catch (err) {
    isRecording = false
    micBtn.classList.remove('listening')
    micLabel.textContent = 'MIC UNAVAILABLE'
    setMicStatus('error', String(err?.message || err))
  }
}

async function endListening() {
  if (!isRecording || isLiveListenMode) return
  isRecording = false
  micBtn.classList.remove('listening')
  micBtn.classList.add('thinking')
  micLabel.textContent = 'TRANSCRIBING…'
  setMicStatus('busy', 'transcribing')
  try {
    const text = await stopRecordingAndTranscribe()
    micBtn.classList.remove('thinking')
    micLabel.textContent = 'HOLD TO TALK'
    setMicStatus('ok', 'idle')
    if (text) await handleUserTurn(text)
  } catch (err) {
    micBtn.classList.remove('thinking')
    micLabel.textContent = 'HOLD TO TALK'
    setMicStatus('error', String(err?.message || err))
  }
}

micBtn.addEventListener('mousedown', beginListening)
micBtn.addEventListener('mouseup', endListening)
micBtn.addEventListener('mouseleave', () => { if (isRecording) endListening() })

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement !== textInput && !isRecording && !isLiveListenMode) {
    e.preventDefault()
    beginListening()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && document.activeElement !== textInput && !isLiveListenMode) {
    e.preventDefault()
    endListening()
  }
})
