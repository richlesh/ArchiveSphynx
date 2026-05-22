const { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const nodeCrypto = require("crypto");
const { load, save } = require("./settings");
const { LICENSE_SALT } = require("./license.js");

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

app.name = "ArchiveSphynx";

app.setAboutPanelOptions({
  applicationName: "ArchiveSphynx",
  applicationVersion: require("./package.json").version,
  credits: `by Richard Lesh\nBuilt with Electron v${process.versions.electron}`,
  website: "https://glowingcatsoftware.com/ArchiveSphynx.html",
  iconImage: appIcon
});

let mainWin, settingsWin;
let menuState = { hasArchive: false, canSave: false, hasSelection: false, canNewFolder: false };
const openFiles = new Map(); // filePath -> BrowserWindow

ipcMain.handle("register-open-file", (_e, filePath) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (filePath) openFiles.set(filePath, win);
});

ipcMain.handle("unregister-open-file", (_e, filePath) => {
  if (filePath) openFiles.delete(filePath);
});

ipcMain.handle("set-dirty", (_e, isDirty) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win) win.isDirty = isDirty;
});

ipcMain.handle("set-saving", (_e, isSaving) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (win) win.isSaving = isSaving;
});

let menuRebuildTimer = null;

ipcMain.handle("update-menu-state", (_e, state) => {
  menuState = state;
  if (menuRebuildTimer) clearTimeout(menuRebuildTimer);
  menuRebuildTimer = setTimeout(() => { menuRebuildTimer = null; buildMenu(); }, 100);
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
    width: bounds.width || 1100,
    height: bounds.height || 780,
    x: bounds.x,
    y: bounds.y,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  win.loadFile("index.html");
  win.isDirty = false;
  win.isSaving = false;
  win.on("close", (e) => {
    if (win.isSaving) {
      e.preventDefault();
      return;
    }
    if (win.isDirty) {
      e.preventDefault();
      dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Save", "Don't Save", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: "Do you want to save changes before closing?",
      }).then(({ response }) => {
        if (response === 0) {
          win.webContents.send("request-save");
          win.isDirty = false;
          win.close();
        } else if (response === 1) {
          win.isDirty = false;
          win.close();
        }
        // response === 2 (Cancel): do nothing
      });
      return;
    }
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
  const s = menuState;
  const send = (ch) => () => { const w = BrowserWindow.getFocusedWindow() || mainWin; w?.webContents.send(ch); };
  const template = [
    {
      label: app.name,
      submenu: [
        { label: "About ArchiveSphynx", click: showAbout },
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
        { label: "New Archive", accelerator: "CmdOrCtrl+N", click: send("menu-new") },
        { label: "Open Archive…", accelerator: "CmdOrCtrl+O", click: send("menu-open") },
        { label: "Save Archive", accelerator: "CmdOrCtrl+S", enabled: s.canSave, click: send("menu-save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", enabled: s.hasArchive, click: send("menu-saveas") },
        { type: "separator" },
        { label: "Add Files/Folders…", accelerator: "CmdOrCtrl+Shift+A", enabled: s.hasArchive, click: send("menu-add") },
        { label: "New Folder", accelerator: "CmdOrCtrl+Shift+N", enabled: s.canNewFolder, click: send("menu-new-folder") },
        { label: "Delete", accelerator: "Delete", enabled: s.hasSelection, click: send("menu-delete") },
        { type: "separator" },
        { label: "Extract…", accelerator: "CmdOrCtrl+E", enabled: s.hasArchive, click: send("menu-extract") },
        { type: "separator" },
        { label: "Test Integrity", accelerator: "CmdOrCtrl+T", enabled: s.hasArchive, click: send("menu-test") },
        { label: "Clean macOS", enabled: s.hasArchive, click: send("menu-clean") },
        { type: "separator" },
        { role: "close" }
      ]
    },
    { role: "editMenu" },
    {
      label: "Window",
      role: "window",
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
          { type: "separator" },
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
    width: 400,
    height: 290,
    resizable: false,
    parent: mainWin,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  licenseWin.setMenuBarVisibility(false);
  licenseWin.loadFile("license_dialog.html");
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
    width: 450,
    height: 580,
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

ipcMain.handle("new-in-new-window", (_e, filePath) => {
  const win = createWindow();
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("new-archive-path", filePath);
  });
});

ipcMain.handle("dialog-open", async (_e, opts) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  const result = await dialog.showOpenDialog(win, opts);
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle("dialog-save", async (_e, opts) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  const result = await dialog.showSaveDialog(win, opts);
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("browse-file", async (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  const result = await dialog.showOpenDialog(win, { properties: ["openFile"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("tar-save", async (_e, { srcFile, entriesFile, outFile, tempDir }) => {
  const fsMod = require("fs");
  const entries = JSON.parse(fsMod.readFileSync(entriesFile, "utf8"));
  if (tempDir) { try { fsMod.unlinkSync(entriesFile); } catch {} }
  else { fsMod.unlinkSync(entriesFile); }
  const fdIn = srcFile ? fsMod.openSync(srcFile, "r") : null;
  const fdOut = fsMod.openSync(outFile, "w");
  let outPos = 0;
  const cpBuf = Buffer.allocUnsafe(8 * 1024 * 1024);
  const total = entries.length;
  const sender = _e.sender;

  const offsets = [];
  for (let idx = 0; idx < total; idx++) {
    const entry = entries[idx];
    const size = entry.isDir ? 0 : (entry.size || 0);
    // Write GNU @LongLink header for long names
    if (entry.name.length > 100) {
      const linkData = Buffer.from(entry.name + "\0");
      const linkHeader = Buffer.alloc(512);
      linkHeader.write("././@LongLink", 0);
      linkHeader.write("0000000\0", 100);
      linkHeader.write("0000000\0", 108);
      linkHeader.write("0000000\0", 116);
      linkHeader.write(linkData.length.toString(8).padStart(11, "0") + "\0", 124);
      linkHeader.write("00000000000\0", 136);
      linkHeader.write("        ", 148);
      linkHeader[156] = 76; // 'L' type
      linkHeader.write("ustar ", 257);
      linkHeader.write(" \0", 263);
      let ck = 0; for (let j = 0; j < 512; j++) ck += linkHeader[j];
      linkHeader.write(ck.toString(8).padStart(6, "0") + "\0 ", 148);
      fsMod.writeSync(fdOut, linkHeader, 0, 512, outPos); outPos += 512;
      fsMod.writeSync(fdOut, linkData, 0, linkData.length, outPos); outPos += linkData.length;
      const lpad = (512 - (linkData.length % 512)) % 512;
      if (lpad > 0) { fsMod.writeSync(fdOut, Buffer.alloc(lpad), 0, lpad, outPos); outPos += lpad; }
    }
    // Build regular header
    const header = Buffer.alloc(512);
    const fname = entry.name.slice(0, 100);
    header.write(fname, 0, Math.min(100, Buffer.byteLength(fname)));
    header.write((entry.mode || (entry.isDir ? 0o755 : 0o644)).toString(8).padStart(7, "0") + "\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(size.toString(8).padStart(11, "0") + "\0", 124);
    const mt = entry.mtime ? Math.floor(new Date(entry.mtime).getTime() / 1000) : 0;
    header.write(mt.toString(8).padStart(11, "0") + "\0", 136);
    header.write("        ", 148);
    // Type flag: '5'=dir, '2'=symlink, '0'=file
    if (entry.isDir) header[156] = 53;
    else if (entry.type === "symlink") header[156] = 50;
    else header[156] = 48;
    // Linkname for symlinks (bytes 157-256)
    if (entry.linkname) header.write(entry.linkname.slice(0, 100), 157);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let cksum = 0;
    for (let j = 0; j < 512; j++) cksum += header[j];
    header.write(cksum.toString(8).padStart(6, "0") + "\0 ", 148);
    fsMod.writeSync(fdOut, header, 0, 512, outPos);
    outPos += 512;
    offsets.push(outPos); // data starts here
    if (!entry.isDir && entry.type !== "symlink" && size > 0) {
      if (entry.offset !== undefined && fdIn !== null) {
        let remaining = size;
        let srcPos = entry.offset;
        while (remaining > 0) {
          const toRead = Math.min(cpBuf.length, remaining);
          const n = fsMod.readSync(fdIn, cpBuf, 0, toRead, srcPos);
          fsMod.writeSync(fdOut, cpBuf, 0, n, outPos);
          srcPos += n;
          outPos += n;
          remaining -= n;
        }
      } else if (entry.filePath) {
        const fdSrc = fsMod.openSync(entry.filePath, "r");
        let remaining = size;
        let srcPos = 0;
        while (remaining > 0) {
          const toRead = Math.min(cpBuf.length, remaining);
          const n = fsMod.readSync(fdSrc, cpBuf, 0, toRead, srcPos);
          fsMod.writeSync(fdOut, cpBuf, 0, n, outPos);
          srcPos += n;
          outPos += n;
          remaining -= n;
        }
        fsMod.closeSync(fdSrc);
      } else if (entry.data) {
        const buf = Buffer.from(entry.data, "base64");
        fsMod.writeSync(fdOut, buf, 0, buf.length, outPos);
        outPos += buf.length;
      }
      const pad = (512 - (size % 512)) % 512;
      if (pad > 0) { fsMod.writeSync(fdOut, Buffer.alloc(pad), 0, pad, outPos); outPos += pad; }
    }
    if (idx % 100 === 0) sender.send("tar-save-progress", idx + 1, total);
  }
  sender.send("tar-save-progress", total, total);
  fsMod.writeSync(fdOut, Buffer.alloc(1024), 0, 1024, outPos);
  if (fdIn !== null) fsMod.closeSync(fdIn);
  fsMod.closeSync(fdOut);
  if (tempDir) { try { fsMod.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  return offsets;
});

ipcMain.handle("show-message", async (_e, opts) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  await dialog.showMessageBox(win, opts);
});

ipcMain.handle("show-skipped-files", async (_e, message) => {
  const parent = BrowserWindow.fromWebContents(_e.sender);
  const skipWin = new BrowserWindow({
    width: 700,
    height: 350,
    resizable: true,
    parent,
    modal: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  skipWin.setMenuBarVisibility(false);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Files Skipped</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#1e1e1e;color:#e0e0e0;padding:20px;display:flex;flex-direction:column;height:100vh}
h1{font-size:16px;margin-bottom:12px}pre{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;background:#252525;border-radius:6px;padding:12px;border:1px solid #3a3a3a}
button{margin-top:12px;align-self:flex-end;padding:7px 24px;background:#0a84ff;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}</style></head>
<body><h1>\u26A0\uFE0F Files Skipped</h1><pre>The following files were not added:\n\n${message.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre>
<button onclick="require('electron').ipcRenderer.invoke('close-skipped-files')">OK</button></body></html>`;
  skipWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  ipcMain.handleOnce("close-skipped-files", () => skipWin?.close());
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

ipcMain.on("start-drag", (_e, filePaths) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win) return;
  setImmediate(() => {
    const icon = nativeImage.createFromPath(path.join(__dirname, "app_icon_256.png")).resize({ width: 48, height: 48 });
    win.webContents.startDrag({
      files: filePaths,
      icon,
    });
  });
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
  const lower = filePath.toLowerCase();
  const supported = [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz", ".tar.xz", ".txz", ".tar.zstd", ".tar.zst", ".tzst", ".tzs", ".7z", ".rar", ".jar", ".deb", ".rpm", ".dmg", ".iso"];
  if (!supported.some((ext) => lower.endsWith(ext))) return;
  if (lower.endsWith(".tar.zstd") || lower.endsWith(".tar.zst") || lower.endsWith(".tzst") || lower.endsWith(".tzs")) {
    const { isZstdAvailable } = require("./archive");
    if (!isZstdAvailable()) {
      dialog.showErrorBox("Cannot Open Archive", "Zstandard (zstd) command-line tool is not installed or not found.\nPlease install zstd and configure its path in Settings.");
      return;
    }
  }
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
