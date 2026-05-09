# ArchiveSphinx — Project Structure

## Directory Layout
```
ArchiveSphinx/
├── main.js                    # Electron main process — app lifecycle, IPC, windows
├── index.html                 # Main window renderer (blank starter)
├── styles.css                 # Main window styles
├── settings.html              # Settings window UI
├── settings.js                # Settings module (load/save to disk)
├── about.html                 # About dialog
├── license.html               # License key entry
├── splash.html                # Splash/loading screen
├── config.json                # App configuration (empty, ready for extension)
├── package.json               # npm config, electron-builder config
├── app_icon.png / .icns / .ico  # App icons for all platforms
├── generate_license_key.py    # Standalone utility: license key generation
├── sign-mac.sh                # macOS code signing script
├── .gitignore
└── .github/workflows/         # GitHub Actions CI/CD
    ├── build-mac.yml
    ├── build-linux.yml
    └── build-windows.yml
```

## Core Components

### main.js — Main Process
The central orchestrator. Responsibilities:
- Electron app/window lifecycle (BrowserWindow creation, splash screen)
- IPC handlers for settings and license key
- Native menus (application menu)
- Settings, license, about, and splash window management

### index.html + styles.css — Main Window
Blank starter page. Ready for app-specific UI.

### settings.html — Settings Window
Inline renderer script. Ready for app-specific settings fields.

### settings.js — Settings Module
Node module for persistence:
- `load()` returns settings object (with defaults merged)
- `save(settings)` writes to `~/.archivesphinx-settings.json`

### license.html — License Key Window
HMAC-SHA256 validation with formatted key input (XXXX-XXXX-XXXX-XXXX).

### splash.html — Splash Screen
Shown on launch for unlicensed users. Auto-dismisses after 20s or on click.

### about.html — About Dialog
Shows version, credits, links. Shows "thank you" for licensed users.

## Architectural Patterns

### Electron IPC Pattern
- `ipcMain.handle` / `ipcRenderer.invoke` for request-response
- `ipcMain.once` / `ipcRenderer.send` for one-shot events (splash close)

### Window Management
- Singleton windows (settings, license, about) with module-level variable + guard
- All secondary windows: `resizable: false`, `modal: true`, `parent: mainWin`
- All windows use `nodeIntegration: true, contextIsolation: false`

### Single Settings File
All user preferences stored in `~/.archivesphinx-settings.json`, read/written by main process via `fs` module.
