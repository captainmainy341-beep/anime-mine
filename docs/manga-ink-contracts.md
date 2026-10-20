# Manga Ink redesign: slices and frozen contracts

Source of truth: Figma file elzBhXS8pJFAePLsUNDu6r, page "Manga Ink - Learning Screens". Exported references are in `docs/figma/manga-ink/`:
each frame has a 1440x1000 PNG (`<frame>.png`) and a node tree (`<frame>.json`) with absolute x/y/w/h (frame-relative), fills, strokes (`sw`),
fonts, sizes and letter spacing. Measure from the JSON; compare against the PNG.

| Frame | Node | PNG / JSON |
|---|---|---|
| Explore Kanji | 6:18504 | explore-kanji |
| Explore Vocab | 6:18675 | explore-vocab |
| Explore Grammar | 6:18842 | explore-grammar |
| Player Theater + Timeline | 6:19009 | player-theater |
| Anki Clean | 6:19639 | anki-clean |
| Anki Card Clean | 6:19781 | anki-card-clean |

Ignore the superseded frames Anki v2 (6:19166) and Anki Card (6:19424).

## House rules (all slices)

- Paper #F5F2EA, ink #0A0A0A, red #FF2E6E only for progress, underlines, pips, the NEW! stamp and the heatmap "today" cell.
- Fonts: Zen Kaku Gothic New (var(--font)), Dela Gothic One (var(--font-display)). Both are already loaded by css/ink-theme.css.
- 3px borders on main screens; 1.5px on the clean Anki frames (root gets `.ink-screen.ink-clean`). Black caption tags (`.ink-tag`).
- No emoji or text glyphs as icons (no ▶ ⛏ ✦ → ← ⋮ ☰ etc.). Vector icons only, via `doodle(name)` from `src/renderer/lib/doodleIcons.mjs`.
  Available names: play check close lock book image bolt flame sound spark bulb warn info back next replay plus down right up mine
  arrow menu more download sync pause minus fullscreen. Heavier stroke: set CSS `--doodle-stroke: 3` (unitless, 24-unit viewBox) on the icon or a parent.
- No halftone dots, no radial/conic/circle gradients. Line hatch only (`.ink-hatch`, 2.4px lines at 45deg, ink 50%) and only where the frame has hatch
  (the two Explore panels). The Anki frames and the Player have no hatch.
- Do not enlarge kanji beyond the frame sizes (lesson preview 52px in an 88px tile, up-next tile 60px in a 100px tile).
- Do not touch settings, the manga store, the library, the word popup (popup.mjs/popup.css) or any other finished screen.
- Keep all existing behaviour that the frames do not remove (keyboard shortcuts, cover subs, Anki browse/options/mined tabs, Learn search, etc.).
- Edit and commit only the files your slice owns. Anything else you need: report it, do not edit it.

## Shared kit (lead-owned, already in the tree, read-only for every slice)

- `src/renderer/lib/inkHeader.mjs`
  - `inkHeader({ title, label = '', value = 0, max = 0, compact = false }) -> HTMLElement` (`header.ink-hero`, compact = 84px Player header)
  - `setInkHeader(el, { title?, label?, value?, max? })` updates in place
  - `inkPercent(value, max) -> 0..100`
  - Title size: set `--ink-hero-title` on the header (Explore 44px default, Anki and Review 50px, Player 40px via compact).
