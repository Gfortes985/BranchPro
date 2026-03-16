const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage } = require("electron");
const crypto = require("crypto");
const fs = require("fs/promises");
const JSZip = require("jszip");
const path = require("path");
const os = require("os");
const { Menu } = require("electron");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");


let pendingOpenFile = null;

// ===================== AUTH / LICENSE GUARD =====================

const API_BASE = "http://81.30.105.141";
const ENTITLEMENTS_URL = () => `${API_BASE}/api/entitlements`;
const LOGIN_URL = () => `${API_BASE}/api/auth/login`;
const LOGOUT_URL = () => `${API_BASE}/api/auth/logout`;
const DEVICE_PING_URL = () => `${API_BASE}/api/device/ping`;
const ME_URL = () => `${API_BASE}/api/auth/me`;


function requireApiBase() {
  if (!API_BASE) throw new Error("BRANCHPRO_API_BASE is not set");
}

// --- storage (token encrypted with Windows DPAPI via safeStorage) ---
const AUTH_STORE_PATH = path.join(app.getPath("userData"), "auth.json");

async function readAuthStore() {
  try {
    const raw = await fs.readFile(AUTH_STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeAuthStore(obj) {
  await fs.writeFile(AUTH_STORE_PATH, JSON.stringify(obj), "utf8");
}

async function clearAuthStore() {
  try { await fs.rm(AUTH_STORE_PATH, { force: true }); } catch {}
}

function getOrCreateDeviceIdSync() {
  // device id хранится в auth.json (даже без токена)
  // но для простоты — отдельный файл
  const p = path.join(app.getPath("userData"), "device.json");
  try {
    const j = JSON.parse(require("fs").readFileSync(p, "utf8"));
    if (j?.id) return String(j.id);
  } catch {}
  const id = crypto.randomUUID();
  require("fs").writeFileSync(p, JSON.stringify({ id }), "utf8");
  return id;
}

async function getTokenDecrypted() {
  const store = await readAuthStore();
  const encB64 = store?.tokenEncB64;
  if (!encB64) return null;

  try {
    const buf = Buffer.from(encB64, "base64");
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

async function setTokenEncrypted(tokenPlain) {
  const buf = safeStorage.encryptString(String(tokenPlain));
  const store = (await readAuthStore()) || {};
  store.tokenEncB64 = buf.toString("base64");
  store.updatedAt = new Date().toISOString();
  await writeAuthStore(store);
}

async function dropToken() {
  const store = (await readAuthStore()) || {};
  delete store.tokenEncB64;
  store.updatedAt = new Date().toISOString();
  await writeAuthStore(store);
}

// --- entitlements cache (in-memory) ---
let entCache = {
  ent: null,
  checkedAt: 0,
  ttlMs: 60_000 // 1 minute cache; main will re-check often enough
};

function hasProAccess(ent) {
  return !!ent && ent.isValid === true && (ent.plan === "pro" || ent.plan === "enterprise");
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

async function apiMe() {
  requireApiBase();
  const token = await getTokenDecrypted();
  if (!token) throw new Error("NO_TOKEN");

  const { res, json, text } = await fetchJson(ME_URL(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) throw new Error("UNAUTHENTICATED");

  if (!res.ok) {
    const msg = json?.message || (text ? String(text).slice(0, 400) : "") || "ME_FAILED";
    throw new Error(`ME_${res.status}: ${msg}`);
  }

  return json; // {id,email,name,...}
}


async function apiEntitlements(force = false) {
  requireApiBase();

  const now = Date.now();
  if (!force && entCache.ent && (now - entCache.checkedAt) < entCache.ttlMs) {
    return entCache.ent;
  }

  const token = await getTokenDecrypted();
  if (!token) {
    entCache = { ent: null, checkedAt: now, ttlMs: entCache.ttlMs };
    throw new Error("NO_TOKEN");
  }

  const { res, json } = await fetchJson(ENTITLEMENTS_URL(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    }

  });

  if (res.status === 401) {
    await dropToken();
    entCache = { ent: null, checkedAt: now, ttlMs: entCache.ttlMs };
    throw new Error("UNAUTHENTICATED");
  }
  if (!res.ok) {
    throw new Error(`ENTITLEMENTS_${res.status}`);
  }

  entCache = { ent: json, checkedAt: now, ttlMs: entCache.ttlMs };
  return json;
}

async function apiLogin(email, password) {
  requireApiBase();

  const device_id = getOrCreateDeviceIdSync();
  const device_name = os.hostname();

  let res, json, text;

  try {
    ({ res, json, text } = await fetchJson(LOGIN_URL(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        device: { id: device_id, name: device_name }
      })
    }));
  } catch (e) {
    // сетевые ошибки: DNS/SSL/нет доступа
    throw new Error("NETWORK_ERROR: " + (e?.message || String(e)));
  }

  if (!res.ok) {
    // Laravel часто отдаёт 422 с errors: { email: [...], password: [...] }
    if (res.status === 422 && json?.errors) {
      const parts = [];
      for (const [k, arr] of Object.entries(json.errors)) {
        if (Array.isArray(arr)) parts.push(`${k}: ${arr.join(", ")}`);
      }
      throw new Error(`LOGIN_422: ${parts.join(" | ") || "Validation error"}`);
    }

    const msg = json?.message
      || (text ? String(text).slice(0, 500) : "")
      || "LOGIN_FAILED";

    throw new Error(`LOGIN_${res.status}: ${msg}`);
  }

  if (!json?.token) {
    throw new Error("LOGIN_OK_BUT_NO_TOKEN");
  }

  await setTokenEncrypted(json.token);
  entCache.ent = null;
  entCache.checkedAt = 0;

  apiDevicePing().catch(() => {});
  return { user: json.user || null };
}
apiLogin()

async function apiLogout() {
  requireApiBase();

  const token = await getTokenDecrypted();
  try {
    if (token) {
      await fetchJson(LOGOUT_URL(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  } finally {
    await dropToken();
    entCache.ent = null;
    entCache.checkedAt = 0;
  }
}

async function apiDevicePing() {
  // если сервер требует Authorization — добавь Bearer здесь.
  // Сейчас не добавляю, потому что в описании не указано.
  if (!API_BASE) return;

  const device_id = getOrCreateDeviceIdSync();
  const name = os.hostname();

  const app_version = app.getVersion();
  const platform =
    process.platform === "win32" ? "windows" :
    process.platform === "darwin" ? "mac" : "linux";

  await fetchJson(DEVICE_PING_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id, name, app_version, platform })
  });
}

async function ensureEntitledOrThrow() {
  const ent = await apiEntitlements(false);
  if (!hasProAccess(ent)) {
    const plan = ent?.plan ?? "unknown";
    throw new Error(`NO_LICENSE_${plan}`);
  }
  return ent;
}

// ===================== simple anti-tamper (asar hash) =====================
// Это НЕ “непробиваемо”, но режет “самые простые” подмены.
async function antiTamperCheck() {
  try {
    const appPath = app.getAppPath();

    // в дев-режиме appPath обычно не .asar — не мешаем разработке
    if (!appPath.endsWith(".asar")) return;

    // hash of asar
    const buf = await fs.readFile(appPath);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");

    // TODO: сюда вставь ожидаемый hash для конкретного билда
    // Сначала собери билд, посчитай hash, вставь сюда и пересобери.
    const EXPECTED = process.env.BRANCHPRO_ASAR_SHA256 || "";

    if (EXPECTED && hash !== EXPECTED) {
      dialog.showErrorBox("BranchPro", "App integrity check failed.");
      app.quit();
    }
  } catch {
    // если не смогли проверить — решай сам: закрывать или нет.
    // Я оставлю "не закрывать", чтобы не было ложных срабатываний.
  }
}


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
  if (!win || !filePath) return;

  // ✅ если renderer ещё не готов — запомним
  pendingOpenFile = filePath;

  // и всё равно попробуем отправить после загрузки
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
    show: false,
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
  win.once("ready-to-show", () => {
    win.maximize(); // full-size window, but still windowed mode
    win.show();
  });

  win.on("closed", () => {
    windows = windows.filter((w) => w !== win);
  });

  return win;
}

function extOf(name) {
  const e = path.extname(name).toLowerCase();
  return e.startsWith(".") ? e.slice(1) : e;
}

function replaceExt(fileName, newExt) {
  return fileName.replace(/\.[^.]+$/, "") + "." + newExt;
}

function walkAndRewriteMediaPaths(project, renameMap) {
  if (!project?.nodes) return;
  for (const n of project.nodes) {
    const data = n?.data;
    const list = data?.mediaList;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (!m?.path) continue;
      const next = renameMap.get(m.path);
      if (next) m.path = next;
    }
  }
}

async function optimizeImageToWebp(buf, quality = 80) {
  // sharp сам выкинет лишние метаданные
  return sharp(buf)
    .webp({ quality, effort: 6 }) // effort 0..6 (6 = лучше сжатие)
    .toBuffer();
}

async function optimizeVideoToMp4(buffer, opts = {}) {
  const {
    crf = 28,
    preset = "medium",
    maxWidth = 1280,
    audioBitrate = "96k"
  } = opts;

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "branchpro-vid-"));
  const inPath = path.join(tmpRoot, "in.bin");
  const outPath = path.join(tmpRoot, "out.mp4");

  await fs.writeFile(inPath, buffer);

  await new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i", inPath,

      // видео
      "-vf", `scale='min(${maxWidth},iw)':-2`,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",

      // звук
      "-c:a", "aac",
      "-b:a", audioBitrate,

      // faststart удобно для мобильных
      "-movflags", "+faststart",

      outPath
    ];

    const p = spawn(ffmpegPath, args, { windowsHide: true });

    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg failed: " + err.slice(-2000)));
    });
  });

  const outBuf = await fs.readFile(outPath);

  // cleanup (best-effort)
  try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch {}

  return outBuf;
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
    await antiTamperCheck();
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
  await ensureEntitledOrThrow(); // 🔐 PRO/ENT required
  const win = BrowserWindow.getFocusedWindow()

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
  await ensureEntitledOrThrow(); // 🔐 PRO/ENT required
  const win = BrowserWindow.getFocusedWindow();

  // ✅ если путь пришёл — сохраняем туда без диалога
  let filePath = payload?.filePath;

  // иначе показываем "Save As"
  if (!filePath) {
    const isPlayerTarget = payload?.target === "player";
    const res = await dialog.showSaveDialog(win, {
      title: isPlayerTarget ? "Экспорт для Player" : "Сохранить BranchPro проект",
      defaultPath: isPlayerTarget ? "project.brplayer" : "project.branchpro",
      filters: [
        isPlayerTarget
          ? { name: "BranchPro Player Bundle", extensions: ["brplayer"] }
          : { name: "BranchPro Project", extensions: ["branchpro"] }
      ]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    filePath = res.filePath;
  }

  const zip = new JSZip();

  const optimizeLevel = payload?.optimizeLevel === "max" ? "max" : "balanced";
  const imgQuality = optimizeLevel === "max" ? 65 : 80;
  const videoOpts = optimizeLevel === "max"
    ? { crf: 32, preset: "slow", maxWidth: 960 }
    : { crf: 28, preset: "medium", maxWidth: 1280 };

    // ✅ мапа переименований: старый media path -> новый media path
  const renameMap = new Map();

// ✅ оптимизируем медиа последовательно (чтобы не убить CPU/RAM)
  const optimizedMedia = [];
  for (const m of payload.media ?? []) {
    const name = String(m.name);
    const buf = m.buffer;

    const ext = extOf(name);

  // картинки → webp
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      try {
        const outBuf = await optimizeImageToWebp(buf, imgQuality);
        const newName = replaceExt(name, "webp");

        renameMap.set(name, newName);
        optimizedMedia.push({ name: newName, buffer: outBuf });
        continue;
      } catch (e) {
        // если оптимизация упала — кладём оригинал
        optimizedMedia.push({ name, buffer: buf });
        continue;
      }
    }

  // видео → mp4
    if (["mp4", "mov", "webm"].includes(ext)) {
      try {
        const outBuf = await optimizeVideoToMp4(buf, videoOpts);
        const newName = replaceExt(name, "mp4");

        renameMap.set(name, newName);
        optimizedMedia.push({ name: newName, buffer: outBuf });
        continue;
      } catch (e) {
        optimizedMedia.push({ name, buffer: buf });
        continue;
      }
    }

    // прочее без изменений (gif и т.п.)
    optimizedMedia.push({ name, buffer: buf });
  }

  // ✅ обновляем project.json, чтобы mediaList.path смотрел на новые имена
  if (renameMap.size) {
    walkAndRewriteMediaPaths(payload.project, renameMap);
  }

  // ✅ JSON без pretty-print
  zip.file("project.json", JSON.stringify(payload.project), {
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });

  // ✅ кладём оптимизированные файлы
  for (const m of optimizedMedia) {
    zip.file(m.name, m.buffer);
  }

  // ✅ максимальное сжатие zip
  const bufOut = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });

  await fs.writeFile(filePath, bufOut);
  return { ok: true, path: filePath };
  });

