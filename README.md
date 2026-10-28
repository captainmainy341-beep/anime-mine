# Anime Mine

Watch anime you already own, look up Japanese words, and mine them straight into Anki.

Anime Mine is a macOS Electron app for learners who study Japanese from video files on their own computer. It is a beta. An app you package yourself is ad-hoc signed, not notarized, and not an App Store build.

There is a short project page in [`docs/index.html`](docs/index.html). GitHub Pages is not on until someone enables it in the repo settings. See [Project page](#project-page) below.

## First run

1. **Add a folder of video you own.** Open Library and choose Add folder. Subtitle files sitting next to those videos are linked automatically. Anime Mine does not download shows.
2. **Optional: Jimaku.** In Settings, under Library, turn on Jimaku auto-subtitles and paste a free API key from your [jimaku.cc](https://jimaku.cc) account. Skip this when your files already have subtitles.
3. **AnkiConnect.** Install [Anki](https://apps.ankiweb.net/) and the AnkiConnect add-on (code `2055492159`), then leave Anki open. Anime Mine uses `http://127.0.0.1:8765` (Settings, under Anki). Mining needs AnkiConnect. The bridge in [`anki-addon/`](anki-addon/README.md) is optional and adds deck options and in-app review on top of that.
4. **Optional: browser extension.** Load [`extension/`](extension/README.md) unpacked in Chrome or Firefox. In Anime Mine, open Settings, under Browser extension, and copy the port and token into the extension.

## Getting started

Requires Node.js 22.12 or newer and macOS. Audio capture and the `.app` bundle are macOS-only.

```sh
npm install
npm start
```

Run the tests:

```sh
npm test
```

Build a local app (ad-hoc signed, not notarized):

```sh
bash scripts/package-mac.sh
```

That writes `~/Applications/Anime Mine.app`. The bundle version comes from `package.json` (`0.1.0`) and the bundle id is `ai.animemine.app`. Developer ID signing and notarization, for when you have your own Apple certificate, are in [docs/mac-packaging.md](docs/mac-packaging.md). This repo does not ship a notarized binary.

## Features

- **Player with subtitle lookup**: click a word in the subtitles to see its dictionary entry, furigana, kanji and example sentences.
- **Anki mining**: send a word with its sentence, screenshot and audio clip to Anki. An optional Anki add-on bridge lives in `anki-addon/`.
- **Subtitles**: library auto-linking, optional Jimaku search, and ASS to SRT conversion.
- **AI lookup and OCR**: optional AI explanations and text recognition for manga pages and hard-sub video.
- **Manga reader**: read manga and mine vocabulary from pages.
- **Learn**: Genki-based lessons, grammar pages and short story scenes.
- **Browser extension** (`extension/`): look up and mine from pages you already watch in the browser. See [extension/README.md](extension/README.md).

## Project layout

| Path | Contents |
| --- | --- |
| `src/main` | Electron main process |
| `src/core` | Dictionary, lookup, Anki, learning and subtitle logic |
| `src/renderer` | App UI |
| `anki-addon` | Optional Anki add-on bridge |
| `extension` | Browser extension |
| `native` | Native helpers (audio, OCR, PDF) |
| `scripts/package-mac.sh` | macOS `.app` packaging and ad-hoc signing |
| `docs/` | Packaging notes and the GitHub Pages site |
| `test` | Unit tests |

## Dependency audit

Electron is pinned to the current 44.x release (`44.10.0`). `44.7.0` is inside [GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9) (compromised eMudhra TLS intermediates). `44.9.1` and later include that mitigation. Electron 45 is a new major and is not required for the fix, so the app stays on 44.

`undici` is not a runtime dependency of Anime Mine. It is an optional dependency of `@electron/get`, which only downloads the Electron binary during `npm install`. `package.json` overrides that copy to `undici@7.30.1` (patched 7.x). Packaging copies production dependencies only, so `undici` is not placed inside `Anime Mine.app`. Do not override every `undici` major to a single version; a future tool may need a different line.

`npm audit` and `npm audit --omit=dev` should both be clean after install. If a new advisory shows up only on the Electron downloader, bump the `@electron/get` undici override rather than jumping Electron majors.

## Project page

The site source is [`docs/index.html`](docs/index.html) and [`docs/site.css`](docs/site.css). [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes the `docs/` folder with GitHub Actions.

To turn the site on:

1. Merge this onto the default branch (`main`) so GitHub can see the workflow. The workflow also runs on `manga-ink-redesign`.
2. In the repo, open Settings, Pages, Build and deployment, and set Source to **GitHub Actions**.
3. The site is then `https://captainmainy341-beep.github.io/anime-mine/`.

Until the workflow is on `main`, Settings, Pages, Deploy from a branch, folder `/docs`, will serve the same `index.html`. A `.nojekyll` file is included so Jekyll does not rewrite the page.

## Fonts

Bundled fonts (Zen Kaku Gothic New, Dela Gothic One) are licensed under the SIL Open Font License 1.1. The project page loads the same families from Google Fonts so the repo does not copy the font files into `docs/`.

## License

MIT. See [LICENSE](LICENSE).
