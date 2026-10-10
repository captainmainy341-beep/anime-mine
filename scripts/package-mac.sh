#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
NAME="Anime Mine"
DEST="${1:-$HOME/Applications}/$NAME.app"
BUILD=$(mktemp -d)

swiftc -O scripts/icon.swift -o "$BUILD/icon" 2>/dev/null
"$BUILD/icon" "$BUILD/icon.png"
mkdir "$BUILD/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon.png" --out "$BUILD/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$BUILD/icon.png" --out "$BUILD/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$BUILD/icon.iconset" -o "$BUILD/icon.icns"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
ditto node_modules/electron/dist/Electron.app "$DEST"
RES="$DEST/Contents/Resources"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app"
cp package.json package-lock.json "$RES/app/"
cp -R src "$RES/app/src"
rsync -a --exclude electron --exclude .bin node_modules/ "$RES/app/node_modules/"
cp "$BUILD/icon.icns" "$RES/electron.icns"

mv "$DEST/Contents/MacOS/Electron" "$DEST/Contents/MacOS/$NAME"
PLIST="$DEST/Contents/Info.plist"
for kv in "CFBundleName:$NAME" "CFBundleDisplayName:$NAME" "CFBundleExecutable:$NAME" "CFBundleIdentifier:ai.animemine.app"; do
  /usr/libexec/PlistBuddy -c "Set :${kv%%:*} ${kv#*:}" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :${kv%%:*} string ${kv#*:}" "$PLIST"
done
codesign --force --deep -s - "$DEST" >/dev/null 2>&1
rm -rf "$BUILD"
echo "$DEST"
