#!/bin/bash
IDENTITY="Developer ID Application: RICHARD A LESH (MMZ3Y97NTP)"
ENTITLEMENTS="node_modules/app-builder-lib/templates/entitlements.mac.plist"

sign_app() {
  local APP="$1"
  local FW="$APP/Contents/Frameworks"

  echo "=== Signing $APP ==="

  # 1. Sign all dylibs and .so files
  find "$APP" \( -name "*.dylib" -o -name "*.so" \) | while read f; do
    codesign --sign "$IDENTITY" --force --no-strict --timestamp "$f" 2>&1
  done

  # 2. Sign Electron Framework.framework internals then the framework itself
  local EF="$FW/Electron Framework.framework"
  find "$EF/Versions/A/Libraries" -type f | while read f; do
    codesign --sign "$IDENTITY" --force --no-strict --timestamp "$f" 2>&1
  done
  codesign --sign "$IDENTITY" --force --no-strict --timestamp "$EF/Versions/A/Electron Framework" 2>&1
  codesign --sign "$IDENTITY" --force --no-strict --timestamp "$EF" 2>&1

  # 3. Sign other frameworks
  find "$FW" -name "*.framework" ! -path "*/Electron Framework.framework*" | while read f; do
    codesign --sign "$IDENTITY" --force --no-strict --timestamp "$f" 2>&1
  done

  # 4. Sign helper .app bundles
  for helper in "$FW/"*.app; do
    codesign --sign "$IDENTITY" --force --no-strict --timestamp --options runtime \
      --entitlements "$ENTITLEMENTS" "$helper" 2>&1
  done

  # 5. Sign the outer app
  codesign --sign "$IDENTITY" --force --no-strict --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" "$APP" 2>&1

  echo "Verifying $APP..."
  codesign --verify --deep --strict "$APP" && echo "OK" || echo "FAILED"
}

sign_app "dist/mac/ArchiveSphinx.app"
sign_app "dist/mac-arm64/ArchiveSphinx.app"
