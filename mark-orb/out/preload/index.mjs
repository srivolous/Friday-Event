import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("mark", {
  describeTools: () => ipcRenderer.invoke("tools:describe"),
  callTool: (name, args) => ipcRenderer.invoke("tools:call", { name, args }),
  agentChat: (payload) => ipcRenderer.invoke("agent:chat", payload),
  agentHealth: () => ipcRenderer.invoke("agent:health"),
  agentTranscribe: (audioBuffer) => ipcRenderer.invoke("agent:transcribe", audioBuffer),
  agentSpeak: (text) => ipcRenderer.invoke("agent:speak", text),
  agentSpeakingStatus: () => ipcRenderer.invoke("agent:speaking_status"),
  ollamaChat: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  ollamaList: (host) => ipcRenderer.invoke("ollama:list", host),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url)
});
