# Story mode: implementation notes and manual check

## How it fits together

| Layer | Files |
| --- | --- |
| Scene schema, validation, AI repair | `src/core/storySchema.js` |
| Authored chapters (JSON) | `src/core/data/story/n5-ch1..3.json`, `n4-ch1.json`, loaded by `src/core/storyContent.js` |
| Anime-line scenes | `src/core/storyAnime.js` |
| AI side quests + cache | `src/core/storyAi.js` (uses `ai.complete` / `ai.aiReady`) |
| Progress (completion, plays, best accuracy), saves, gallery, affection | `src/core/storyProgress.js` (`<userData>/story.json`) |
| Art packs | `src/core/storySkins.js`, format in `docs/vn-skins.md` |
| IPC | `src/main/storyHandlers.js` (registered in `main.js`, exposed in `preload.js` as `window.api.story`) |
| Engine (pure) | `src/renderer/learn/vn/engine.mjs`, `challenge.mjs`, `typewriter.mjs`, `skin.mjs`, `defaultSkin.mjs` |
| UI | `src/renderer/learn/story.mjs` (mount), `storyModel.mjs` (pure helpers), `css/story.css` |

All three scene sources (authored, anime, AI) are the same JSON scene schema and run through the same engine.

Beat types: `say`, `intro`, `choice` (grammar), `reading` (kanji), `meaning`, plus staging beats `bg`, `show`,
`hide`, `affection`, `cg` and forward-only `jump` (to a `label`).

### Mistakes: in-scene requeue (Anki-style)

A wrong answer does not retry in place. The engine (`vn/engine.mjs`, pure and unit-tested):

