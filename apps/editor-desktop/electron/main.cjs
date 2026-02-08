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
let windows = [];

const dirtyByWC = new Map();          // webContents.id -> boolean
const pendingSave = new Map();        // token -> { resolve }


function isDirty(win) {
  if (!win) return false;
  return !!dirtyByWC.get(win.webContents.id);
}

function requestSaveFromWindow(win) {
  return new Promise((resolve) => {
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    pendingSave.set(token, { resolve });
    // шлём команду "save" вместе с token
    win.webContents.send("menu:action", "save", token);
  });
}


function extractBranchproArg(argv) {
  const p = (argv || []).find(
    (a) => typeof a === "string" && a.toLowerCase().endsWith(".branchpro")
  );
  return p || null;
}

function sendOpenToWindow(win, filePath) {
  if (!win) return;
  // ждём пока renderer готов
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("open-file", filePath);
    });
  } else {
    win.webContents.send("open-file", filePath);
  }
}

function createWindow() {
  const win = new BrowserWindow({
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
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // ✅ в билде надёжнее так:
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  windows.push(win);
  win.on("closed", () => {
    windows = windows.filter((w) => w !== win);
  });

  return win;
}


async function handleOpenBranchProFile(filePath) {
  // выбираем “текущее” окно — фокусное, либо первое
  const focused = BrowserWindow.getFocusedWindow();
  const currentWin = focused || windows[0];

  // если окон нет — создадим
  if (!currentWin) {
    const win = createWindow();
    sendOpenToWindow(win, filePath);
    return;
  }

  // ✅ если приложение уже запущено — показываем диалог выбора
  const res = await dialog.showMessageBox(currentWin, {
    type: "question",
    title: "Открыть проект BranchPro",
    message: "Как открыть этот проект?",
    detail: path.basename(filePath),
    buttons: ["Открыть в текущем окне", "Открыть в новом окне", "Отмена"],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });

  if (res.response === 2) return; // cancel

  if (res.response === 0) {
  // ✅ открыть в текущем
  // если грязный — спросим про сохранение
  if (isDirty(currentWin)) {
    const ask = await dialog.showMessageBox(currentWin, {
      type: "warning",
      title: "BranchPro",
      message: "Сохранить изменения текущего проекта?",
      buttons: ["Да", "Нет", "Отмена"],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });

    if (ask.response === 2) return; // Отмена

    if (ask.response === 0) {
      // Да -> сохраняем
      const saveRes = await requestSaveFromWindow(currentWin);

      // если пользователь отменил SaveAs или сохранение упало
      if (!saveRes?.ok) return;
    }
    // Нет -> просто продолжаем
  }

  sendOpenToWindow(currentWin, filePath);
}
 else if (res.response === 1) {
    // новое окно
    const win = createWindow();
    sendOpenToWindow(win, filePath);
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // ✅ если уже запущено и пользователь кликнул файл → сюда прилетает argv
  app.on("second-instance", async (_event, argv) => {
    const filePath = extractBranchproArg(argv);
    if (filePath) await handleOpenBranchProFile(filePath);

    const focused = BrowserWindow.getFocusedWindow() || windows[0];
    if (focused) {
      if (focused.isMinimized()) focused.restore();
      focused.focus();
    }
  });

  app.whenReady().then(async () => {
    const win = createWindow();

    // ✅ если запустили приложение двойным кликом по файлу (первый старт)
    const filePath = extractBranchproArg(process.argv);
    if (filePath) {
      // при первом старте — без диалога (обычно так удобнее)
      sendOpenToWindow(win, filePath);
    }
  });
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

ipcMain.handle("project:openBundleAtPath", async (_e, filePath) => {
  // тут reuse твоей логики openBundle, но без dialog.showOpenDialog
  // filePath — это путь к .branchpro

  const zipBuf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(zipBuf);

  const projectText = await zip.file("project.json").async("string");
  const project = JSON.parse(projectText);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "branchpro-"));
  mediaRoot = tempRoot;

  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("media/")) continue;
    const buf = await zip.file(name).async("nodebuffer");
    const outPath = path.join(tempRoot, name);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
  }

  return { ok: true, project, mediaRoot: tempRoot, path: filePath };
});

ipcMain.on("project:dirty", (e, dirty) => {
  dirtyByWC.set(e.sender.id, !!dirty);
});

ipcMain.on("project:saveResult", (_e, payload) => {
  const { token, ok, path } = payload || {};
  const p = pendingSave.get(token);
  if (!p) return;
  pendingSave.delete(token);
  p.resolve({ ok: !!ok, path: path ?? null });
});
