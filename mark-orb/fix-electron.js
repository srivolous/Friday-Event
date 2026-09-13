#!/usr/bin/env node
/**
 * F.R.I.D.A.Y. Electron launcher
 * Finds Electron binary, sets ELECTRON_EXEC_PATH, runs electron-vite.
 * This is the single entry point — no env var leakage between processes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'

const markOrbDir = process.cwd()
const electronDir = path.join(markOrbDir, 'node_modules', 'electron')
const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'

const searchPaths = [
  path.join(electronDir, 'dist', binaryName),
  path.join(electronDir, 'dist', 'linux-unpacked', binaryName),
  path.join(electronDir, 'dist', 'win32-unpacked', binaryName),
  path.join(electronDir, 'dist', 'mac', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
]

function findElectron() {
  // Check known paths
  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p
  }
  // Ask Node's require
  try {
    const p = execSync('node -e "console.log(require(\'electron\'))"', {
      cwd: markOrbDir, encoding: 'utf8', timeout: 10000
    }).trim()
    if (p && fs.existsSync(p)) return p
  } catch (_) {}
  return null
}

function downloadElectron() {
  console.log('[friday] Electron binary not found — downloading...')
  const installScript = path.join(electronDir, 'install.js')
  if (fs.existsSync(installScript)) {
    try {
      execSync(`node "${installScript}"`, {
        stdio: 'inherit', cwd: markOrbDir,
        env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
      })
    } catch (e) {
      console.error('[friday] install.js failed:', e.message)
    }
  }
  return findElectron()
}

function reinstallElectron() {
  console.log('[friday] Reinstalling electron package...')
  try {
    execSync('rm -rf node_modules/electron', { cwd: markOrbDir })
    execSync('npm install electron', {
      stdio: 'inherit', cwd: markOrbDir,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
    })
  } catch (e) {
    console.error('[friday] Reinstall failed:', e.message)
  }
  return findElectron()
}

// --- Main ---
let electronBin = findElectron()
if (!electronBin) electronBin = downloadElectron()
if (!electronBin) electronBin = reinstallElectron()

if (!electronBin) {
  console.error('[friday] FATAL: Cannot find or download Electron binary')
  console.error('Manual fix: cd mark-orb && rm -rf node_modules/electron && ELECTRON_SKIP_BINARY_DOWNLOAD=0 npm install electron')
  process.exit(1)
}

// Set env so electron-vite uses our found binary
process.env.ELECTRON_EXEC_PATH = path.resolve(electronBin)
console.log(`[friday] Electron: ${electronBin}`)

// Fix path.txt for good measure
const pathFile = path.join(electronDir, 'path.txt')
fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true })
fs.writeFileSync(pathFile, binaryName)

if (process.platform !== 'win32') {
  try { fs.chmodSync(electronBin, 0o755) } catch (_) {}
}

// Run electron-vite with the command passed as args
const cmd = process.argv[2] || 'dev'
const viteArgs = process.argv.slice(3)
const allArgs = cmd === 'dev' ? ['dev', ...viteArgs] : cmd === 'build' ? ['build', ...viteArgs] : [cmd, ...viteArgs]

const child = spawn('npx', ['electron-vite', ...allArgs], {
  cwd: markOrbDir,
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code) => process.exit(code || 0))
