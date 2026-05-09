const { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const nodeCrypto = require("crypto");
const { load, save } = require("./settings");

const LICENSE_SALT = "ArchiveSphinx-2026";

function openExternal(url) {
  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    shell.openExternal(url);
  }
}

function expectedLicenseKey(userName) {
  const hmac = nodeCrypto.createHmac("sha256", LICENSE_SALT);
  hmac.update(userName.toLowerCase().trim());
  return hmac.digest("hex").slice(0, 16).toUpperCase();
}

function isValidLicense(key, userName) {
  if (!key || !userName) return false;
  return key.toUpperCase() === expectedLicenseKey(userName);
}

const appIcon = nativeImage.createFromPath(path.join(__dirname, "app_icon.icns"));

app.name = "ArchiveSphinx";

app.setAboutPanelOptions({
  applicationName: "ArchiveSphinx",
  applicationVersion: require("./package.json").version,
  credits: `by Richard Lesh\nBuilt with Electron v${process.versions.electron}`,
  website: "https://glowingcatsoftware.com/ArchiveSphinx.html",
  iconImage: appIcon
});

let mainWin, settingsWin;
const openFiles = new Map(); // filePath -> BrowserWindow

ipcMain.handle("register-open-file", (_e, filePath) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (filePath) openFiles.set(filePath, win);
});

ipcMain.handle("check-open-file", (_e, filePath) => {
  const existing = openFiles.get(filePath);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  openFiles.delete(filePath);
  return false;
});

function createWindow() {
  const settings = load();
  const bounds = settings.windowBounds || {};
  const win = new BrowserWindow({
    width: bounds.width || 1000,
    height: bounds.height || 700,
    x: bounds.x,
    y: bounds.y,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  win.loadFile("index.html");
  win.on("close", () => {
    const b = win.getBounds();
    const s = load();
    s.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    save(s);
    for (const [fp, w] of openFiles) {
      if (w === win) { openFiles.delete(fp); break; }
    }
  });
  if (!mainWin) {
    mainWin = win;
    buildMenu();
  }
  return win;
}

let aboutWin;
function showAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) return aboutWin.focus();
  aboutWin = new BrowserWindow({
    width: 320,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWin,
    modal: true,
    icon: appIcon,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  aboutWin.setMenuBarVisibility(false);
  aboutWin.loadFile("about.html");
  aboutWin.once("ready-to-show", () => {
    if (mainWin && !mainWin.isDestroyed()) {
      const [px, py] = mainWin.getPosition();
      const [pw, ph] = mainWin.getSize();
      const [w, h] = aboutWin.getSize();
      aboutWin.setPosition(Math.round(px + (pw - w) / 2), Math.round(py + (ph - h) / 2));
    }
    aboutWin.show();
  });
  aboutWin.webContents.once("did-finish-load", () => {
    aboutWin.webContents.send("icon-path", path.join(__dirname, "app_icon.png"));
    aboutWin.webContents.send("app-version", require("./package.json").version);
    const { licenseKey, userName } = load();
    if (isValidLicense(licenseKey, userName)) aboutWin.webContents.send("licensed");
  });
  ipcMain.handleOnce("close-about", () => aboutWin?.close());
  aboutWin.on("closed", () => { aboutWin = null; });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    {
      label: app.name,
      submenu: [
        { label: "About ArchiveSphinx", click: showAbout },
        { type: "separator" },
        { label: "Settings…", click: openSettings },
        { label: "License Key…", click: openLicense },
        { type: "separator" },
        ...(isMac ? [
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
        ] : []),
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "New Archive", accelerator: "CmdOrCtrl+N", click: () => mainWin?.webContents.send("menu-new") },
        { label: "Open Archive…", accelerator: "CmdOrCtrl+O", click: () => mainWin?.webContents.send("menu-open") },
        { label: "Save Archive", accelerator: "CmdOrCtrl+S", click: () => mainWin?.webContents.send("menu-save") },
        { type: "separator" },
        { label: "Add Files…", accelerator: "CmdOrCtrl+Shift+A", click: () => mainWin?.webContents.send("menu-add") },
        { label: "New Folder", accelerator: "CmdOrCtrl+Shift+N", click: () => mainWin?.webContents.send("menu-new-folder") },
        { label: "Delete", accelerator: "Delete", click: () => mainWin?.webContents.send("menu-delete") },
        { type: "separator" },
        { label: "Extract…", accelerator: "CmdOrCtrl+E", click: () => mainWin?.webContents.send("menu-extract") },
        { type: "separator" },
        { label: "Test Integrity", accelerator: "CmdOrCtrl+T", click: () => mainWin?.webContents.send("menu-test") },
        { type: "separator" },
        { role: "close" }
      ]
    },
    { role: "editMenu" },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        ...(isMac ? [{ role: "zoom" }] : []),
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Cmd+Option+I" : "Ctrl+Shift+I",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
        },
        ...(isMac ? [
          { type: "separator" },
          { role: "front" },
        ] : []),
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let licenseWin;

function openLicense() {
  if (licenseWin) return licenseWin.focus();
  licenseWin = new BrowserWindow({
    width: 360,
    height: 260,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  licenseWin.setMenuBarVisibility(false);
  licenseWin.loadFile("license.html");
  licenseWin.webContents.once("did-finish-load", () => {
    const { licenseKey, userName } = load();
    licenseWin.webContents.send("license-data", { key: licenseKey || "", userName: userName || "" });
  });
  licenseWin.on("closed", () => { licenseWin = null; });
}

ipcMain.handle("license-save", (_e, { key, userName }) => {
  if (!isValidLicense(key, userName)) return;
  const settings = load();
  settings.licenseKey = key.toUpperCase();
  settings.userName = userName;
  save(settings);
  licenseWin?.close();
});

ipcMain.handle("license-cancel", () => licenseWin?.close());

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 400,
    height: 300,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile("settings.html");
  settingsWin.on("closed", () => { settingsWin = null; });
}

ipcMain.handle("settings-get-data", () => ({ settings: load() }));

ipcMain.handle("settings-save", (_e, newSettings) => {
  const existing = load();
  save({ ...existing, ...newSettings });
  settingsWin?.close();
  mainWin?.webContents.send("settings-updated");
});

ipcMain.handle("settings-cancel", () => settingsWin?.close());

ipcMain.handle("open-external", (_e, url) => openExternal(url));

ipcMain.handle("open-in-new-window", (_e, filePath) => {
  const existing = openFiles.get(filePath);
  if (existing && !existing.isDestroyed()) { existing.focus(); return; }
  const win = createWindow();
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("open-archive-path", filePath);
  });
});

