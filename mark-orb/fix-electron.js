import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const electronDir = path.join(process.cwd(), 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')

if (fs.existsSync(electronDir)) {
  const content = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : ''
  if (content !== 'electron') {
    fs.writeFileSync(pathFile, 'electron')
    console.log('[F.R.I.D.A.Y.] Self-healed Electron path.txt config.')
  }

  const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const binaryPath = path.join(electronDir, 'dist', binaryName)

  if (!fs.existsSync(binaryPath)) {
    console.log('[F.R.I.D.A.Y.] Electron binary missing, downloading...')
    try {
      execSync('node node_modules/electron/install.js', { stdio: 'inherit', cwd: process.cwd() })
      console.log('[F.R.I.D.A.Y.] Electron binary downloaded.')
    } catch (e) {
      console.error('[F.R.I.D.A.Y.] Failed to download Electron binary:', e.message)
    }
  } else if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch (_) {}
  }
}
