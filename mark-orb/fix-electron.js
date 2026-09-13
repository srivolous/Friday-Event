#!/usr/bin/env node
/**
 * Bulletproof Electron launcher — finds the real binary and sets ELECTRON_EXEC_PATH
 * so electron-vite never has to guess.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'

const markOrbDir = process.cwd()
const electronDir = path.join(markOrbDir, 'node_modules', 'electron')
const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'

// Possible locations for the Electron binary
const searchPaths = [
  path.join(electronDir, 'dist', binaryName),
  path.join(electronDir, 'dist', 'electron', binaryName),
  path.join(electronDir, 'dist', 'linux-unpacked', binaryName),
  path.join(electronDir, 'dist', 'win32-unpacked', binaryName),
  path.join(electronDir, 'dist', 'mac', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
]

// Also check electron's own path resolution
let electronBinPath = null

// Method 1: Find binary in known locations
for (const p of searchPaths) {
  if (fs.existsSync(p)) {
    electronBinPath = p
    break
  }
}

// Method 2: Ask electron where it is
if (!electronBinPath) {
  try {
    const result = execSync('node -e "try{console.log(require(\'electron\'))}catch(e){}"', {
      cwd: markOrbDir, encoding: 'utf8', timeout: 10000
    }).trim()
    if (result && fs.existsSync(result)) {
      electronBinPath = result
    }
  } catch (_) {}
}

// Method 3: Use electron's install.js
if (!electronBinPath) {
  const installScript = path.join(electronDir, 'install.js')
  if (fs.existsSync(installScript)) {
    console.log('[fix-electron] Running electron install.js...')
    try {
      execSync(`node "${installScript}"`, {
        stdio: 'inherit',
        cwd: markOrbDir,
        env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
      })
    } catch (e) {
      console.error('[fix-electron] install.js failed:', e.message)
    }
    // Re-check
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        electronBinPath = p
        break
      }
    }
  }
}

// Method 4: Nuclear — delete and reinstall
if (!electronBinPath) {
  console.log('[fix-electron] Binary still missing — reinstalling electron...')
  try {
    execSync('rm -rf node_modules/electron', { cwd: markOrbDir, stdio: 'inherit' })
    execSync('npm install electron', {
      cwd: markOrbDir, stdio: 'inherit',
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
    })
  } catch (e) {
    console.error('[fix-electron] Reinstall failed:', e.message)
  }
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      electronBinPath = p
      break
    }
  }
}

if (electronBinPath) {
  // Ensure path.txt is correct
  const pathFile = path.join(electronDir, 'path.txt')
  const relativePath = path.relative(electronDir, electronBinPath)
    .replace(/^dist[/\\]/, '')
    .replace(/[/\\]electron(\.exe)?$/, 'electron')
  fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true })
  fs.writeFileSync(pathFile, binaryName)

  // Set env so electron-vite uses the real binary
  process.env.ELECTRON_EXEC_PATH = path.resolve(electronBinPath)
  if (process.platform !== 'win32') {
    try { fs.chmodSync(electronBinPath, 0o755) } catch (_) {}
  }
  console.log(`[fix-electron] Electron binary: ${electronBinPath}`)
} else {
  console.error('[fix-electron] CRITICAL: Could not find or download Electron binary!')
  console.error('[fix-electron] Manual fix:')
  console.error('  cd mark-orb')
  console.error('  rm -rf node_modules/electron')
  console.error('  ELECTRON_SKIP_BINARY_DOWNLOAD=0 npm install electron')
  process.exit(1)
}

// Now run electron-vite with the args
const args = process.argv.slice(2)
const child = spawn('npx', ['electron-vite', ...args], {
  cwd: markOrbDir,
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code) => process.exit(code || 0))
