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
  onMenuAction: (cb) => {
    const handler = (_e, action, token) => cb(action, token);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
  onOpenFile: (cb) => {
    const handler = (_e, filePath) => cb(filePath);
    ipcRenderer.on("open-file", handler);
    return () => ipcRenderer.removeListener("open-file", handler);
  },
  openBundleAtPath: (filePath) => ipcRenderer.invoke("project:openBundleAtPath", filePath),
  setDirty: (dirty) => ipcRenderer.send("project:dirty", !!dirty),
  reportSaveResult: (token, ok, path) =>
  ipcRenderer.send("project:saveResult", { token, ok: !!ok, path: path ?? null }),
  getPendingOpenFile: () => ipcRenderer.invoke("project:getPendingOpenFile"),



});
