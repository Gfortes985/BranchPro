const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("bp", {
  platform: process.platform,
  ping: () => "pong",
});
