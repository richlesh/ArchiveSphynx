# ArchiveSphynx — Development Guidelines

## Code Style & Formatting

- **Quotes**: Double quotes for all strings (`"value"`, not `'value'`) — consistent across all JS files
- **Semicolons**: Always present at end of statements
- **Indentation**: 2 spaces throughout
- **Braces**: Same-line opening braces (`if (x) {`, not next-line)
- **Trailing commas**: Used in multi-line object/array literals
- **Arrow functions**: Preferred for callbacks and short handlers
- **Optional chaining**: Used freely (`win?.close()`)

## Naming Conventions

- **Variables/functions**: camelCase (`createWindow`, `openSettings`)
- **Constants**: SCREAMING_SNAKE for true constants (`SETTINGS_PATH`, `LICENSE_SALT`)
- **IPC channel names**: kebab-case strings (`"settings-save"`, `"license-cancel"`)
- **File names**: kebab-case (`settings.js`, `generate_license_key.py`)
- **HTML files**: lowercase, descriptive (`about.html`, `splash.html`, `license_dialog.html`)

## IPC Architecture Pattern

All privileged operations follow this exact pattern:

**Main process (main.js):**
```js
ipcMain.handle("channel-name", async (_event, payload) => {
  // do work
  return result;
});
```

**Renderer (inline script):**
```js
const result = await ipcRenderer.invoke("channel-name", payload);
```

- Use `ipcMain.handle` / `ipcRenderer.invoke` for request-response (async, returns value)
- Use `ipcMain.once` / `ipcRenderer.send` for one-shot events (splash close)
- First parameter of handlers is always `_event` or `_e` (underscore-prefixed when unused)

## Window Management Pattern

- Singleton windows (settings, license) use a module-level variable + guard:
  ```js
  let settingsWin;
  function openSettings() {
    if (settingsWin) return settingsWin.focus();
    settingsWin = new BrowserWindow({ ... });
    settingsWin.on("closed", () => { settingsWin = null; });
  }
  ```
- All secondary windows: `resizable: false`, `modal: true`, `parent: mainWin`, `setMenuBarVisibility(false)`
- All windows use `nodeIntegration: true, contextIsolation: false` (renderer has full Node access)
- Data passed to new windows via `webContents.send` inside `webContents.once("did-finish-load", ...)`

## Settings Module Pattern

`settings.js` is the single source of truth for persistence:

```js
const { load, save } = require("./settings");
```

- `load()` always returns a complete settings object with defaults merged in
- `save(settings)` writes the full object (caller merges first: `save({ ...existing, ...newSettings })`)

## License Key Pattern

HMAC-SHA256 based, shared between JS (main.js) and Python (generate_license_key.py):
- Salt: `"ArchiveSphynx-2026"`
- Input: `userName.toLowerCase().trim()`
- Output: first 16 hex chars, uppercased
- Validation: constant-time string comparison after normalizing to uppercase

## Error Handling

- Settings load: silent catch returns defaults (`catch { return { ...DEFAULTS }; }`)
- No global error handlers — errors surface naturally to the renderer

## Python Utility Style

- Shebang: `#!/usr/bin/env python3`
- stdlib only (no third-party deps)
- Minimal: argument validation → compute → print, no classes or extra abstraction

## Search Exclusions

- **Never search into `tests/data/`** — this directory contains test fixtures and should be excluded from grep/search operations.
- **Never search into `build/` directories** — these contain compiled output and should be excluded from grep/search operations.
- **Never search into `node_modules/` directories** — these contain node libraries and should be excluded from grep/search operations.
