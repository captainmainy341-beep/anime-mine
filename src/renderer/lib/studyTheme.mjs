// Presentation only: no card scripts, remote assets or Anki data changes.
export const STUDY_THEME = `
:root { --am-panel: #181c1e; --am-panel-2: #22282a; --am-line: #343b3d; --am-text: #eeeae2; --am-muted: #adb7b9; --am-accent: #edc789; color-scheme: dark; }
html:has(.am-card), body.am-card { background: var(--am-panel) !important; color: var(--am-text) !important; }
body.am-card { display: block !important; min-height: 0 !important; margin: 0 !important; padding: 24px 36px !important; font: 17px/1.6 "Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif !important; text-align: left !important; overflow-wrap: anywhere; }
.am-card .wrap, .am-card .card-wrap { display: block !important; width: auto !important; max-width: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; color: inherit !important; }
.am-card header { margin-bottom: 10px; gap: 6px; }
.am-card .tags, .am-card .pitch_number { color: var(--am-muted) !important; background: var(--am-panel-2) !important; font: 11px/1.5 system-ui, sans-serif !important; padding: 2px 6px !important; border-radius: 4px; }
.am-card .am-prompt { margin: 10px 0 20px !important; }
.am-card .am-sentence { font-size: clamp(24px, 3.1vw, 34px) !important; font-weight: 400 !important; line-height: 2 !important; text-align: left !important; color: #cbd0cf !important; }
.am-card .am-sentence .am-target { color: var(--am-accent) !important; background: #edc78912 !important; border-bottom: 2px solid #d7b478; padding: 0 .06em; font-size: 1.34em !important; font-weight: 700 !important; line-height: 1.2 !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.am-card ruby rt { font-size: .4em; color: var(--am-muted); }
.am-card .am-answer-grid { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--am-line); padding-top: 18px; margin-top: 18px; }
.am-card .headword_section, .am-card details { min-width: 0; background: transparent !important; border: 0 !important; padding: 0 !important; margin: 0 !important; }
.am-card .headword_section { display: grid; grid-template-columns: minmax(130px, .3fr) minmax(0, 1fr); align-items: center; gap: 18px; }
.am-card .vocab { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0; }
.am-card .target_word { order: -1; color: var(--am-accent); font-size: 28px; font-weight: 600; }
.am-card .target_word::before, .am-card .target_word::after { content: none; }
.am-card .reading { color: var(--am-muted); font-size: 17px; }
.am-card .definitions, .am-card .meaning { font-size: 20px; font-weight: 400; line-height: 1.7; }
.am-card .ensentence, .am-card .translation { color: var(--am-muted) !important; font: 15px/1.8 system-ui, sans-serif; margin: 0; text-align: left; border: 0; padding: 0; }
.am-card .am-answer-grid .ensentence { margin-top: 2px; }
.am-card summary { color: var(--am-muted) !important; font: 12px/1.6 system-ui, sans-serif !important; cursor: pointer; }
.am-card .am-scene { width: 100%; max-width: 100%; margin: 18px auto 0; }
.am-card .am-scene details { display: block; }
.am-card .am-scene-images { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 12px; width: 100%; margin: 0 !important; padding: 8px 0 0; }
.am-card img { max-width: 100%; width: auto !important; height: auto !important; object-fit: contain !important; filter: none !important; border-radius: 7px; }
.am-card .am-scene img { display: block; max-width: min(100%, 420px) !important; max-height: 215px !important; cursor: zoom-in; }
.am-card .am-scene .images-details > summary { float: left; color: var(--am-muted); }
.am-card .am-scene-image { display: block; clear: both; cursor: zoom-in; }
.am-card .am-image-toggle { position: absolute; width: 1px; height: 1px; opacity: 0; }
.am-card .am-enlarge { display: block; width: fit-content; margin-left: auto; color: var(--am-muted); font: 12px/1.6 system-ui, sans-serif; cursor: pointer; }
.am-card .am-image-toggle:focus-visible + .am-enlarge { outline: 2px solid var(--am-accent); outline-offset: 4px; border-radius: 2px; }
.am-card .am-image-toggle:checked ~ .am-scene-image img { max-width: 100% !important; max-height: max(340px, 75vh) !important; cursor: zoom-out; }
.am-card .am-image-toggle:checked + .am-enlarge .am-expand, .am-card .am-image-toggle:not(:checked) + .am-enlarge .am-collapse { display: none; }
.am-card .toggle_furigana_button { display: none; }
.am-card .am-card-links { margin-top: 18px !important; }
.am-card a { color: var(--am-muted); }
.am-card hr { border: 0; border-top: 1px solid var(--am-line); margin: 18px 0; }
.am-card footer { font-size: 12px; gap: 8px; }
.am-card .notes, .am-card .source { color: var(--am-muted); font-size: 12px; }
.am-card .definition { border: 0 !important; background: transparent !important; margin: 8px 0 !important; padding: 0 !important; }
.am-card .am-spotlight > .word { color: var(--am-muted); font-size: 19px; font-weight: 400; margin-bottom: 6px; }
.am-card .vocab-word { color: var(--am-accent); font-size: 24px; }
.am-card .cloze { color: var(--am-accent); }
@media (max-width: 600px) {
 body.am-card { padding: 18px 20px !important; }
 .am-card .am-sentence { font-size: 24px !important; line-height: 1.9 !important; }
 .am-card .am-scene img { max-height: 180px !important; }
 .am-card .headword_section { grid-template-columns: 1fr; gap: 8px; }
 .am-card .target_word { font-size: 25px; }
 .am-card .reading { font-size: 16px; }
 .am-card .definitions, .am-card .meaning { font-size: 18px; }
}
`;
