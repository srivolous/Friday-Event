#!/usr/bin/env node
/**
 * F.R.I.D.A.Y. Electron launcher
 * Finds Electron binary by searching disk, downloads if missing, writes path.txt,
 * sets ELECTRON_EXEC_PATH, runs electron-vite. Never uses require('electron').
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'

const markOrbDir = process.cwd()
const electronDir = path.join(markOrbDir, 'node_modules', 'electron')
const distDir = path.join(electronDir, 'dist')

// Platform-specific binary names and paths
function getSearchPaths() {
  const p = process.platform
  if (p === 'darwin') {
    return [path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')]
  }
  if (p === 'win32') {
    return [path.join(distDir, 'electron.exe'), path.join(distDir, 'win32-unpacked', 'electron.exe')]
  }
  // Linux
  return [path.join(distDir, 'electron'), path.join(distDir, 'linux-unpacked', 'electron')]
}

// What path.txt should contain (relative to dist/)
function getRelativePath(binaryPath) {
  return path.relative(distDir, binaryPath)
}

function findElectronBinary() {
  for (const p of getSearchPaths()) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function downloadElectron() {
  console.log('[friday] Electron binary not found — downloading...')
  const installScript = path.join(electronDir, 'install.js')
  if (!fs.existsSync(installScript)) {
    console.error('[friday] install.js not found')
    return null
  }
  try {
    execSync(`node "${installScript}"`, {
      stdio: 'inherit',
      cwd: markOrbDir,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
    })
  } catch (e) {
    console.error('[friday] install.js failed:', e.message)
  }
  return findElectronBinary()
}

function reinstallElectron() {
  console.log('[friday] Reinstalling electron package...')
  try {
    execSync('rm -rf node_modules/electron', { cwd: markOrbDir, stdio: 'ignore' })
    execSync('npm install electron --force', {
      stdio: 'inherit',
      cwd: markOrbDir,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }
    })
  } catch (e) {
    console.error('[friday] Reinstall failed:', e.message)
  }
  return findElectronBinary()
}

// --- Main ---
let electronBin = findElectronBinary()
if (!electronBin) electronBin = downloadElectron()
if (!electronBin) electronBin = reinstallElectron()

if (!electronBin) {
  console.error('[friday] FATAL: Cannot find or download Electron binary')
  console.error('[friday] Manual fix: cd mark-orb && rm -rf node_modules/electron && ELECTRON_SKIP_BINARY_DOWNLOAD=0 npm install electron')
  process.exit(1)
}

// Write path.txt — this is what electron's own index.js reads
const pathFile = path.join(electronDir, 'path.txt')
fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(pathFile, getRelativePath(electronBin))

// Set env so electron-vite uses our found binary (bypasses its own detection)
process.env.ELECTRON_EXEC_PATH = path.resolve(electronBin)
console.log(`[friday] Electron: ${electronBin}`)

if (process.platform !== 'win32') {
  try { fs.chmodSync(electronBin, 0o755) } catch (_) {}
}

// Run electron-vite
const cmd = process.argv[2] || 'dev'
const viteArgs = process.argv.slice(3)
const allArgs = cmd === 'dev' ? ['dev', ...viteArgs] : cmd === 'build' ? ['build', ...viteArgs] : [cmd, ...viteArgs]

const child = spawn('npx', ['electron-vite', ...allArgs], {
  cwd: markOrbDir,
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code) => process.exit(code || 0))
