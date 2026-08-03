import { shell, app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import os from "node:os";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
async function getWeather({ city }) {
  if (!city || !String(city).trim()) throw new Error("city is required");
  const res = await fetch(`https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`, {
    headers: { "User-Agent": "curl/8.0" }
    // wttr.in serves ANSI art to browser-like UAs; curl UA gets JSON cleanly
  });
  if (!res.ok) throw new Error(`weather lookup failed (${res.status})`);
  const data = await res.json();
  const cur = data.current_condition?.[0];
  const area = data.nearest_area?.[0];
  if (!cur) throw new Error(`no weather data for "${city}"`);
  return {
    location: [area?.areaName?.[0]?.value, area?.country?.[0]?.value].filter(Boolean).join(", ") || city,
    temperature_c: Number(cur.temp_C),
    feels_like_c: Number(cur.FeelsLikeC),
    condition: cur.weatherDesc?.[0]?.value,
    humidity_pct: Number(cur.humidity),
    wind_kmph: Number(cur.windspeedKmph)
  };
}
async function searchWeb({ query, max_results = 5 }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarkOrb/1.0)" }
  });
  const html = await res.text();
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [...html.matchAll(linkRe)];
  const snippets = [...html.matchAll(snippetRe)];
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const results = [];
  for (let i = 0; i < links.length && results.length < max_results; i++) {
    let url = links[i][1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    results.push({
      title: strip(links[i][2]),
      url,
      snippet: strip(snippets[i]?.[1] || "")
    });
  }
  return { query, results };
}
const PLATFORM = os.platform();
const APP_ALIASES = {
  chrome: { win32: "chrome", darwin: "Google Chrome", linux: "google-chrome" },
  "google chrome": { win32: "chrome", darwin: "Google Chrome", linux: "google-chrome" },
  firefox: { win32: "firefox", darwin: "Firefox", linux: "firefox" },
  edge: { win32: "msedge", darwin: "Microsoft Edge", linux: "microsoft-edge" },
  brave: { win32: "brave", darwin: "Brave Browser", linux: "brave-browser" },
  opera: { win32: "opera", darwin: "Opera", linux: "opera" },
  whatsapp: { win32: "WhatsApp", darwin: "WhatsApp", linux: "whatsapp" },
  telegram: { win32: "Telegram", darwin: "Telegram", linux: "telegram" },
  discord: { win32: "Discord", darwin: "Discord", linux: "discord" },
  slack: { win32: "Slack", darwin: "Slack", linux: "slack" },
  zoom: { win32: "Zoom", darwin: "zoom.us", linux: "zoom" },
  teams: { win32: "msteams", darwin: "Microsoft Teams", linux: "teams" },
  skype: { win32: "skype", darwin: "Skype", linux: "skype" },
  signal: { win32: "signal", darwin: "Signal", linux: "signal" },
  spotify: { win32: "Spotify", darwin: "Spotify", linux: "spotify" },
  vlc: { win32: "vlc", darwin: "VLC", linux: "vlc" },
  vscode: { win32: "code", darwin: "Visual Studio Code", linux: "code" },
  "visual studio code": { win32: "code", darwin: "Visual Studio Code", linux: "code" },
  code: { win32: "code", darwin: "Visual Studio Code", linux: "code" },
  terminal: { win32: "wt", darwin: "Terminal", linux: "x-terminal-emulator" },
  cmd: { win32: "cmd.exe", darwin: "Terminal", linux: "bash" },
  powershell: { win32: "powershell.exe", darwin: "Terminal", linux: "bash" },
  postman: { win32: "Postman", darwin: "Postman", linux: "postman" },
  figma: { win32: "Figma", darwin: "Figma", linux: "figma" },
  blender: { win32: "blender", darwin: "Blender", linux: "blender" },
  word: { win32: "winword", darwin: "Microsoft Word", linux: "libreoffice --writer" },
  excel: { win32: "excel", darwin: "Microsoft Excel", linux: "libreoffice --calc" },
  powerpoint: { win32: "powerpnt", darwin: "Microsoft PowerPoint", linux: "libreoffice --impress" },
  libreoffice: { win32: "soffice", darwin: "LibreOffice", linux: "libreoffice" },
  notepad: { win32: "notepad.exe", darwin: "TextEdit", linux: "gedit" },
  textedit: { win32: "notepad.exe", darwin: "TextEdit", linux: "gedit" },
  explorer: { win32: "explorer.exe", darwin: "Finder", linux: "nautilus" },
  "file explorer": { win32: "explorer.exe", darwin: "Finder", linux: "nautilus" },
  finder: { win32: "explorer.exe", darwin: "Finder", linux: "nautilus" },
  "task manager": { win32: "taskmgr.exe", darwin: "Activity Monitor", linux: "gnome-system-monitor" },
  settings: { win32: "ms-settings:", darwin: "System Preferences", linux: "gnome-control-center" },
  calculator: { win32: "calc.exe", darwin: "Calculator", linux: "gnome-calculator" },
  paint: { win32: "mspaint.exe", darwin: "Preview", linux: "gimp" },
  notion: { win32: "Notion", darwin: "Notion", linux: "notion" },
  obsidian: { win32: "Obsidian", darwin: "Obsidian", linux: "obsidian" },
  steam: { win32: "steam", darwin: "Steam", linux: "steam" },
  epic: { win32: "EpicGamesLauncher", darwin: "Epic Games Launcher", linux: "legendary" },
  "epic games": { win32: "EpicGamesLauncher", darwin: "Epic Games Launcher", linux: "legendary" }
};
function normalize(raw) {
  const key = raw.toLowerCase().trim();
  if (APP_ALIASES[key]) return APP_ALIASES[key][PLATFORM] || raw;
  for (const [aliasKey, osMap] of Object.entries(APP_ALIASES)) {
    if (key.includes(aliasKey) || aliasKey.includes(key)) return osMap[PLATFORM] || raw;
  }
  return raw;
}
function commandExists(cmd) {
  try {
    if (PLATFORM === "win32") execSync(`where ${cmd}`, { stdio: "ignore" });
    else execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}
function launchWindows(name) {
  try {
    spawn("cmd.exe", ["/c", "start", '""', name], { detached: true, stdio: "ignore", shell: false }).unref();
    return true;
  } catch {
    return false;
  }
}
function launchMac(name) {
  try {
    spawn("open", ["-a", name], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
const LINUX_TERMINAL_FALLBACKS = [
  "x-terminal-emulator",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "xterm",
  "lxterminal",
  "mate-terminal",
  "tilix",
  "alacritty",
  "kitty"
];
function launchLinux(name) {
  if (["x-terminal-emulator", "gnome-terminal", "terminal"].includes(name)) {
    for (const term of LINUX_TERMINAL_FALLBACKS) {
      if (commandExists(term)) {
        spawn(term, [], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
    }
  }
  const [bin, ...rest] = name.split(" ");
  if (commandExists(bin)) {
    spawn(bin, rest, { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  try {
    spawn("xdg-open", [name], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
const LAUNCHERS = { win32: launchWindows, darwin: launchMac, linux: launchLinux };
async function openApp({ app_name }) {
  if (!app_name || !String(app_name).trim()) throw new Error("app_name is required");
  const launcher = LAUNCHERS[PLATFORM];
  if (!launcher) throw new Error(`Unsupported OS: ${PLATFORM}`);
  const raw = app_name.trim();
  const normalized = normalize(raw);
  const ok = launcher(normalized) || normalized !== raw && launcher(raw);
  if (!ok) {
    throw new Error(`Could not launch "${app_name}" — it may not be installed, or isn't on PATH.`);
  }
  return { opened: app_name };
}
async function getLoudness() {
  try {
    const mod = await import("./index-Dibiv9U0.js").then((n) => n.i);
    return mod.default ?? mod;
  } catch {
    throw new Error('Volume control needs the optional "loudness" package. Run: npm install loudness');
  }
}
async function setVolume({ level }) {
  const pct = Math.max(0, Math.min(100, Number(level)));
  const loudness = await getLoudness();
  await loudness.setVolume(pct);
  return { volume: pct };
}
async function openUrl({ url }) {
  if (!url || !String(url).trim()) throw new Error("url is required");
  await shell.openExternal(url);
  return { opened: url };
}
const TOOLS = {
  get_weather: {
    fn: getWeather,
    description: "Get current weather conditions for a city.",
    params: { city: "string" }
  },
  search_web: {
    fn: searchWeb,
    description: "Search the web and return top results (title, url, snippet).",
    params: { query: "string", max_results: "number, optional, default 5" }
  },
  open_app: {
    fn: openApp,
    description: 'Launch a desktop application by name, e.g. "chrome", "spotify", "vscode".',
    params: { app_name: "string" }
  },
  set_volume: {
    fn: setVolume,
    description: "Set the system output volume to a percentage.",
    params: { level: "number 0-100" }
  },
  open_url: {
    fn: openUrl,
    description: "Open a URL in the default web browser.",
    params: { url: "string" }
  }
};
async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.fn(args);
}
function describeTools() {
  return Object.entries(TOOLS).map(([name, t]) => `- ${name}(${JSON.stringify(t.params)}) — ${t.description}`).join("\n");
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname$1, "../../..");
const backendScript = path.join(rootDir, "python_backend.py");
let mainWindow;
let pythonProcess = null;
function startPythonBackend() {
  let useUv = false;
  try {
    execSync(process.platform === "win32" ? "where uv" : "which uv", { stdio: "ignore" });
    useUv = true;
  } catch (e) {
  }
  if (useUv) {
    console.log(`Starting Friday Python backend via Astral uv: uv run python_backend.py 5001`);
    pythonProcess = spawn("uv", ["run", backendScript, "5001"], {
      cwd: rootDir,
      stdio: "inherit"
    });
  } else {
    const pythonExec = path.join(rootDir, "venv", "bin", "python");
    console.log(`Starting Friday Python backend via legacy venv: ${pythonExec} ${backendScript}`);
    pythonProcess = spawn(pythonExec, [backendScript, "5001"], {
      cwd: rootDir,
      stdio: "inherit"
    });
  }
  pythonProcess.on("error", (err) => {
    console.error("Failed to start Friday Python backend:", err);
  });
  pythonProcess.on("exit", (code, signal) => {
    console.log(`Friday Python backend exited with code ${code}, signal ${signal}`);
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    title: "FRIDAY",
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["media", "camera", "microphone"].includes(permission));
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../renderer/index.html"));
  }
}
app.whenReady().then(() => {
  startPythonBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});
const PYTHON_BACKEND_URL = "http://127.0.0.1:5001";
async function fetchWithRetry(url, options = {}, maxRetries = 6, delayMs = 800) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < maxRetries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr;
}
ipcMain.handle("agent:health", async () => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/health`, {}, 8, 500);
    const data = await res.json();
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("agent:transcribe", async (_evt, audioArrayBuffer) => {
  try {
    const buffer = Buffer.from(audioArrayBuffer);
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer
    });
    const data = await res.json();
    return { ok: true, text: data.text || "" };
  } catch (err) {
    console.error("Transcription IPC error:", err);
    return { ok: false, error: String(err?.message || err), text: "" };
  }
});
ipcMain.handle("agent:speak", async (_evt, text) => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    return { ok: true, ...data };
  } catch (err) {
    console.error("TTS IPC error:", err);
    return { ok: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("agent:speaking_status", async () => {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/speaking_status`);
    if (!res.ok) return { is_speaking: false };
    return await res.json();
  } catch {
    return { is_speaking: false };
  }
});
ipcMain.handle("agent:chat", async (_evt, payload) => {
  try {
    const res = await fetchWithRetry(`${PYTHON_BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.tool_calls && data.tool_calls.length > 0) {
      for (const tc of data.tool_calls) {
        const name = tc.tool || tc.name;
        const args = tc.args || {};
        if (["open_app", "set_volume", "open_url"].includes(name)) {
          try {
            console.log(`Executing desktop system tool: ${name}`, args);
            await runTool(name, args);
          } catch (sysErr) {
            console.error(`System tool ${name} execution error:`, sysErr);
          }
        }
      }
    }
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("tools:describe", async () => {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/tools`);
    if (res.ok) {
      const data = await res.json();
      return data.descriptions || describeTools();
    }
  } catch (err) {
    console.warn("Could not fetch tools from python backend, falling back to local describeTools:", err);
  }
  return describeTools();
});
ipcMain.handle("tools:call", async (_evt, { name, args }) => {
  try {
    if (["open_app", "set_volume", "open_url"].includes(name)) {
      const result = await runTool(name, args || {});
      return { ok: true, result };
    }
    const res = await fetch(`${PYTHON_BACKEND_URL}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: args || {} })
    });
    if (!res.ok) throw new Error(`Tool call failed: HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
ipcMain.handle("ollama:chat", async (_evt, payload) => {
  const { host, ...body } = payload;
  const res = await fetch(`${host || DEFAULT_OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
});
ipcMain.handle("ollama:list", async (_evt, host) => {
  const res = await fetch(`${host || DEFAULT_OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  return res.json();
});
ipcMain.handle("shell:openExternal", (_evt, url) => shell.openExternal(url));
