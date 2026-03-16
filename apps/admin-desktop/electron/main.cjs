const { app, BrowserWindow } = require("electron");
const path = require("path");


const isDev = !app.isPackaged; // in dev we relax webSecurity to avoid CORS issues when targeting remote fixed API

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b0b0c",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
      allowRunningInsecureContent: false,
    },
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    win.loadURL(url);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Vite build output: dist/index.html
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
