import fs from 'node:fs'
import path from 'node:path'

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
  if (fs.existsSync(binaryPath) && process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch (_) {}
  }
}
