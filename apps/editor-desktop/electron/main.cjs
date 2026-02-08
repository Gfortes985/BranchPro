const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const fs = require("fs/promises");
const JSZip = require("jszip");
const path = require("path");
const os = require("os");
const { Menu } = require("electron");


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
let mediaRoot = null;

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

function sendMenu(action) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  win.webContents.send("menu:action", action);
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open…", accelerator: "Ctrl+O", click: () => sendMenu("open") },
        { type: "separator" },
        { label: "Save", accelerator: "Ctrl+S", click: () => sendMenu("save") },
        { label: "Save As…", accelerator: "Ctrl+Shift+S", click: () => sendMenu("saveAs") }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}


app.whenReady().then(() => {
  protocol.registerFileProtocol("branchpro", (request, callback) => {
    try {
      const url = request.url.replace("branchpro://media/", "");
      const rel = decodeURIComponent(url);

      const filePath = path.isAbsolute(rel)
        ? rel
        : (mediaRoot ? path.join(mediaRoot, rel) : rel);

      callback({ path: filePath });
    } catch (e) {
      callback({ error: -2 }); 
    }
  });
  buildMenu();
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

ipcMain.handle("project:save", async (_evt, jsonText) => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showSaveDialog(win, {
    title: "Сохранить BranchPro проект",
    defaultPath: "project.branchpro.json",
    filters: [{ name: "BranchPro Project", extensions: ["branchpro.json", "json"] }]
  });

  if (res.canceled || !res.filePath) return { ok: false, canceled: true };

  await fs.writeFile(res.filePath, jsonText, "utf8");
  return { ok: true, path: res.filePath };
});

ipcMain.handle("project:open", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win, {
    title: "Открыть BranchPro проект",
    properties: ["openFile"],
    filters: [{ name: "BranchPro Project", extensions: ["branchpro.json", "json"] }]
  });

  if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };

  const path = res.filePaths[0];
  const text = await fs.readFile(path, "utf8");
  return { ok: true, path, text };
});

ipcMain.handle("project:openBundle", async () => {
  const win = BrowserWindow.getFocusedWindow();

  const res = await dialog.showOpenDialog(win, {
    title: "Открыть BranchPro проект",
    properties: ["openFile"],
    filters: [{ name: "BranchPro Project", extensions: ["branchpro"] }]
  });

  if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };

  const zipBuf = await fs.readFile(res.filePaths[0]);
  const zip = await JSZip.loadAsync(zipBuf);

  // ✅ project.json
  const projEntry = zip.file("project.json");
  if (!projEntry) {
    const names = Object.keys(zip.files);
    throw new Error("В архиве нет project.json. Файлы внутри: " + names.join(", "));
  }

  const projectText = await projEntry.async("string");
  const project = JSON.parse(projectText);

  // tempRoot/media/...
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "branchpro-"));
  mediaRoot = tempRoot;

  // ✅ распаковка media/*
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];

    // ❗ папки пропускаем (например "media/")
    if (entry.dir) continue;

    if (!name.startsWith("media/")) continue;

    const file = zip.file(name);
    if (!file) continue;

    const buf = await file.async("nodebuffer");
    const outPath = path.join(tempRoot, name);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
  }

  return { ok: true, project, mediaRoot: tempRoot, path: res.filePaths[0] };
});

ipcMain.handle("media:setRoot", async (_e, rootPath) => {
  mediaRoot = rootPath;
  return { ok: true };
});

ipcMain.handle("file:read", async (_e, p) => {
  const rel = String(p);

  // абсолютный путь
  if (path.isAbsolute(rel)) {
    return fs.readFile(rel);
  }

  // относительный media/*
  if (rel.startsWith("media/") || rel.startsWith("media\\")) {
    if (!mediaRoot) {
      throw new Error("mediaRoot is not set, cannot read: " + rel);
    }
    const full = path.join(mediaRoot, rel);
    return fs.readFile(full);
  }

  // fallback
  return fs.readFile(rel);
});

ipcMain.handle("project:saveBundle", async (_e, payload) => {
  const win = BrowserWindow.getFocusedWindow();

  // ✅ если путь пришёл — сохраняем туда без диалога
  let filePath = payload?.filePath;

  // иначе показываем "Save As"
  if (!filePath) {
    const res = await dialog.showSaveDialog(win, {
      title: "Сохранить BranchPro проект",
      defaultPath: "project.branchpro",
      filters: [{ name: "BranchPro Project", extensions: ["branchpro"] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    filePath = res.filePath;
  }

  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(payload.project, null, 2));

  for (const m of payload.media) {
    zip.file(m.name, m.buffer);
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(filePath, buf);

  return { ok: true, path: filePath };
});

