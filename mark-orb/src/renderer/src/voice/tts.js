// Local Kokoro TTS integration via Python backend

export function speak(text, { onStart, onBoundary, onEnd } = {}) {
  return new Promise(async (resolve) => {
    onStart?.()
    try {
      const res = await window.mark.agentSpeak(text)
      if (res && res.ok) {
        // Wait 250ms for Python thread to initialize audio playback
        await new Promise((r) => setTimeout(r, 250))
        
        // Poll status until Python backend reports is_speaking is false
        while (true) {
          try {
            const status = await window.mark.agentSpeakingStatus()
            if (!status || !status.is_speaking) {
              break
            }
            onBoundary?.()
          } catch {
            break
          }
          await new Promise((r) => setTimeout(r, 120))
        }
        onEnd?.()
        resolve()
      } else {
        await fallbackSpeak(text, { onStart, onBoundary, onEnd })
        resolve()
      }
    } catch (err) {
      console.warn('Kokoro TTS failed, falling back to Web Speech:', err)
      await fallbackSpeak(text, { onStart, onBoundary, onEnd })
      resolve()
    }
  })
}

function fallbackSpeak(text, { onStart, onBoundary, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      onEnd?.()
      resolve()
      return
    }
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.2
    utter.pitch = 0.95
    utter.onstart = () => onStart?.()
    utter.onboundary = () => onBoundary?.()
    utter.onend = () => { onEnd?.(); resolve() }
    utter.onerror = () => { onEnd?.(); resolve() }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utter)
  })
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