ipcMain.handle("dialog-open", async (_e, opts) => {
  const result = await dialog.showOpenDialog(mainWin, opts);
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle("dialog-save", async (_e, opts) => {
  const result = await dialog.showSaveDialog(mainWin, opts);
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("show-message", async (_e, opts) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  await dialog.showMessageBox(win, opts);
});

ipcMain.handle("show-test-result", async (_e, { type, message }) => {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay();
  const maxH = Math.round(display.workAreaSize.height * 0.75);
  const parent = BrowserWindow.fromWebContents(_e.sender);
  const resultWin = new BrowserWindow({
    width: 500,
    height: Math.min(400, maxH),
    maxHeight: maxH,
    resizable: true,
    parent,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  resultWin.setMenuBarVisibility(false);
  const icon = type === "info" ? "✅" : "⚠️";
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Test Integrity</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#1e1e1e;color:#e0e0e0;padding:20px;display:flex;flex-direction:column;height:100vh}
h1{font-size:16px;margin-bottom:12px}pre{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;background:#252525;border-radius:6px;padding:12px;border:1px solid #3a3a3a}
button{margin-top:12px;align-self:flex-end;padding:7px 24px;background:#0a84ff;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}</style></head>
<body><h1>${icon} Test Integrity</h1><pre>${message.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre>
<button onclick="require('electron').ipcRenderer.invoke('close-test-result')">OK</button></body></html>`;
  resultWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  ipcMain.handleOnce("close-test-result", () => resultWin?.close());
});

function showSplash(nagOnly) {
  const splash = new BrowserWindow({
    width: 320,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    icon: appIcon,
    parent: nagOnly ? mainWin : undefined,
    modal: !!nagOnly,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  splash.loadFile("splash.html");
  splash.webContents.once("did-finish-load", () => {
    splash.webContents.send("icon-path", path.join(__dirname, "app_icon.png"));
    splash.webContents.send("app-version", require("./package.json").version);
  });

  const handler = () => {
    if (!splash.isDestroyed()) splash.close();
    if (!nagOnly) createWindow();
  };
  ipcMain.once("splash-close", handler);
  splash.on("closed", () => ipcMain.removeListener("splash-close", handler));
}

app.whenReady().then(() => {
  const { licenseKey, userName } = load();
  if (isValidLicense(licenseKey, userName)) {
    createWindow();
  } else {
    showSplash();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!filePath.toLowerCase().endsWith(".zip")) return;
  const openInWindow = () => {
    const existing = openFiles.get(filePath);
    if (existing && !existing.isDestroyed()) { existing.focus(); return; }
    const win = createWindow();
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("open-archive-path", filePath);
    });
  };
  if (app.isReady()) openInWindow();
  else app.whenReady().then(openInWindow);
});
