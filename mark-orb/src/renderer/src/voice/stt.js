// Instant local speech-to-text via pre-warmed Python Faster-Whisper backend

let mediaStream = null
let recorder = null
let chunks = []

export async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  chunks = []
  recorder = new MediaRecorder(mediaStream)
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start()
}

export async function stopRecordingAndTranscribe() {
  if (!recorder) throw new Error('not recording')
  const blob = await new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }))
    recorder.stop()
  })
  mediaStream.getTracks().forEach((t) => t.stop())
  mediaStream = null
  recorder = null

  const wavArrayBuffer = await convertBlobToWav(blob)
  const res = await window.mark.agentTranscribe(wavArrayBuffer)
  if (res && res.ok) {
    return (res.text || '').trim()
  }
  return ''
}

async function convertBlobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext()
  const decoded = await audioCtx.decodeAudioData(arrayBuffer)
  const wavBuffer = audioBufferToWav(decoded)
  audioCtx.close()
  return wavBuffer
}

function audioBufferToWav(buffer) {
  const numChannels = 1
  const sampleRate = 16000
  const offlineCtx = new OfflineAudioContext(numChannels, Math.ceil(buffer.duration * sampleRate), sampleRate)
  const src = offlineCtx.createBufferSource()
  src.buffer = buffer
  src.connect(offlineCtx.destination)
  src.start()
  
  // We construct a simple mono 16kHz PCM WAV ArrayBuffer directly
  const pcmData = buffer.getChannelData(0)
  const wavHeaderLength = 44
  const dataLength = pcmData.length * 2
  const arrayBuffer = new ArrayBuffer(wavHeaderLength + dataLength)
  const view = new DataView(arrayBuffer)

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size
  view.setUint16(20, 1, true)  // AudioFormat (PCM)
  view.setUint16(22, 1, true)  // NumChannels
  view.setUint32(24, buffer.sampleRate, true) // SampleRate
  view.setUint32(28, buffer.sampleRate * 2, true) // ByteRate
  view.setUint16(32, 2, true)  // BlockAlign
  view.setUint16(34, 16, true) // BitsPerSample
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return arrayBuffer
}
