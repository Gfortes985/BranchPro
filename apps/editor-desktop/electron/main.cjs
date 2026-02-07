const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");

const path = require("node:path");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "branchpro",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);


let win = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0b0b0b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  protocol.registerFileProtocol("branchpro", (request, callback) => {
    // branchpro://media/<encoded-path>
    const prefix = "branchpro://media/";
    const url = request.url;

    if (!url.startsWith(prefix)) {
      return callback({ error: -324 }); // ERR_INVALID_URL
    }

    const encodedPath = url.slice(prefix.length);
    const filePath = decodeURIComponent(encodedPath);

    // минимальная защита: разрешаем только абсолютные пути
    if (!/^[a-zA-Z]:\\/.test(filePath) && !filePath.startsWith("/")) {
      return callback({ error: -324 });
    }

    callback({ path: filePath });
  });

  createWindow();
});


app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("pickMedia", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"] }]
  });

  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});
