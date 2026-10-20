# Handoff — Anime Mine "ink/doodle manga" redesign

Source session: ~/.pi/agent/sessions/--Users-magsbalingit--/2026-10-20T08-54-54-810Z_01a15885-525a-7678-b711-3c426f24b6a3.jsonl (13 MB, over the 400k limit; do not load it, grep it only if needed).

## Project
~/projects/anime-mine — Electron app (watch anime, word lookup, mine to Anki). Areas: Library, Player, Word popup, Vocab, Anki browse, Manga, Settings, Learn, Story, VN.

## Figma
File: figma.com/design/elzBhXS8pJFAePLsUNDu6r (needs the Figma Desktop Bridge plugin running).
Pages: Design System ("Ink Tokens" vars, "Manga/" text styles), Components, Screens (colored Story Home), Doodle Direction (Doodle + "Story Home — Clean Ink"), Motion (4 Smart Animate prototypes: button, episode card, nav item, word popup; ease-out expo cubic-bezier(.23,1,.32,1); spec table).

## Decisions by the user
- Feel: artistic, diverse manga, black and white, thin lines, lots of craft animations.
- Went from doodly -> less doodly -> thinner clean ink. Red accent only (#FF2E6E-ish): NEW! stamp, short underlines, progress.
- NEVER use emojis or emoji-like glyphs (▶ ⛏ ✦ etc.). Use doodle-style drawn icons instead.
- Apply the user's saved Figma design rules (Lenny/Anshu workflow, FIGMA_DESIGN_WORKFLOW in ~/.pi/agent/extensions/lib/orchestrator-v2/figma-mode.mjs).

## Code state (uncommitted in anime-mine)
Modified: src/renderer/{anki.mjs,anki/browse.mjs,css/manga.css,index.html,learn/lesson.mjs,learn/story.mjs,learn/storyHome.mjs,lib/{ankiDeckOptions,mangaReader,studyPresentation,studyTheme,wordCard}.mjs,manga/reader.mjs,player.mjs,styles.css}, scripts/manga-vocab-smoke.cjs, test/{manga-reader,study}.test.mjs, test/fixtures/study/browser-check.js.
New: src/renderer/css/ink-theme.css, src/renderer/fonts/, src/renderer/lib/doodleIcons.mjs, test/fixtures/study/spotlight-check.js.
Last action in progress: replacing emoji glyphs with doodle icons; two imports landed inside a multi-line import statement and must be fixed, then patch the Anki glyphs.

## Left to do
1. Fix the broken imports; finish removing every emoji/glyph (renderer + Anki card templates) using doodleIcons.mjs.
2. Run the test suite and screenshot Learn, Story, Player, Anki to verify.
3. Known Figma issues: ▶ on watch button still emoji; NEW! overflows its ring; doodle styles are plain shapes not components; old Ink components/screens on other pages to archive once direction is chosen.
4. Next screens: Player with word popup, Learn/Genki, Library, Anki; then write the Motion CSS into the app.
5. Do not commit or deploy without the user's approval.