- `src/renderer/css/ink-kit.css` classes: `.ink-screen` (screen root: paper, page padding 28/32/30/24, red/track vars), `.ink-clean` (1.5px rules),
  `.ink-hero*`, `.ink-track` + `.ink-track-fill` (red progress), `.ink-panel`, `.ink-card`, `.ink-hatch`, `.ink-tag`, `.ink-tag-caps`,
  `.ink-stamp` (NEW!), `.ink-underline` (150x6 red), `.ink-link` (red 3px underline), `.ink-bigbtn` (100px black Dela action), `.ink-toggle`
  (filter button, black when aria-pressed=true). Variables: `--ink-red`, `--ink-mute` (#5c5a55), `--ink-track` (#ebe7dc), `--ink-line`, `--ink-hatch`.
- `src/renderer/img/speed-lines.svg` (exported Figma rays, used by `.ink-hero`).
- `src/renderer/lib/doodleIcons.mjs` (icons listed above).
- `src/renderer/index.html` already links, after ink-theme.css: ink-kit.css, ink-explore.css, player-timeline.css, ink-anki.css, ink-anki-card.css.

## Slice table

| Slice | Goal | Owns (only these) |
|---|---|---|
| S1 Shell | 200px black nav, Learn slim tab strip, page padding hooks | src/renderer/index.html (nav markup only), src/renderer/css/ink-theme.css, src/renderer/app.mjs |
| S2 Explore view | Shared Explore screen + model | src/renderer/learn/exploreView.mjs, src/renderer/learn/exploreModel.mjs, src/renderer/css/ink-explore.css, test/exploreModel.test.mjs, test/exploreView.test.mjs |
| S3 Kanji + Vocab | Wire Kanji and Vocab into Explore, Vocab tab, See all | src/renderer/learn.mjs, src/renderer/learn/browse.mjs, src/renderer/learn/browseModel.mjs, src/renderer/css/learn-browse.css, test/learnBrowse.test.mjs, test/exploreKanjiVocab.test.mjs |
| S4 Grammar | Wire Grammar into Explore, See all = existing course | src/renderer/learn/grammar.mjs, src/renderer/learn/grammarModel.mjs, src/renderer/css/learn-grammar.css, test/learnGrammar.test.mjs, test/exploreGrammar.test.mjs |
| S5 Player | Theater layout, control bar, translation strip, Subtitles menu | src/renderer/player.mjs, src/renderer/css/player.css, test/playerInk.test.mjs |
| S6 Timeline | Subtitle timeline component + model | src/renderer/player/timeline.mjs, src/renderer/lib/subtitleTimeline.mjs, src/renderer/css/player-timeline.css, test/subtitleTimeline.test.mjs |
| S7 Anki data | reviewsByDay + createDeck/importPackage/sync IPC | src/core/ankiBrowse.js, src/core/ankiSample.js, src/main/services.js, src/main/preload.js, test/ankiActivity.test.js |
| S8 Anki overview | Anki Clean screen, heatmap model, study screen wiring | src/renderer/anki.mjs, src/renderer/lib/ankiView.mjs, src/renderer/css/ink-anki.css, src/renderer/anki/browse.mjs, src/renderer/css/anki-browse.css, test/anki-view.test.mjs, test/ankiHeatmap.test.mjs |
| S9 Anki card | Card front/back + rating bar component, card inner theme | src/renderer/anki/studyCard.mjs, src/renderer/lib/study.mjs, src/renderer/lib/studyTheme.mjs, src/renderer/lib/studyPresentation.mjs, src/renderer/css/ink-anki-card.css, test/study.test.mjs, test/ankiRating.test.mjs |

Nothing is owned twice. Stubs with the frozen signatures already exist for S2, S6 and S9, so every slice runs before the others land.

## Frozen contracts

### Layout hooks (S1 implements in ink-theme.css; S2/S3/S5/S8 rely on them)
- Nav: `#nav button[data-route]` stays; S1 adds a Japanese label per item inside the button: `<span class="nav-en">LIBRARY</span><span class="nav-ja">棚</span>`
  (Learn 勉強, Manga 漫画, Vocab 語彙, Anki カード, Settings 設定). Brand becomes `アニメ<br>マイン` in `.brand`, plus the red 40x3 mark.
  Active item = `.active` (paper bar, ink text). app.mjs routing must keep working.
- Learn tab strip (`.learn-shell-nav`, `.learn-tabs`, `.learn-tab[aria-selected]`): slim strip above the header panel; `.learn-head` hidden.
- `.page.learn:has(.ink-explore)` → padding 0 (the Explore root `.ink-screen` brings its own padding); the tab strip lines up with the 24px/32px gutters.
- `.ink-screen` roots used by S5 (`section.player.ink-screen`) and S8 (`section.page.anki.ink-screen.ink-clean`) get their padding from ink-kit.css.

### Explore (S2 implements; S3 and S4 call)
`src/renderer/learn/exploreModel.mjs`
```
export const EXPLORE_FILTERS = [['all','All'], ['new','New'], ['review','Review']];
export const UP_NEXT_LIMIT = 3;
export function nextLesson(lessons)            // first lesson with !done, else null
export function filterRows(rows, filter)       // 'all' -> all; 'new' -> status==='new'; 'review' -> status==='review'; unknown -> all
export function upNext(rows, filter, limit = UP_NEXT_LIMIT)       // filterRows(...).slice(0, limit)
export function hiddenCount(rows, filter, limit = UP_NEXT_LIMIT)  // max(0, filterRows(...).length - limit)
export function seeAllLabel(total, noun)       // 'See all 74 kanji', 'See all 24 lessons'
export function lessonNumberLabel(n)           // 3 -> '03'
```
Types:
```
ExploreLesson = { id: string, number: number, title: string, meta: string,      // meta e.g. 'Family and school · 5 kanji · about 6 min'
                  preview: string[], previewKind: 'kanji'|'text', isNew: boolean, done: boolean, start: () => void }
ExploreRow    = { id: string, tile: string, tileKind: 'kanji'|'number', title: string, sub: string,
                  status: 'new'|'review'|'learned', open: () => void }
```
`src/renderer/learn/exploreView.mjs`
```
export function mountExplore(el, props) -> { update(patch), destroy() }
props = { title, header: { label, value, max }, lesson: ExploreLesson|null,
          progress: { label, value, max },             // 'KANJI LEARNED' 12/80, 'LESSONS DONE' 3/24
          rows: ExploreRow[], filter: 'all'|'new'|'review', onFilter(filter),
          seeAll: { total, noun, onOpen }, emptyText }
```
DOM classes (frozen): `section.ink-screen.ink-explore` > `header.ink-hero` + `.ink-explore-grid` > `.ink-explore-lesson.ink-panel.ink-hatch` >
`.ink-lesson-card.ink-card` (`.ink-tag.ink-tag-caps` YOUR NEXT LESSON, `.ink-stamp` NEW! only when lesson.isNew, `h2.ink-lesson-number`, `.ink-underline`,
`.ink-lesson-meta`, `.ink-lesson-preview` > `.ink-preview-tile.is-kanji|.is-text`, `.ink-lesson-progress`, `button.ink-bigbtn.ink-explore-start`)
and `.ink-explore-upnext.ink-panel.ink-hatch` > `.ink-upnext-card.ink-card` > `.ink-explore-filters` (3 × `button.ink-toggle[data-filter]`),
`.ink-tag.ink-tag-caps` UP NEXT, `.ink-upnext-list` > ≤3 × `button.ink-row` (`.ink-row-tile.is-kanji|.is-number`, `.ink-row-title`, `.ink-row-sub`,
chevron icon `right`), `button.ink-seeall` (`.ink-link` text + `arrow` icon). Exactly one Start button.

### Kanji / Vocab / Grammar wiring (S3, S4)
- Learn tabs (learn.mjs, S3): Home, Kanji, Vocab, Grammar, Story, Stats, Settings. `VIEWS.vocab = (el, ctx, arg) => mountLevels(el, ctx, { ...arg, type: 'vocab' })`.
- `mountLevels(el, ctx, arg)`: `arg.type` 'kanji' (default) | 'vocab'; `arg.all === true` shows the existing full browse (type chips incl. Radicals and
  Mined words, level grid, tiles, search, add-word form). Explore "See all" → `ctx.go('levels', { type, all: true })` (vocab: `ctx.go('vocab', { all: true })`).
- `mountGrammar(el, ctx, arg)`: Explore by default; `arg.all === true` shows the existing course view (JLPT tabs, trail, point detail, catalogue).
  See all → `ctx.go('grammar', { all: true, jlpt })`. Row → `ctx.go('point', id)`.
- Start lesson → `ctx.go('session', { mode: 'lesson', scope, jlpt?, ids })` with the lesson's item ids (see learn/session.mjs startLesson).
- `mountPoint` and its export stay unchanged.

### Timeline (S6 implements; S5 calls)
`src/renderer/lib/subtitleTimeline.mjs`
```
export const TIMELINE_SIZE = 8;
export function currentLineIndex(cues, time)   // cues sorted [{start,end,text}] in seconds (time already offset-adjusted).
                                               // index of the cue with start <= time < end; between cues -> last cue with start <= time;
                                               // -1 before the first cue or when cues is empty
export function timelineWindow(length, current, size = TIMELINE_SIZE)  // { start, end } (end exclusive), current kept 4th (3 lines before it) when possible, clamped to [0, length]
export function pipState(index, current)       // 'past' | 'current' | 'future'
export function formatCueTime(seconds)         // 742 -> '12:22'; >= 1h -> 'h:mm:ss'
export function formatOffset(seconds)          // 0 -> '+0.0s', -0.3 -> '-0.3s'
```
`src/renderer/player/timeline.mjs`
```
export function mountTimeline(el, { onSeek(index), onOffset(delta) }) -> { setCues(cues), setCurrent(index), setOffset(seconds), destroy() }
// onOffset is called with -0.1 or +0.1
```
DOM classes: `aside.ink-timeline` > `.ink-tag` Subtitles, `.ink-timeline-track` > `.ink-timeline-rail` (+ `.ink-timeline-rail-fill` red up to current),
`ol.ink-timeline-list` > `li.ink-tl-line[.is-past|.is-current]` > `.ink-tl-pip` + `button.ink-tl-card` (`.ink-tl-time`, `.ink-tl-text`);
`.ink-timeline-offset` > `.ink-tag` Offset, `button.ink-tl-minus` (`minus` icon), `output.ink-tl-value`, `button.ink-tl-plus` (`plus` icon).

### Anki data (S7 implements; S8 calls)
- `window.api.anki.overview()` result adds `reviewsByDay: Array<{ date: 'YYYY-MM-DD', count: number }>`: last 365 days including today, ascending,
  only days with count > 0. Live: AnkiConnect `getNumCardsReviewedByDay` (collection-wide). Sample mode: deterministic sample data.
  Existing fields (decks[{name,new,learn,due,total}], today{studied,due,learning,new}, forecast, retention30, streak, minedThisWeek, mined) unchanged.
- `window.api.anki.createDeck({ name }) -> { ok: true, name }` (IPC 'anki:createDeck'; empty name rejects).
- `window.api.anki.importPackage() -> { imported: boolean, path: string|null }` (IPC 'anki:importPackage'; main opens a file dialog for .apkg/.colpkg; cancel -> { imported: false, path: null }).
- `window.api.anki.sync() -> { ok: true }` (IPC 'anki:sync').
- In sample mode the three actions reject with `Error('Switch to Live mode and connect Anki first.')`.

### Anki overview helpers (S8 implements in lib/ankiView.mjs)
```
export function heatmapLevel(count, max)                  // 0 when count<=0 or max<=0; 1 when count <= max/3; 2 when <= 2*max/3; else 3
export function heatmapModel(reviewsByDay, today = new Date())
  // -> { weeks: Array<Array<{ date, count, level, isToday, future }>> (53 columns, Monday-first 7 rows), months: [{ label: 'May', column }], max }
export function activityStats(reviewsByDay, today = new Date())
  // -> { streak, daysLearnedPct, dailyAverage }  streak = consecutive days with reviews ending today (or yesterday when today has none);
  //    daysLearnedPct = round(100 * days with reviews / days from first review (within 365) to today); dailyAverage = round(total / same day count)
```
Heatmap cells keep the frame size (17px, 4px gap); the 53-week grid scrolls horizontally inside its panel, scrolled to today on render.

### Anki card (S9 implements; S8 calls)
`src/renderer/anki/studyCard.mjs`
```
export function ratingBar(buttons, onGrade) -> HTMLElement
  // div.ink-rating > 4 × button.ink-rate.ink-rate-again|hard|good|easy[data-ease="1".."4"] with <kbd> 1..4, label, interval
export function createStudyCardView({ onReveal, onGrade, onReplay }) -> { el, update(state), destroy() }
  // state = { frontDoc, backDoc, side: 'question'|'answer', buttons: [{ ease, label, interval }], busy, hasAudio, status, tags?: string[] }
```
DOM: `section.ink-study` > `.ink-study-cards` > `.ink-study-front.ink-card` (`.ink-tag` "Front · question", `iframe.study-card` sandbox="") and
`.ink-study-back.ink-card` (`.ink-tag` "Back · answer", `iframe.study-card` sandbox="", placeholder before reveal), then `.ink-study-rate.ink-card`
(`.ink-tag` "How well did you remember it?", hint "Space shows the answer · 1 to 4 rates the card", `ratingBar`). Only Good is black.
`lib/study.mjs` keeps `easeForKey`, `gradeButtons`, `cardDocument`, `deckLabel`, `createCardDocumentCache`, `sessionSummary`, `plainSentence` signatures.
Keyboard handling stays in anki.mjs (S8) via `easeForKey`.

## Testing and checks (all slices)

- `npm test` runs `node --test` over `test/**/*.test.{js,mjs}`. There is no DOM in node tests: test pure functions; for a DOM function use a tiny
  fake `document` shim inside your own test file. Baseline before this work: 1353 tests, 0 failures, exit 0.
- Visual check: you may add your own Electron screenshot script as a new file `scripts/ink-<slice>-shot.cjs` (see `scripts/learn-smoke.cjs`, which
  uses `capturePage`) and save PNGs under `/tmp/ink-<slice>/`. Compare at 1440x1000 against `docs/figma/manga-ink/<frame>.png`.
- Every slice may also create new files named `test/fixtures/ink-<slice>-*`. No other new files outside the slice's own list.
