# ArchiveSphinx v1.0.0

A cross-platform archive management tool.

*by Richard Lesh*

---

## Features

- Settings window (save/load to `~/.archivesphinx-settings.json`)
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
git clone https://github.com/richlesh/ArchiveSphinx.git
cd ArchiveSphinx
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
ArchiveSphinx/
├── main.js              # Electron main process
├── index.html           # Main window
├── styles.css           # Main window styles
├── settings.html        # Settings window
├── settings.js          # Settings module (load/save)
├── about.html           # About dialog
├── license.html         # License key entry
├── splash.html          # Splash screen
├── config.json          # App configuration
├── package.json         # npm/electron-builder config
├── app_icon.png/.icns/.ico  # App icons
├── generate_license_key.py  # License key generator
├── sign-mac.sh          # macOS code signing script
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

---

## License

GPL 3.0
