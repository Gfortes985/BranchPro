const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("branchpro", {
  pickMedia: () => ipcRenderer.invoke("pickMedia"),
  mediaUrl: (absPath) => `branchpro://media/${encodeURIComponent(absPath)}`
});
