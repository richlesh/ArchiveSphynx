# ArchiveSphynx — Technology Stack

## Runtime & Framework
- **Electron** ^41.3.0 — cross-platform desktop shell (Chromium + Node.js)
- **Node.js** v18+ required
- **Module system** — CommonJS (`"type": "commonjs"` in package.json)

## Dev Dependencies
| Package | Version | Used For |
|---|---|---|
| `electron` | ^41.3.0 | App runtime |
| `electron-builder` | ^26.8.1 | Cross-platform distribution packaging |

## Build & Distribution
- **electron-builder** handles packaging for all platforms
- App ID: `com.richardlesh.archivesphynx`
- Artifact naming: `ArchiveSphynx-{version}-{arch}.{ext}`

### Build Targets
| Platform | Format |
|---|---|
| macOS | DMG |
| Windows | NSIS installer |
| Linux | DEB + RPM (x64 and arm64) |

### Build Commands
```bash
npm start                  # Development run
npm run dist:mac:x64       # macOS Intel
npm run dist:mac:arm64     # macOS Apple Silicon
npm run dist:win:x64       # Windows x64
npm run dist:win:arm64     # Windows ARM64
npm run dist:linux:x64     # Linux x64
npm run dist:linux:arm64   # Linux ARM64
npm run dist:all           # All platforms sequentially
```

## Utility Script
- `generate_license_key.py` — standalone Python script for license key generation (standard library only)

## Persisted Data
- Settings file: `~/.archivesphynx-settings.json` (written by main process via `fs` module)
