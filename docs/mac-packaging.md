# macOS packaging

`scripts/package-mac.sh` builds `Anime Mine.app` from the Electron binary in `node_modules`. It does not produce a notarized download, and it does not need an Apple Developer certificate to finish.

## What the script changes

A stock `Electron.app` reports Electron's own version and bundle id (`com.github.Electron`, and `CFBundleShortVersionString` / `CFBundleVersion` equal to the Electron version, such as `44.7.0`). The script:

1. Copies `Electron.app` and replaces the default app with this repo's `src`, `native`, and production `node_modules` (`fflate`, `ffmpeg-static`, `kuromoji`, and their dependencies). Electron's install-time dependencies, including `undici`, are not copied into the bundle.
2. Renames the executable to `Anime Mine`. Helper executables stay `Electron Helper`, because Electron looks them up by that filename.
3. Writes `CFBundleName`, `CFBundleDisplayName`, `CFBundleExecutable`, `CFBundleIdentifier` (`ai.animemine.app`), `CFBundleShortVersionString`, and `CFBundleVersion` from `package.json`. Helper and framework ids that still say `com.github.Electron…` are rewritten to the `ai.animemine.app…` prefix, and their version strings are updated too.
4. Signs the bundle from the inside out (deepest Mach-O, then each `.framework` and helper `.app`, then the main executable, then the `.app`). It does **not** sign with `codesign --deep`. `--deep` while signing is what left the previous build with "a sealed resource is missing or invalid": Electron Framework is a versioned bundle, and `--deep` seals a parent before the children inside it.
5. Fails the build unless `codesign --verify --deep --strict --verbose=2` passes. `--deep` on **verify** is the check, not the signature.

The default signature is ad-hoc (`codesign --sign -`). Ad-hoc signatures are not timestamped and do not enable the hardened runtime.

## Build

On a Mac, from the repo root, with Node.js 22.12 or newer:

```sh
npm install
bash scripts/package-mac.sh
```

The app is written to `~/Applications/Anime Mine.app`. Pass a parent directory to write it somewhere else:

```sh
bash scripts/package-mac.sh /tmp
```

`npm run package:mac` is the same script.

## Check the result

```sh
APP="$HOME/Applications/Anime Mine.app"
defaults read "$APP/Contents/Info" CFBundleShortVersionString
defaults read "$APP/Contents/Info" CFBundleVersion
defaults read "$APP/Contents/Info" CFBundleIdentifier
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv "$APP"
```

Expect version `0.1.0` (whatever `package.json` says), identifier `ai.animemine.app`, and `valid on disk` / `satisfies its Designated Requirement`.

`spctl -a -vv` on this ad-hoc app should **not** report a missing or invalid sealed resource. Gatekeeper will still reject it, because an ad-hoc signature has no Developer ID certificate. That rejection is expected. Opening the app the first time takes the usual right-click Open, or `xattr -cr` on a copy you trust.

## Developer ID

When a Developer ID Application certificate is in the login keychain:

```sh
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
bash scripts/package-mac.sh
```

That path enables the hardened runtime and the entitlements in:

| File | Used for |
| --- | --- |
| `scripts/entitlements.mac.plist` | Main app and other nested code. JIT and unsigned executable memory for V8, plus audio input. |
| `scripts/entitlements.mac.gpu.plist` | `Electron Helper (GPU).app` |
| `scripts/entitlements.mac.renderer.plist` | `Electron Helper (Renderer).app` |
| `scripts/entitlements.mac.plugin.plist` | `Electron Helper (Plugin).app`, including library validation disabled for plugins |

No Apple certificate is stored in this repo. If `CODESIGN_IDENTITY` is unset, the script stays on the ad-hoc path.

## Notarization

Notarization is off unless you set `NOTARIZE=1`. The script cannot notarize an ad-hoc signature, and it does not claim success unless `notarytool` and `stapler` both exit 0.

Preferred (password stays in the keychain, not on the command line):

```sh
xcrun notarytool store-credentials animemine-notary \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export NOTARIZE=1
export APPLE_KEYCHAIN_PROFILE="animemine-notary"
bash scripts/package-mac.sh
```

Or pass the Apple ID pieces for a single run: `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`. The password is handed to `notarytool` and is not printed back.

After a stapled build, `spctl -a -vv "$APP"` can report `accepted` and `source=Notarized Developer ID`. This repository does not ship that build. There is no notarized binary to download.
