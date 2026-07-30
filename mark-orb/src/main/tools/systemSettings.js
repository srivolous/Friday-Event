// System volume tool.
// Mark-L's actions/computer_settings.py hand-rolls this per OS: pycaw (COM) on Windows,
// `osascript` on macOS, `pactl`/`amixer` on Linux. We get the same three-OS coverage from
// the single 'loudness' npm package (it wraps the same native calls under the hood), which
// keeps this file small. It's an optional dependency — if it's not installed, the tool
// fails loudly with instructions rather than silently doing nothing.

import { shell } from 'electron'

async function getLoudness() {
  try {
    const mod = await import('loudness')
    return mod.default ?? mod
  } catch {
    throw new Error('Volume control needs the optional "loudness" package. Run: npm install loudness')
  }
}

export async function setVolume({ level }) {
  const pct = Math.max(0, Math.min(100, Number(level)))
  const loudness = await getLoudness()
  await loudness.setVolume(pct)
  return { volume: pct }
}

export async function getVolume() {
  const loudness = await getLoudness()
  return { volume: await loudness.getVolume() }
}

export async function openUrl({ url }) {
  if (!url || !String(url).trim()) throw new Error('url is required')
  await shell.openExternal(url)
  return { opened: url }
}
