// App launcher tool.
// Ported from Mark-L's actions/open_app.py: the alias table (spoken app name -> OS-specific
// executable/bundle name) and the per-OS launch strategy (Windows: start/PATH lookup,
// macOS: `open -a`, Linux: PATH lookup -> xdg-open), translated from Python
// subprocess/psutil/pyautogui to Node's child_process. The pyautogui "type into the OS
// search box" last-resort fallback is dropped since it needs a screen-automation lib we
// don't want as a hard dependency here — the alias table already covers the common cases.

import { spawn, execSync } from 'node:child_process'
import os from 'node:os'

const PLATFORM = os.platform() // 'win32' | 'darwin' | 'linux'

const APP_ALIASES = {
  chrome: { win32: 'chrome', darwin: 'Google Chrome', linux: 'google-chrome' },
  'google chrome': { win32: 'chrome', darwin: 'Google Chrome', linux: 'google-chrome' },
  firefox: { win32: 'firefox', darwin: 'Firefox', linux: 'firefox' },
  edge: { win32: 'msedge', darwin: 'Microsoft Edge', linux: 'microsoft-edge' },
  brave: { win32: 'brave', darwin: 'Brave Browser', linux: 'brave-browser' },
  opera: { win32: 'opera', darwin: 'Opera', linux: 'opera' },
  whatsapp: { win32: 'WhatsApp', darwin: 'WhatsApp', linux: 'whatsapp' },
  telegram: { win32: 'Telegram', darwin: 'Telegram', linux: 'telegram' },
  discord: { win32: 'Discord', darwin: 'Discord', linux: 'discord' },
  slack: { win32: 'Slack', darwin: 'Slack', linux: 'slack' },
  zoom: { win32: 'Zoom', darwin: 'zoom.us', linux: 'zoom' },
  teams: { win32: 'msteams', darwin: 'Microsoft Teams', linux: 'teams' },
  skype: { win32: 'skype', darwin: 'Skype', linux: 'skype' },
  signal: { win32: 'signal', darwin: 'Signal', linux: 'signal' },
  spotify: { win32: 'Spotify', darwin: 'Spotify', linux: 'spotify' },
  vlc: { win32: 'vlc', darwin: 'VLC', linux: 'vlc' },
  vscode: { win32: 'code', darwin: 'Visual Studio Code', linux: 'code' },
  'visual studio code': { win32: 'code', darwin: 'Visual Studio Code', linux: 'code' },
  code: { win32: 'code', darwin: 'Visual Studio Code', linux: 'code' },
  terminal: { win32: 'wt', darwin: 'Terminal', linux: 'x-terminal-emulator' },
  cmd: { win32: 'cmd.exe', darwin: 'Terminal', linux: 'bash' },
  powershell: { win32: 'powershell.exe', darwin: 'Terminal', linux: 'bash' },
  postman: { win32: 'Postman', darwin: 'Postman', linux: 'postman' },
  figma: { win32: 'Figma', darwin: 'Figma', linux: 'figma' },
  blender: { win32: 'blender', darwin: 'Blender', linux: 'blender' },
  word: { win32: 'winword', darwin: 'Microsoft Word', linux: 'libreoffice --writer' },
  excel: { win32: 'excel', darwin: 'Microsoft Excel', linux: 'libreoffice --calc' },
  powerpoint: { win32: 'powerpnt', darwin: 'Microsoft PowerPoint', linux: 'libreoffice --impress' },
  libreoffice: { win32: 'soffice', darwin: 'LibreOffice', linux: 'libreoffice' },
  notepad: { win32: 'notepad.exe', darwin: 'TextEdit', linux: 'gedit' },
  textedit: { win32: 'notepad.exe', darwin: 'TextEdit', linux: 'gedit' },
  explorer: { win32: 'explorer.exe', darwin: 'Finder', linux: 'nautilus' },
  'file explorer': { win32: 'explorer.exe', darwin: 'Finder', linux: 'nautilus' },
  finder: { win32: 'explorer.exe', darwin: 'Finder', linux: 'nautilus' },
  'task manager': { win32: 'taskmgr.exe', darwin: 'Activity Monitor', linux: 'gnome-system-monitor' },
  settings: { win32: 'ms-settings:', darwin: 'System Preferences', linux: 'gnome-control-center' },
  calculator: { win32: 'calc.exe', darwin: 'Calculator', linux: 'gnome-calculator' },
  paint: { win32: 'mspaint.exe', darwin: 'Preview', linux: 'gimp' },
  notion: { win32: 'Notion', darwin: 'Notion', linux: 'notion' },
  obsidian: { win32: 'Obsidian', darwin: 'Obsidian', linux: 'obsidian' },
  steam: { win32: 'steam', darwin: 'Steam', linux: 'steam' },
  epic: { win32: 'EpicGamesLauncher', darwin: 'Epic Games Launcher', linux: 'legendary' },
  'epic games': { win32: 'EpicGamesLauncher', darwin: 'Epic Games Launcher', linux: 'legendary' }
}

function normalize(raw) {
  const key = raw.toLowerCase().trim()
  if (APP_ALIASES[key]) return APP_ALIASES[key][PLATFORM] || raw
  for (const [aliasKey, osMap] of Object.entries(APP_ALIASES)) {
    if (key.includes(aliasKey) || aliasKey.includes(key)) return osMap[PLATFORM] || raw
  }
  return raw
}

function commandExists(cmd) {
  try {
    if (PLATFORM === 'win32') execSync(`where ${cmd}`, { stdio: 'ignore' })
    else execSync(`command -v ${cmd}`, { stdio: 'ignore', shell: '/bin/sh' })
    return true
  } catch {
    return false
  }
}

function launchWindows(name) {
  try {
    // `start` needs a dummy title arg when the target itself is quoted
    spawn('cmd.exe', ['/c', 'start', '""', name], { detached: true, stdio: 'ignore', shell: false }).unref()
    return true
  } catch {
    return false
  }
}

function launchMac(name) {
  try {
    spawn('open', ['-a', name], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

const LINUX_TERMINAL_FALLBACKS = [
  'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal',
  'xterm', 'lxterminal', 'mate-terminal', 'tilix', 'alacritty', 'kitty'
]

function launchLinux(name) {
  if (['x-terminal-emulator', 'gnome-terminal', 'terminal'].includes(name)) {
    for (const term of LINUX_TERMINAL_FALLBACKS) {
      if (commandExists(term)) {
        spawn(term, [], { detached: true, stdio: 'ignore' }).unref()
        return true
      }
    }
  }
  const [bin, ...rest] = name.split(' ')
  if (commandExists(bin)) {
    spawn(bin, rest, { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  try {
    spawn('xdg-open', [name], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

const LAUNCHERS = { win32: launchWindows, darwin: launchMac, linux: launchLinux }

export async function openApp({ app_name }) {
  if (!app_name || !String(app_name).trim()) throw new Error('app_name is required')
  const launcher = LAUNCHERS[PLATFORM]
  if (!launcher) throw new Error(`Unsupported OS: ${PLATFORM}`)

  const raw = app_name.trim()
  const normalized = normalize(raw)

  const ok = launcher(normalized) || (normalized !== raw && launcher(raw))
  if (!ok) {
    throw new Error(`Could not launch "${app_name}" — it may not be installed, or isn't on PATH.`)
  }
  return { opened: app_name }
}
