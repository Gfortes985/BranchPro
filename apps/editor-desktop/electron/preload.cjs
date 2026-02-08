const { contextBridge, ipcRenderer } = require("electron");

let mediaRoot = null;

contextBridge.exposeInMainWorld("branchpro", {
  pickMedia: () => ipcRenderer.invoke("pickMedia"),
  mediaUrl: (absPath) => `branchpro://media/${encodeURIComponent(absPath)}`,
  saveProject: (jsonText) => ipcRenderer.invoke("project:save", jsonText),
  openProject: () => ipcRenderer.invoke("project:open"),
  readFile: (path) => ipcRenderer.invoke("file:read", path),
  saveBundle: (payload) => ipcRenderer.invoke("project:saveBundle", payload),
  openBundle: () => ipcRenderer.invoke("project:openBundle"),
  setMediaRoot: (p) => ipcRenderer.invoke("media:setRoot", p),
  onMenuAction: (handler) => {
    const listener = (_e, action) => handler(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);},

});