1. shows the awkward reaction (the speaker's sprite switches to `surprised` while it is on screen),
2. moves on with the story,
3. puts the challenge back in a per-scene queue, due a number of *displayed beats* later: 3 after the first
   miss, then 6, then every 10 (`REQUEUE_GAPS`),
4. when it is due, plays a short bridge line ("あ、ちょっと まって。さっきの こと、もう一度 いい？" /
   "Oh, wait a second...", or a narration line for kanji) and asks again. The re-ask panel shows a
   **Once more** recap of the dialogue line that led to the challenge, and grammar/meaning options are shown in
   a rotated order so the answer is not where it was.
5. After the last beat, anything still queued is asked straight away (with a closing "before we go, one more
   thing" bridge). The scene ends only when the queue is empty.

Reporting: one report per challenge, sent when it is finally answered, with `incorrectCount` = wrong attempts
at that challenge across all re-asks. Misses report nothing. The HUD shows "N to revisit".
Saves (snapshot `v: 2`) carry the queue, the re-ask in progress and a pending "move on" if you save during an
awkward reaction. Version 1 saves still load; mistakes made on the challenge a v1 save stopped at are kept.

### Translation toggle

**Translation: on/off** in the player HUD (also in the backlog, and the `T` key) shows or hides the English
(`en`) under dialogue, awkward reactions, bridge lines, the re-ask recap and backlog entries. The choice is
stored with `ctx.prefs` as `storyTranslate`; until the learner picks, it is on for N5/N4 scenes and off for
others (`translationOn` in `storyModel.mjs`). English lines are rendered once and hidden by a stage attribute,
so toggling never restarts the typewriter or clears a typed answer. English still appears only after a line has
finished typing. Challenge *prompts* ("Ask Mio: ...") are task instructions, not translations, so they stay
visible; what the toggle controls in a challenge is the recap line's English.

### No stars

Chapter cards show a plain "✓ Completed" once played; the end screen shows "X of Y right first try", how many
challenges came back, affection and unlocks. `story.json` keeps `plays`, `bestAccuracy` and `completedAt` per
chapter. Older files that still contain `stars` load fine; the field is dropped on read, and a `stars` field
sent to `story:complete` is ignored.

### How play reports into the SRS

`story:report` is the only write path. It looks the item up with `learn:card` and, if the item is started,
calls `learn:submit` with `{ id, incorrectCount }`, exactly what the review session sends. `incorrectCount`
is the number of wrong attempts at that challenge. SRS scheduling code is untouched; the story handlers are
given the already-registered `learn:*` handler map rather than reaching into `learnStore` themselves.

Items fall into three states when a scene opens:

- **started**: no intro card; each challenge result is submitted as a review.
- **new** (available but never learned): the in-story intro card is shown. "Learn it" calls
  `learn:completeLessons`, same as finishing a Learn lesson. As in the lesson flow, the first quiz right after
  the intro is *not* submitted as a review (`introducedNow`).
- **untracked** (not in the study pack, or locked behind radicals/levels): the intro card uses the chapter's
  glossary and says it will not change reviews; challenges are practice only and nothing is submitted.

Consequence worth knowing: the kanji in the authored chapters are only tracked when the Wanikani-style study
pack has been downloaded (Learn > Home) *and* the kanji is unlocked at the learner's level. Grammar points
(`g:n5-*`, `g:n4-*`) are always trackable. Replaying a chapter submits again, same as doing reviews.

Anime-line scenes use the sentences the grammar scan already stores (`learn:card(...).animeExamples`:
video, cue time, text, matched span). The challenge is a "what does this pattern express" meaning question
(distractors are other grammar points' meanings). Frames come from `media.screenshot` at the middle of the cue,
and are stored inside the scene JSON in `<userData>/story-anime/`, so the video is only touched once.

## Decisions and deviations

- `src/core/kana.js` only exports `toHiragana`, and the renderer cannot `require` CommonJS. The renderer already
  has the equivalent romaji->kana and `toHiragana` in `src/renderer/lib/romaji.mjs` (used by the review session),
  so the kana challenge reuses `lib/romaji.mjs` and `lib/answer.mjs#checkReading`. Core uses `kana.js`'s
  `toHiragana` when validating `reading` answers.
- Affection is awarded on the first clear of a scene only, so replays cannot farm it. Best accuracy only goes up.
- Default art is code-drawn (SVG/CSS) so no third-party assets or LICENSE file are needed; `assets/vn/` is unused.
- `story:*` handlers are registered from `main.js` (allowed) instead of editing `services.js` (not in the allowed list).
- AI requests go only through `ai.complete` to the provider the learner configured. The prompt contains the
  item ids/labels/readings/meanings and nothing else; the cache stores only the validated scene JSON.
- Authored chapters are 22-27 beats in the JSON (including staging beats), 17-22 of which are things the player
  sees (dialogue, intro cards, challenges).

## Manual check: N5 chapter 1 (Electron)

1. `npm start`, open **Learn**. Confirm a **Story** tab appears between Grammar and Stats.
2. (Optional) Learn > Home: download the study pack so kanji are trackable.
3. Story tab: four cards under *Main story* (three N5, one N4). With no AI provider configured there is no
   *Side quests* section. The *Art* dropdown lists only "Default" unless you added a pack.
4. Click **Play** on "Chapter 1: はじめまして".
5. Dialogue: text types out; click the box or press Space to finish the line, again to advance. Furigana appears
   once a line finishes if "Show furigana" is on in Learn settings. The English line appears under it
   (N5 default). Press **B** for the backlog, toggle **Auto**.
6. Click **Translation: on** (or press **T**): English disappears from the box immediately; open the backlog,
   English is gone there too; toggle it back from the backlog header. Re-open the scene: the choice is remembered.
7. At the first grammar item an intro card appears ("Learn it" starts it in your reviews). Pick a wrong
   self-introduction: Mio looks surprised and reacts, the HUD shows "1 to revisit", and the story **moves on**.
   A few lines later Mio says "あ、ちょっと まって…" and the same choice comes back with a *Once more* recap and
   the options in a different order. Pick the right one: one report is sent with one mistake.
8. Kanji reading challenge (学生): type `gakusei` (it converts to がくせい as you type), press Enter.
   A wrong answer is requeued the same way; non-kana input shows a hint and costs nothing.
9. The green chip in the top bar reports what happened to the schedule, e.g. "Review recorded: stage 1 -> 2".
10. **Save** while something is waiting to be revisited, **Exit**, re-open the chapter: the card offers
    **Continue**. **Load** restores position, stage, the revisit queue and backlog.
11. Finish: "X of Y right first try", how many came back, affection (+3 Mio) and the unlocked picture appear;
    no stars anywhere. The card shows "✓ Completed"; the gallery lists "The first day". Learn > Home / Grammar
    shows the grammar points as started.
12. Anime lines: after Grammar > scan library and learning a few points, **Build scenes from my anime** adds
    cards; opened scenes use a frame from the episode as background.
13. Side quests: with an AI provider configured, **Generate a side quest** appears; generating twice for the
    same items replays the cached scene without a request.

## What was verified in this (headless) environment

- Unit/integration tests: `test/story*.test.{js,mjs}` (schema incl. malformed AI JSON and repairs, engine
  stepping/branching/save-load, grading, SRS reporting through the real `LearnStore`, skin loading and
  fallbacks, anime scene builder with and without a video, AI generation/caching, IPC validation, and a scripted
  playthrough of chapter 1).
- A throwaway Playwright + Chromium harness (not committed) mounted the real `learn.mjs` against the real story
  and learn handlers with a stubbed `window.api` bridge, and drove chapter 1 from the Story tab to the end screen:
  tab renders, cards list, typewriter/skip, intro cards, wrong-answer branch and retry, kana input,
  reports, completion, and the written `story.json`. Screenshots were inspected.

### Requeue, translation toggle and star removal (follow-up)

- Unit tests (`test/storyEngine.test.mjs`): stepping order with a miss (awkward, story continues, bridge, re-ask
  after 3 beats, then after 6), gap cap, a scene whose last beat is a challenge (requeue drains before the end,
  closing bridge), "not finished while queued", one report per challenge with the cumulative `incorrectCount`,
  option rotation and recap, save/load at every point of a re-ask (during the reaction, while waiting, on the
  bridge, on the re-ask, during the second wait), v1 saves, malformed queue entries.
  `test/storyModel.test.mjs`: translation default/override, backlog rows, end summary without stars, drawn art
  ids. `test/storyHandlers.test.js`: old `story.json` with stars loads, `completed` on cards, and the scripted
  chapter 1 playthrough now checks the miss is requeued (not retried in place) and reported exactly once.
- **Real Electron** (this time, not a Chromium harness): `xvfb-run electron --no-sandbox --disable-gpu` with
  `app.disableHardwareAcceleration()` and a temp userData, loading the real `src/main/main.js` (real preload,
  `contextBridge`, `ipcMain`, CSP). A throwaway driver (not committed) played N5 chapter 1 from Learn > Story:
  deliberate wrong first answer -> awkward reaction (surprised sprite) -> story moved on with "1 to revisit" ->
  bridge line -> re-ask with recap and rotated options -> correct; the rest correct. Checked: translation
  defaulted on for N5, the toggle hid English in the box and the backlog and wrote `learn.storyTranslate=false`,
  no `★`/`☆` on the menu or end screen, end screen "6 of 7 right first try", card "✓ Completed", and
  `story.json` holds `{ plays: 1, bestAccuracy, completedAt }` without stars. Screenshots were inspected, plus
  a contact sheet of every drawn background and character expression.
- Found and fixed on the way: choice panels printed a literal "null" (native `replaceChildren` with a null
  child), and the drawn busts had overly long necks.

## What could NOT be verified here

- (First pass only; the follow-up ran the real Electron shell, see above.)
- Idle animations (breathing, blinking, drifting clouds, swaying lanterns) are CSS; screenshots are stills, so
  the motion itself and its `prefers-reduced-motion` switch-off were checked by reading the CSS, not by eye.
- Real ffmpeg frame grabbing from a real episode (`media.screenshot` is mocked in tests; the sandbox's
  ffmpeg-static build also lacks a filter, which is why an existing media test already fails here).
- A real AI provider reply; tests use canned replies, including malformed ones.
- User skin packs with real PNG/JPG art rendered on screen (loading and path safety are tested; display of
  pack images was not).
- Audio, window resizing on small screens and keyboard-only/screen-reader use.
- The study-pack path for kanji (the test pack has no kanji), so kanji tracking is covered by mocked
  `learn:card`/`learn:submit` tests, not a live Wanikani-style pack.

## Existing test failures (not caused by this change)

On a clean checkout with `npm ci`, `npm test` already fails in this sandbox before any Story code:
`test/media.test.js` "screenshot with censorSubs ..." fails deterministically (the bundled ffmpeg lacks a filter),
and `test/desubber.test.js` / converter timing tests fail intermittently under parallel load. Everything else,
including all new Story tests, passes.
