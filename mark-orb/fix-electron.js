import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const electronDir = path.join(process.cwd(), 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')
const distDir = path.join(electronDir, 'dist')
const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const binaryPath = path.join(distDir, binaryName)

// Step 1: Ensure electron package exists
if (!fs.existsSync(electronDir)) {
  console.error('[F.R.I.D.A.Y.] node_modules/electron not found — run npm install first')
  process.exit(1)
}

// Step 2: Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

// Step 3: Ensure path.txt is correct (electron-vite reads this)
const correctContent = binaryName
const currentContent = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : ''
if (currentContent !== correctContent) {
  fs.writeFileSync(pathFile, correctContent)
  console.log(`[F.R.I.D.A.Y.] Fixed path.txt → "${correctContent}"`)
}

// Step 4: Ensure binary exists
if (fs.existsSync(binaryPath)) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(binaryPath, 0o755) } catch (_) {}
  }
  console.log(`[F.R.I.D.A.Y.] Electron binary OK: ${binaryPath}`)
} else {
  console.log('[F.R.I.D.A.Y.] Electron binary missing — downloading...')
  const installScript = path.join(electronDir, 'install.js')
  if (fs.existsSync(installScript)) {
    try {
      execSync(`node "${installScript}"`, {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_SKIP_BINARY_DOWNLOAD: '0',
          npm_config_electron_mirror: process.env.npm_config_electron_mirror || 'https://github.com/electron/electron/releases/download/'
        }
      })
    } catch (e) {
      console.error('[F.R.I.D.A.Y.] install.js failed:', e.message)
    }
  }

  // Check again
  if (fs.existsSync(binaryPath)) {
    if (process.platform !== 'win32') {
      try { fs.chmodSync(binaryPath, 0o755) } catch (_) {}
    }
    console.log('[F.R.I.D.A.Y.] Electron binary downloaded.')
  } else {
    // Nuclear option: delete electron and reinstall
    console.log('[F.R.I.D.A.Y.] Binary still missing — reinstalling electron package...')
    try {
      execSync('npm install electron --force', {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
      })
    } catch (e) {
      console.error('[F.R.I.D.A.Y.] Reinstall failed:', e.message)
    }
    if (fs.existsSync(binaryPath)) {
      console.log('[F.R.I.D.A.Y.] Electron binary downloaded after reinstall.')
    } else {
      console.error('[F.R.I.D.A.Y.] CRITICAL: Cannot download Electron binary.')
      console.error('[F.R.I.D.A.Y.] Manual fix: cd mark-orb && rm -rf node_modules/electron && npm install')
    }
  }
}
