# ArchiveSphinx — Product Overview

## Purpose
ArchiveSphinx is a cross-platform archive management tool built with Electron. It provides settings persistence, license key validation, splash screen, and about window.

## Version
1.0.0

## Key Features

### Settings Window
- Save/load settings to `~/.archivesphinx-settings.json`
- Ready for app-specific settings to be added

### License Key Validation
- HMAC-SHA256 based license key system
- License key entry window
- Splash screen nag for unlicensed users
- Python utility for generating keys

### Splash Screen
- Displays on launch for unlicensed users
- Donation link to Glowing Cat Software
- Auto-dismisses after 20 seconds or on click

### About Window
- Shows app version, Electron version, credits
- Links to website and GitHub issues
- Shows "thank you" message for licensed users

### Build & Distribution
- macOS, Windows, and Linux builds via electron-builder
- GitHub Actions workflows for all platforms
- macOS code signing and notarization support

## Target Users
Users who need a cross-platform archive management tool.
