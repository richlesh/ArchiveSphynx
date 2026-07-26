![app_icon_256](app_icon_256.png)

# ArchiveSphynx v1.2.0

A cross-platform archive management tool.

*by Richard Lesh*

---

## Features

- Open and browse ZIP, 7z, RAR, JAR, TAR (.gz, .bz2, .xz, .zst), DEB, RPM, DMG, and ISO archives
- Async streaming decompression for large archives
- Drag-and-drop file reordering and external file import
- Ctrl+drag to extract files/folders directly to desktop or Finder
- Add, delete, rename, and extract entries
- Read-only mode for non-writable formats (RAR, DEB, RPM, DMG, ISO)
- Save As with format conversion between supported writable formats
- Clean macOS metadata files (`.DS_Store`, `__MACOSX`) with one click
- Configurable executable paths for gzip, bzip2, xz, zstd, and 7-zip (auto-detected)
- Built-in WASM fallback (sphynx) — 7z and compressed TAR work without CLI tools installed
- Determinate progress bars with item counts for all operations
- Settings window (save/load to `~/.archivesphynx-settings.json`)
- License key validation (HMAC-SHA256 based)
- Splash screen with donation link
- About window
- macOS, Windows, and Linux builds via electron-builder
- GitHub Actions workflows for all platforms
- Code signing support for macOS

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or later)
- npm

### Setup
```bash
git clone https://github.com/richlesh/ArchiveSphynx.git
cd ArchiveSphynx
npm install
```

### Running
```bash
npm start
```

---

## Building Distribution Packages

```bash
# All platforms and architectures
npm run dist:all

# Individual builds
npm run dist:mac:x64       # macOS Intel
npm run dist:mac:arm64     # macOS Apple Silicon
npm run dist:win:x64       # Windows x64
npm run dist:win:arm64     # Windows ARM64
npm run dist:linux:x64     # Linux x64
npm run dist:linux:arm64   # Linux ARM64
```

Output files are placed in the `dist/` folder.

---

## Project Structure

```
ArchiveSphynx/
├── main.js              # Electron main process
├── index.html           # Main window
├── styles.css           # Main window styles
├── archive.js           # Archive format backends (ZIP, TAR, 7z, RAR, etc.)
├── settings.html        # Settings window
├── settings.js          # Settings module (load/save)
├── about.html           # About dialog
├── license_dialog.html  # License key entry
├── splash.html          # Splash screen
├── packages/sphynx/     # WASM-based archive I/O (libarchive)
├── config.json          # App configuration
├── package.json         # npm/electron-builder config
├── app_icon.png/.icns/.ico  # App icons
├── doc_icon_*.png/.icns/.ico  # Document type icons
├── generate_license_key.py  # License key generator
├── sign-mac.sh          # macOS code signing script
├── tests/               # Jest test suite
└── .github/workflows/   # CI/CD workflows
```

---

## License Key

Generate a license key for a user:
```bash
python3 generate_license_key.py user@example.com
```

---

## Tech Stack

- [Electron](https://www.electronjs.org)
- [sphynx](packages/sphynx/) — WASM build of libarchive for streaming archive I/O
- [Jest](https://jestjs.io) — test framework

---

## License

GPL 3.0
