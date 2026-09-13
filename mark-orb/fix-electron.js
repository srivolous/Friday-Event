import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const electronDir = path.join(process.cwd(), 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')
const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const binaryPath = path.join(electronDir, 'dist', binaryName)
const installScript = path.join(electronDir, 'install.js')

if (!fs.existsSync(electronDir)) {
  console.error('[F.R.I.D.A.Y.] node_modules/electron not found — run npm install first')
  process.exit(1)
}

// Fix path.txt
const content = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : ''
if (content !== 'electron') {
  fs.writeFileSync(pathFile, 'electron')
  console.log('[F.R.I.D.A.Y.] Self-healed Electron path.txt config.')
}

// Check if binary exists
if (fs.existsSync(binaryPath)) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(binaryPath, 0o755) } catch (_) {}
  }
  console.log(`[F.R.I.D.A.Y.] Electron binary found: ${binaryPath}`)
} else {
  console.log('[F.R.I.D.A.Y.] Electron binary missing!')
  if (fs.existsSync(installScript)) {
    console.log('[F.R.I.D.A.Y.] Running electron install.js...')
    try {
      execSync(`node "${installScript}"`, {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
      })
      if (fs.existsSync(binaryPath)) {
        console.log('[F.R.I.D.A.Y.] Electron binary downloaded successfully.')
        if (process.platform !== 'win32') {
          try { fs.chmodSync(binaryPath, 0o755) } catch (_) {}
        }
      } else {
        console.error('[F.R.I.D.A.Y.] install.js ran but binary still missing!')
        console.error('[F.R.I.D.A.Y.] Try: cd mark-orb && rm -rf node_modules/electron && npm install')
      }
    } catch (e) {
      console.error('[F.R.I.D.A.Y.] Failed to download Electron:', e.message)
      console.error('[F.R.I.D.A.Y.] Try: cd mark-orb && rm -rf node_modules/electron && npm install')
    }
  } else {
    console.error('[F.R.I.D.A.Y.] install.js not found!')
  }
}
