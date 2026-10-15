# Brief: "Story" visual-novel learning mode for Anime Mine

## Goal
Add a new **Story** tab to the Learn section: a visual novel where reading kanji and choosing correct grammar moves the plot forward. It must stay real study: every challenge uses the learner's current kanji/grammar items and reports results into the existing SRS.

Three scene sources, one engine:
1. **Main story (authored):** JSON chapters, one arc per JLPT level (N5 first; ship at least 3 complete N5 chapters of ~10-15 beats each, plus 1 N4 chapter). Original characters and writing only.
2. **Anime-line scenes:** short bonus scenes built from sentences the user mined from anime (reuse whatever store holds mined sentences/vocab; find it). Background = a frame grabbed from that episode via the existing ffmpeg/media code when the source file is available; fall back to the default background.
3. **AI side-quests:** generated via `src/core/ai.js` `complete()` (whatever provider the user configured). The prompt receives the target kanji/grammar list and must return strict JSON matching the scene schema; validate and reject/repair bad output; hide the feature gracefully when `aiReady()` is false. Cache generated scenes so replays cost nothing.

## Gameplay
- Dialogue box with name plate, typewriter text (click/space to skip), furigana via existing ruby helpers, backlog, auto-advance toggle, save/load slot per chapter.
- Challenge types inside scenes:
  - **Grammar choice:** a dialogue choice where only the grammatically correct line keeps the conversation going; wrong picks branch to a short "awkward" reaction then retry.
  - **Kanji reading:** type the reading in kana (romaji->kana conversion; reuse `src/core/kana.js`) to "decode" a line, sign, or letter.
  - **Kanji meaning (light):** multiple choice, used sparingly.
- Every challenge result calls the existing SRS update path for that item (same as the review session does), so play counts as review. Unknown/unseen items are introduced with a short in-story explanation card before being tested.
- Light game layer: affection/trust meter per character, chapter completion stars (accuracy), unlockable gallery of backgrounds/CGs. Keep it modest.

## Art
- Sprites/backgrounds are loaded from a **skins folder** in the user data dir (`<userData>/vn-skins/<pack>/` with a `pack.json` mapping character -> expression -> image, and background ids -> image). Document the format in `docs/vn-skins.md`.
- Default pack must be legally redistributable: either clearly CC0/CC-BY assets with a LICENSE/attribution file committed alongside, or code-drawn SVG/CSS characters and gradient backgrounds. Do **not** copy art from commercial visual novels.
- Episode-frame backgrounds as described above.

## Read first
- `src/renderer/learn.mjs` (tab registry, `VIEWS`, `TABS`, ctx)
- `src/renderer/learn/session.mjs`, `sessionModel.mjs` (how reviews grade and report results)
- `src/renderer/learn/grammar.mjs`, `grammarModel.mjs`
- `src/core/learnStore.js`, `src/core/srs.js`
- `src/main/learnHandlers.js`, `src/main/preload.js` (IPC pattern + input validation)
- `src/core/ai.js`, `src/core/kana.js`, `src/renderer/learn/ruby.mjs`

## Allowed files
- New: `src/renderer/learn/story*.mjs`, `src/renderer/learn/vn/**`, `src/core/story*.js`, `src/core/data/story/**`, `src/main/storyHandlers.js`, `src/renderer/css/story*.css`, `assets/vn/**`, `docs/vn-*.md`, `test/story*.test.{js,mjs}`
- Edit (minimal, additive): `src/renderer/learn.mjs`, `src/main/main.js` (register handlers), `src/main/preload.js` (expose story API), `src/renderer/index.html`/styles only to include the new CSS.

## Forbidden
- Changing SRS scheduling math, Anki code, library/player code, existing test expectations, `package.json` dependencies (no new deps), lockfile.
- Logging or persisting API keys; sending user data anywhere except the user's configured AI provider.

## Pattern rules
- Follow existing style: plain ES modules in renderer, CommonJS in core/main, `h()`/`fill()` from `src/renderer/lib/ui.mjs`, pure "Model" modules separated from DOM "mount" modules so logic is unit-testable.
- Validate all IPC inputs like `learnHandlers.js` does.

## Done when
- `npm test` passes (all existing tests + new ones).
- New tests cover: scene schema validation (good + malformed AI JSON), story engine stepping/branching/save-load, challenge grading (kana input, grammar choice), SRS result reporting from a challenge, skin pack loading with fallback, anime-line scene builder with and without a source video.
- Story tab mounts with the default pack and N5 chapter 1 is playable end-to-end (document a manual check in `docs/vn-notes.md`, including what you could not verify in a headless environment).
- Commit on a branch `feature/story-mode` with clear messages and push it.
