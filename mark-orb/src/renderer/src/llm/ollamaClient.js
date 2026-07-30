// Thin client for local Ollama, reached through the main-process IPC bridge
// (see src/preload/index.js + src/main/index.js) rather than fetched directly from the
// renderer, so nothing here depends on renderer-side network/CORS quirks.

const DEFAULT_MODEL = 'llama3.1:latest'

export async function ollamaChat(messages, { model = DEFAULT_MODEL, host } = {}) {
  const res = await window.mark.ollamaChat({
    model,
    messages,
    stream: false,
    options: { temperature: 0.6 },
    host
  })
  return res?.message?.content ?? ''
}

export async function ollamaIsReachable(host) {
  try {
    const res = await window.mark.ollamaList(host)
    return { ok: true, models: (res?.models || []).map((m) => m.name) }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
