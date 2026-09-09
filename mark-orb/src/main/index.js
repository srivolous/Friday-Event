import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, execSync } from 'node:child_process'
import { runTool, describeTools } from './tools/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../../..')
const backendScript = path.join(rootDir, 'python_backend.py')

let mainWindow
let pythonProcess = null

// ─── Python discovery: uv → .venv → venv → system ────────────────────────────
function findPython() {
  const isWin = process.platform === 'win32'

  // 1. Try uv (preferred)
  try {
    execSync(isWin ? 'where uv' : 'which uv', { stdio: 'ignore' })
    return { cmd: 'uv', args: ['run', backendScript, '5001'], cwd: rootDir }
  } catch (_) {}

  // 2. Try .venv (uv-managed)
  const venvPy = path.join(rootDir, '.venv', 'bin', 'python')
  const venvPyWin = path.join(rootDir, '.venv', 'Scripts', 'python.exe')
  const py = isWin ? venvPyWin : venvPy
  if (fs.existsSync(py)) {
    return { cmd: py, args: [backendScript, '5001'], cwd: rootDir }
  }

  // 3. Try legacy venv
  const legacyPy = path.join(rootDir, 'venv', 'bin', 'python')
  const legacyPyWin = path.join(rootDir, 'venv', 'Scripts', 'python.exe')
  const lpy = isWin ? legacyPyWin : legacyPy
  if (fs.existsSync(lpy)) {
    return { cmd: lpy, args: [backendScript, '5001'], cwd: rootDir }
  }

  // 4. System python3/python
  for (const bin of ['python3', 'python']) {
    try {
      execSync(isWin ? `where ${bin}` : `which ${bin}`, { stdio: 'ignore' })
      return { cmd: bin, args: [backendScript, '5001'], cwd: rootDir }
    } catch (_) {}
  }

  return null
}

function startPythonBackend() {
  const py = findPython()
  if (!py) {
    console.error('No Python found. Run setup.py or install Python 3.11+.')
    return
  }

  console.log(`Starting Friday backend: ${py.cmd} ${py.args.join(' ')}`)
  pythonProcess = spawn(py.cmd, py.args, {
    cwd: py.cwd,
    stdio: 'inherit'
  })

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
