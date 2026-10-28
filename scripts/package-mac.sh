#!/bin/bash
# Build a local macOS app bundle for Anime Mine.
#
# Ad-hoc (default, no Apple certificate):
#   bash scripts/package-mac.sh
#   bash scripts/package-mac.sh /path/to/parent
# Writes "<parent>/Anime Mine.app". Parent defaults to "$HOME/Applications".
# The bundle is ad-hoc signed from the inside out and checked with
# `codesign --verify --deep --strict`. It is not notarized. Gatekeeper will
# not treat it as an identified Developer ID app. See docs/mac-packaging.md.
#
# Developer ID, when that certificate is in the keychain:
#   export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   bash scripts/package-mac.sh
# Hardened runtime and scripts/entitlements.mac*.plist apply only in that mode.
#
# Notarization runs only when you ask for it, after a Developer ID signature.
# This script does not notarize on its own, and it has no Apple credentials.
#   export NOTARIZE=1
#   export APPLE_KEYCHAIN_PROFILE="animemine-notary"
#   # or: APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD
#   bash scripts/package-mac.sh
# "notarized and stapled" is printed only after notarytool and stapler both exit 0.

set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Anime Mine"
DEST="${1:-$HOME/Applications}/$NAME.app"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

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
cp -R native "$RES/app/native"

# Production dependencies only. Electron's installer (and its undici copy)
# stays in the dev tree and is not sealed into the app.
# macOS /bin/bash is 3.2, which has no readarray, so this is a plain read loop.
mkdir -p "$RES/app/node_modules"
if ! node scripts/mac-bundle.mjs list-prod-modules > "$BUILD/pkgs"; then
  echo "package-mac: could not list production modules" >&2
  exit 1
fi
if [[ ! -s "$BUILD/pkgs" ]]; then
  echo "package-mac: no production modules listed" >&2
  exit 1
fi
while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  src="node_modules/$pkg"
  dest="$RES/app/node_modules/$pkg"
  if [[ ! -d "$src" ]]; then
    echo "package-mac: missing $src (run npm install first)" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  rsync -a --exclude '.bin' "$src/" "$dest/"
done < "$BUILD/pkgs"

cp "$BUILD/icon.icns" "$RES/electron.icns"
mv "$DEST/Contents/MacOS/Electron" "$DEST/Contents/MacOS/$NAME"

# Version and bundle id first, then sign. Signing seals the plists.
node scripts/mac-bundle.mjs apply "$DEST"
node scripts/mac-sign.mjs "$DEST"
echo "$DEST"
