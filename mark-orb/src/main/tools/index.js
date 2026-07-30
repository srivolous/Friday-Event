import { getWeather } from './weather.js'
import { searchWeb } from './webSearch.js'
import { openApp } from './appLauncher.js'
import { setVolume, openUrl } from './systemSettings.js'

export const TOOLS = {
  get_weather: {
    fn: getWeather,
    description: 'Get current weather conditions for a city.',
    params: { city: 'string' }
  },
  search_web: {
    fn: searchWeb,
    description: 'Search the web and return top results (title, url, snippet).',
    params: { query: 'string', max_results: 'number, optional, default 5' }
  },
  open_app: {
    fn: openApp,
    description: 'Launch a desktop application by name, e.g. "chrome", "spotify", "vscode".',
    params: { app_name: 'string' }
  },
  set_volume: {
    fn: setVolume,
    description: 'Set the system output volume to a percentage.',
    params: { level: 'number 0-100' }
  },
  open_url: {
    fn: openUrl,
    description: 'Open a URL in the default web browser.',
    params: { url: 'string' }
  }
}

export async function runTool(name, args) {
  const tool = TOOLS[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return tool.fn(args)
}

export function describeTools() {
  return Object.entries(TOOLS)
    .map(([name, t]) => `- ${name}(${JSON.stringify(t.params)}) — ${t.description}`)
    .join('\n')
}
