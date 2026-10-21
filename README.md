# Anime Mine

Watch anime, look up Japanese words, and mine them straight into Anki.

Anime Mine is an Electron desktop app for learners who study Japanese from the media they already enjoy.

## Features

- **Player with subtitle lookup**: click a word in the subtitles to see its dictionary entry, furigana, kanji and example sentences.
- **Anki mining**: send a word with its sentence, screenshot and audio clip to Anki, with an optional Anki add-on bridge (`anki-addon/`).
- **Subtitles**: library auto-linking, Jimaku subtitle search, and ASS to SRT conversion.
- **AI lookup and OCR**: optional AI explanations and text recognition for manga pages and hard-sub video.
- **Manga reader**: read manga and mine vocabulary from pages.
- **Learn**: Genki-based lessons, grammar pages and short story scenes.
- **Browser extension** (`extension/`): mine from streaming sites. See [extension/README.md](extension/README.md).

## Getting started

Requires Node.js 20+ and macOS (audio capture and packaging are macOS-oriented).

```sh
npm install
npm start
```

Run the tests:

```sh
npm test
```

## Project layout

| Path | Contents |
| --- | --- |
| `src/main` | Electron main process |
| `src/core` | Dictionary, lookup, Anki, learning and subtitle logic |
| `src/renderer` | App UI |
| `anki-addon` | Anki add-on bridge |
| `extension` | Browser extension |
| `native` | Native helpers (audio, OCR, PDF) |
| `test` | Unit tests |

## Fonts

Bundled fonts (Zen Kaku Gothic New, Dela Gothic One) are licensed under the SIL Open Font License 1.1.

## License

MIT. See [LICENSE](LICENSE).