ipcMain.handle("project:openBundleAtPath", async (_e, filePath) => {
  await ensureEntitledOrThrow();
  console.log("[main] openBundleAtPath:", filePath);

  const zipBuf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(zipBuf);

  // ✅ project.json
  const projEntry = zip.file("project.json");
  if (!projEntry) {
    const names = Object.keys(zip.files);
    console.log("[main] zip entries:", names);
    throw new Error(
      "В архиве нет project.json. Файлы внутри: " + names.join(", ")
    );
  }

  const projectText = await projEntry.async("string");
  const project = JSON.parse(projectText);

  // tempRoot/media/...
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "branchpro-"));
  mediaRoot = tempRoot;

  // ✅ распаковка media/*
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];

    // папки пропускаем
    if (entry.dir) continue;

    if (!name.startsWith("media/")) continue;

    const file = zip.file(name);
    if (!file) continue;

    const buf = await file.async("nodebuffer");
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

ipcMain.handle("project:getPendingOpenFile", async () => {
  const p = pendingOpenFile;
  pendingOpenFile = null;
  return p; // string | null
});

ipcMain.handle("auth:status", async () => {
  try {
    const [ent, user] = await Promise.all([
      apiEntitlements(false),
      apiMe().catch(() => null) // если вдруг /me упадёт — не ломаем UI
    ]);

    return {
      ok: true,
      entitled: hasProAccess(ent),
      entitlements: ent,
      user
    };
  } catch (e) {
    const msg = String(e?.message || e);

    // удобные коды для UI
    if (msg.includes("NO_TOKEN")) return { ok: false, error: "NO_TOKEN", entitled: false, entitlements: null, user: null };
    if (msg.includes("UNAUTHENTICATED")) return { ok: false, error: "UNAUTHENTICATED", entitled: false, entitlements: null, user: null };

    return { ok: false, error: msg, entitled: false, entitlements: null, user: null };
  }
});



ipcMain.handle("auth:login", async (_e, { email, password }) => {
  await apiLogin(email, password);
  const ent = await apiEntitlements(true);
  return { entitled: hasProAccess(ent), entitlements: ent };
});

ipcMain.handle("auth:logout", async () => {
  await apiLogout();
  return { ok: true };
});

ipcMain.handle("auth:refresh", async () => {
  const ent = await apiEntitlements(true);
  return { entitled: hasProAccess(ent), entitlements: ent };
});


ipcMain.handle("auth:forceRefresh", async () => {
  try {
    // очистим кэш entitlements, если он есть
    if (typeof entCache === "object") {
      entCache.ent = null;
      entCache.checkedAt = 0;
    }

    const [ent, user] = await Promise.all([
      apiEntitlements(true),     // <-- ВАЖНО: true = без кэша (если у тебя так реализовано)
      apiMe().catch(() => null),
    ]);

    return {
      ok: true,
      entitled: hasProAccess(ent),
      entitlements: ent,
      user,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});
