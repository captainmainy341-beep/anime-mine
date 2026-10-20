// Manga Ink app theme for Anki cards shown inside a sandboxed srcdoc iframe.
// Presentation only: no card scripts, remote assets or Anki data changes, and the CSP/sandbox in
// lib/study.mjs is untouched. Fonts cannot be loaded from app files inside the sandboxed frame, so the
// app font is asked for first and a system Japanese stack takes over when it is not installed.
// Measured from Figma "Anki Card Clean" (6:19781): paper #f5f2ea, ink #0a0a0a, 1.5px rules, red only
// for the target underline and the word rule.

export const STUDY_THEME = `
:root {
  --am-paper: #f5f2ea;
  --am-ink: #0a0a0a;
  --am-muted: #5c5a55;
  --am-red: #ff2e6e;
  --am-track: #ebe7db;
  --am-rule: 1.5px;
  --am-shot: 290px;
  --am-font: "Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Noto Sans CJK JP", system-ui, sans-serif;
  color-scheme: light;
}
html, body { background: var(--am-paper) !important; color: var(--am-ink) !important; }
body.am-card {
  display: block !important; margin: 0 !important; min-height: 0 !important; padding: 0 !important;
  font: 17px/1.6 var(--am-font) !important; text-align: left !important;
  overflow-wrap: anywhere; -webkit-font-smoothing: antialiased;
}
body.am-card[data-side="answer"] { padding: 0 24px !important; }
.am-card *, .am-card *::before, .am-card *::after { box-sizing: border-box; }
.am-card .wrap, .am-card .card-wrap {
  display: block !important; width: auto !important; max-width: 100% !important; min-height: 0 !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; color: inherit !important;
}
.am-card .wrap .wrap { display: block !important; width: auto !important; padding: 0 !important; border: 0 !important; }
.am-card .sent-center, .am-card .am-prompt { display: block !important; align-items: stretch !important; justify-content: flex-start !important; flex-flow: column nowrap !important; }
.am-card header { margin: 0 !important; padding: 0 !important; gap: 0 !important; }
.am-card header:empty { display: none !important; }
.am-card .tags { display: inline; color: var(--am-muted) !important; background: none !important; font: 500 13px/1.5 var(--am-font) !important; padding: 0 !important; border-radius: 0 !important; }

/* ---------- Screenshot (scene media): black plate with a 1.5px ink rule ---------- */
.am-card .am-scene { position: relative; display: block; width: 100%; margin: 0 !important; padding: 0 !important; }
.am-card .am-scene details, .am-card .images-details, .am-card .am-scene > .images-details { display: block; margin: 0 !important; padding: 0 !important; }
.am-card .am-scene details[open] > summary, .am-card .am-scene details[open] .images-details > summary { display: none !important; }
.am-card .am-scene details:not([open]) { margin-top: 24px !important; }
.am-card .am-scene details:not([open]) .am-enlarge { display: none; }
.am-card .am-scene summary { list-style: none; }
.am-card .am-scene summary::-webkit-details-marker { display: none; }
.am-card .am-scene-images { display: block !important; margin: 0 !important; padding: 0 !important; gap: 0 !important; }
.am-card .am-scene img {
  display: block; width: 100% !important; height: var(--am-shot) !important; max-width: 100% !important; max-height: none !important;
  object-fit: cover !important; object-position: center !important; background: var(--am-ink); border: var(--am-rule) solid var(--am-ink); border-radius: 0 !important;
}
.am-card .am-image-toggle { position: absolute; width: 1px; height: 1px; opacity: 0; }
.am-card .am-enlarge {
  position: absolute; top: 16px; right: 16px; z-index: 2; display: block; width: max-content;
  padding: 5px 10px; background: var(--am-paper); border: var(--am-rule) solid var(--am-ink);
  color: var(--am-ink); font: 700 11px/16px var(--am-font); letter-spacing: 0.06em; text-transform: uppercase;
  cursor: zoom-in; opacity: 0; transition: opacity 150ms ease;
}
.am-card .am-scene:hover .am-enlarge, .am-card .am-scene:focus-within .am-enlarge { opacity: 1; }
.am-card .am-image-toggle:checked ~ .am-enlarge { cursor: zoom-out; }
.am-card .am-image-toggle:checked + .am-enlarge .am-expand, .am-card .am-image-toggle:not(:checked) + .am-enlarge .am-collapse { display: none; }
.am-card .am-image-toggle:focus-visible + .am-enlarge { outline: 2px solid var(--am-ink); outline-offset: 3px; }
.am-card .am-image-toggle:checked ~ .am-scene-image img {
  width: auto !important; height: auto !important; max-height: 75vh !important; margin: 0 auto !important; object-fit: contain !important;
}
.am-card .am-scene-image { display: block; cursor: zoom-in; }

/* ---------- Prompt sentence ---------- */
body.am-card[data-side="question"] .am-sentence {
  display: block !important; margin: 32px 0 0 !important; padding: 0 !important;
  font: 900 42px/61px var(--am-font) !important; letter-spacing: 0 !important; color: var(--am-ink) !important; text-align: left !important;
}
body.am-card[data-side="answer"] .am-sentence {
  display: block !important; margin: 0 !important; padding: 0 !important;
  font: 700 26px/38px var(--am-font) !important; letter-spacing: 0 !important; color: var(--am-ink) !important; text-align: left !important;
}
.am-card .am-sentence .am-target { color: inherit !important; background: none !important; font: inherit !important; border: 0 !important; padding: 0 !important; }
body.am-card[data-side="question"] .am-sentence .am-target {
  text-decoration: underline; text-decoration-color: var(--am-red); text-decoration-thickness: 6px;
  text-underline-offset: 6px; text-decoration-skip-ink: none;
}
body.am-card[data-side="answer"] .am-sentence .am-target { text-decoration: none; }
.am-card .am-sentence-reading { margin-top: 8px; }
.am-card .am-sentence-reading summary { color: var(--am-muted); font: 500 13px/1.5 var(--am-font); cursor: pointer; }
.am-card .am-sentence-reading[open] summary { margin-bottom: 6px; }

/* Front-only footnote under the sentence. */
.am-card .am-front-hint { margin: 9px 0 0 !important; font: 500 17px/25px var(--am-font) !important; color: var(--am-muted) !important; }
.am-card .am-divider { height: 2px; background: var(--am-ink); border: 0; }
body.am-card[data-side="question"] .am-divider { margin: 45px 0 0 !important; }
body.am-card[data-side="answer"] .am-divider { margin: 28px 0 0 !important; }

/* ---------- Tags as small rounded-rect chips ---------- */
.am-card .am-tags { display: flex; flex-wrap: wrap; gap: 16px; margin: 20px 0 0; padding: 0; list-style: none; }
body.am-card[data-side="answer"] .am-tags { margin: 10px 0 0; }
.am-card .am-tag {
  display: inline-flex; align-items: center; height: 30px; padding: 0 14px;
  background: transparent; border: var(--am-rule) solid var(--am-ink); border-radius: 15px;
  color: var(--am-ink); font: 500 13px/19px var(--am-font); white-space: nowrap;
}

/* ---------- Revealed answer: headword, reading, meaning ---------- */
.am-card .am-answer-grid { display: block !important; margin: 0 !important; padding: 0 !important; border: 0 !important; }
.am-card .headword_section { display: block !important; width: auto !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; }
.am-card .vocab { display: block !important; margin: 0 !important; padding: 0 !important; gap: 0 !important; }
.am-card .target_word { display: block !important; margin: 0 !important; color: var(--am-ink) !important; font: 900 76px/110px var(--am-font) !important; letter-spacing: 0 !important; }
.am-card .target_word::before, .am-card .target_word::after { content: none !important; }
.am-card .am-word-rule { display: block; width: 120px; height: 6px; margin: -6px 0 0; background: var(--am-red); }
.am-card .reading { display: block !important; margin: 10px 0 0 !important; color: var(--am-muted) !important; font: 500 22px/32px var(--am-font) !important; }
.am-card .definitions, .am-card .meaning { margin: 24px 0 0 !important; color: var(--am-ink) !important; font: 700 28px/41px var(--am-font) !important; }
.am-card .definition { border: 0 !important; background: transparent !important; margin: 0 !important; padding: 0 !important; }
.am-card .am-spotlight > .word { color: var(--am-muted); font: 500 17px/25px var(--am-font); margin: 0 0 6px; }

/* Pitch-accent add-on content stays a quiet plate next to the headword. */
.am-card .pitch { float: right; width: 176px; margin: 0 0 0 16px !important; padding: 6px 10px; border: var(--am-rule) solid var(--am-ink); background: transparent !important; }
.am-card .pitch_number, .am-card .pitch-number { display: block; margin: 0 0 4px; color: var(--am-muted) !important; font: 700 11px/16px var(--am-font) !important; letter-spacing: 1px !important; text-transform: uppercase; }

/* ---------- Sentence, translation, source ---------- */
body.am-card[data-side="answer"] .am-prompt { margin: 18px 0 0 !important; padding: 0 !important; }
.am-card .ensentence, .am-card .translation {
  margin: 4px 0 0 !important; padding: 0 !important; border: 0 !important;
  color: var(--am-muted) !important; font: 500 20px/29px var(--am-font) !important; text-align: left !important; background: none !important;
}
.am-card .ensentence a.hint, .am-card .translation a.hint { display: none !important; }
.am-card .ensentence div.hint, .am-card .translation div.hint { display: block !important; }
.am-card .am-source {
  margin: 37px 0 0 !important; padding: 14px 0 0 !important; border: 0 !important; border-top: 2px solid var(--am-track) !important;
  color: var(--am-muted) !important; font: 500 15px/22px var(--am-font) !important; text-align: left !important; background: none !important;
}
.am-card .notes { margin: 10px 0 0; color: var(--am-muted) !important; font: 500 15px/22px var(--am-font) !important; }
.am-card .am-card-links { margin: 24px 0 0 !important; }
.am-card .am-card-links summary, .am-card details > summary { color: var(--am-muted); font: 500 13px/1.6 var(--am-font); cursor: pointer; }
.am-card footer { color: var(--am-muted); font: 500 13px/1.6 var(--am-font); gap: 8px; }
.am-card a { color: var(--am-muted); }
.am-card a:hover { color: var(--am-ink); }
.am-card hr { border: 0; border-top: 2px solid var(--am-track); margin: 24px 0; }
.am-card ruby rt { font-size: 0.4em; color: var(--am-muted); }
.am-card .cloze { color: inherit; text-decoration: underline; text-decoration-color: var(--am-red); text-decoration-thickness: 3px; text-decoration-skip-ink: none; }
.am-card img { max-width: 100%; height: auto; border-radius: 0 !important; filter: none !important; }
.am-card .am-image-toggle:checked ~ .am-scene-image img { height: auto !important; }
.am-card .toggle_furigana_button { display: none; }

/* The study iframe is ~524px wide at the 1440 frame, so this is only for genuinely narrow cards. */
@media (max-width: 380px) {
  body.am-card[data-side="question"] .am-sentence { font-size: 32px !important; line-height: 46px !important; margin-top: 20px !important; }
  body.am-card[data-side="answer"] .am-sentence { font-size: 22px !important; line-height: 32px !important; }
  .am-card .target_word { font-size: 54px !important; line-height: 78px !important; }
  .am-card .am-word-rule { margin-top: -4px; }
  .am-card .definitions, .am-card .meaning { font-size: 22px !important; line-height: 33px !important; margin-top: 16px !important; }
  .am-card .am-scene img { height: 180px !important; }
  body.am-card[data-side="question"] .am-divider { margin-top: 28px !important; }
  .am-card .pitch { float: none; width: auto; margin: 12px 0 0 !important; }
}
`;
