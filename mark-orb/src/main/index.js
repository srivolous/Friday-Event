import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'
import { runTool, describeTools } from './tools/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../../..')
const backendScript = path.join(rootDir, 'python_backend.py')

let mainWindow
let pythonProcess = null

function startPythonBackend() {
  let useUv = false
  try {
    // Check if 'uv' is available on the system PATH
    execSync(process.platform === 'win32' ? 'where uv' : 'which uv', { stdio: 'ignore' })
    useUv = true
  } catch (e) {
    // uv not installed, fall back to legacy venv
  }

  if (useUv) {
    console.log(`Starting Friday Python backend via Astral uv: uv run python_backend.py 5001`)
    pythonProcess = spawn('uv', ['run', backendScript, '5001'], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  } else {
    const pythonExec = path.join(rootDir, 'venv', 'bin', 'python')
    console.log(`Starting Friday Python backend via legacy venv: ${pythonExec} ${backendScript}`)
    pythonProcess = spawn(pythonExec, [backendScript, '5001'], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  }

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Friday Python backend:', err)
  })

  pythonProcess.on('exit', (code, signal) => {
    console.log(`Friday Python backend exited with code ${code}, signal ${signal}`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    title: 'FRIDAY',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Camera + mic prompts are required for hand-gesture control and voice input.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'camera', 'microphone'].includes(permission))
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  startPythonBackend()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
})

// ——— Friday Python Agent IPC Handlers ———
const PYTHON_BACKEND_URL = 'http://127.0.0.1:5001'

async function fetchWithRetry(url, options = {}, maxRetries = 6, delayMs = 800) {
  let lastErr
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.ok) return res
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    if (i < maxRetries - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  throw lastErr
}

ipcMain.handle('agent:health', async () => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/health`, {}, 8, 500)
    const data = await res.json()
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

ipcMain.handle('agent:transcribe', async (_evt, audioArrayBuffer) => {
  try {
    const buffer = Buffer.from(audioArrayBuffer)
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer
    })
    const data = await res.json()
    return { ok: true, text: data.text || '' }
  } catch (err) {
    console.error('Transcription IPC error:', err)
    return { ok: false, error: String(err?.message || err), text: '' }
  }
})

ipcMain.handle('agent:speak', async (_evt, text) => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    const data = await res.json()
    return { ok: true, ...data }
  } catch (err) {
    console.error('TTS IPC error:', err)
    return { ok: false, error: String(err?.message || err) }
  }
})

ipcMain.handle('agent:speaking_status', async () => {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/speaking_status`)
    if (!res.ok) return { is_speaking: false }
    return await res.json()
  } catch {
    return { is_speaking: false }
  }
})

ipcMain.handle('agent:chat', async (_evt, payload) => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()

    if (data.tool_calls && data.tool_calls.length > 0) {
      for (const tc of data.tool_calls) {
        const name = tc.tool || tc.name
        const args = tc.args || {}
        if (['open_app', 'set_volume', 'open_url'].includes(name)) {
          try {
            console.log(`Executing desktop system tool: ${name}`, args)
            await runTool(name, args)
          } catch (sysErr) {
            console.error(`System tool ${name} execution error:`, sysErr)
          }
        }
      }
    }
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

ipcMain.handle('tools:describe', async () => {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/tools`)
    if (res.ok) {
      const data = await res.json()
      return data.descriptions || describeTools()
    }
  } catch (err) {
    console.warn('Could not fetch tools from python backend, falling back to local describeTools:', err)
  }
  return describeTools()
})

ipcMain.handle('tools:call', async (_evt, { name, args }) => {
  try {
    if (['open_app', 'set_volume', 'open_url'].includes(name)) {
      const result = await runTool(name, args || {})
      return { ok: true, result }
    }
    const res = await fetch(`${PYTHON_BACKEND_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: args || {} })
    })
    if (!res.ok) throw new Error(`Tool call failed: HTTP ${res.status}`)
    const data = await res.json()
    return { ok: true, result: data.result }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

// Legacy Ollama fallback
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

ipcMain.handle('ollama:chat', async (_evt, payload) => {
  const { host, ...body } = payload
  const res = await fetch(`${host || DEFAULT_OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama returned ${res.status}: ${text || res.statusText}`)
  }
  return res.json()
})

ipcMain.handle('ollama:list', async (_evt, host) => {
  const res = await fetch(`${host || DEFAULT_OLLAMA_HOST}/api/tags`)
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
  return res.json()
})

ipcMain.handle('shell:openExternal', (_evt, url) => shell.openExternal(url))
