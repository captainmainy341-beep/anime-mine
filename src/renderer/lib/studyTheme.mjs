// Presentation only: these overrides never run card scripts or alter Anki data.
export const STUDY_THEME = `
:root { --am-panel: #161a22; --am-panel-2: #1e2331; --am-line: #2a3142; --am-text: #e7eaf2; --am-muted: #a1aabc; --am-accent: #f38bb0; color-scheme: dark; }
html:has(.am-card), body.am-card { background: var(--am-panel) !important; color: var(--am-text) !important; }
body.am-card { display: block !important; min-height: 0 !important; margin: 0 !important; padding: 20px 28px !important; font: 17px/1.6 "Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif !important; text-align: left !important; overflow-wrap: break-word; }
.am-card .wrap { display: block !important; width: auto !important; max-width: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; color: inherit !important; }
.am-card header { margin-bottom: 12px; gap: 6px; }
.am-card .tags, .am-card .pitch_number { color: var(--am-muted) !important; background: var(--am-panel-2) !important; font: 11px/1.5 system-ui, sans-serif !important; padding: 2px 6px !important; border-radius: 4px; }
.am-card .jpsentence { font-size: clamp(24px, 3.4vw, 34px) !important; line-height: 2 !important; text-align: center; }
.am-card .jpsentence b, .am-card .jpsentence strong { color: var(--am-accent) !important; }
.am-card ruby rt { font-size: .38em; color: var(--am-muted); }
.am-card .am-prompt { margin: 12px 0 16px !important; }
.am-card .ensentence { color: var(--am-muted); font-size: 14px; margin-top: 8px; text-align: center; }
.am-card .am-answer-grid { display: grid; grid-template-columns: minmax(0, 1fr) 210px; gap: 24px; align-items: center; border-top: 1px solid var(--am-line); padding-top: 16px; }
.am-card .am-answer-grid > :only-child { grid-column: 1 / -1; }
.am-card .headword_section, .am-card details { min-width: 0; background: transparent !important; border: 0 !important; padding: 0 !important; margin: 0 !important; }
.am-card .vocab { gap: 10px; margin: 0 0 8px; }
.am-card .target_word { order: -1; font-size: 26px; }
.am-card .target_word::before, .am-card .target_word::after { content: none; }
.am-card .reading { font-size: 20px; }
.am-card .definitions { font-size: 18px; font-weight: 400; }
.am-card summary { color: var(--am-muted) !important; font-size: 12px !important; cursor: pointer; }
.am-card img { max-width: 100%; max-height: 170px !important; width: auto !important; height: auto !important; object-fit: contain !important; filter: none !important; border-radius: 8px; }
.am-card .images { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 8px 0; min-width: 0; clear: both; }
.am-card .images-details > summary { float: left; }
.am-card .toggle_furigana_button { display: none; }
.am-card .am-card-links { margin-top: 10px !important; }
.am-card hr:has(+ .am-card-links) { display: none; }
.am-card .am-image-toggle { position: absolute; width: 1px; height: 1px; opacity: 0; }
.am-card .am-enlarge { display: inline-block; float: right; color: var(--am-muted); font-size: 11px; cursor: pointer; }
.am-card .am-image-toggle:focus-visible + .am-enlarge { outline: 2px solid var(--am-accent); outline-offset: 3px; }
.am-card .am-image-toggle:checked ~ .images img { max-height: max(300px, 70vh) !important; }
.am-card .am-answer-grid:has(.am-image-toggle:checked) { grid-template-columns: 1fr; }
.am-card .am-image-toggle:checked + .am-enlarge .am-expand, .am-card .am-image-toggle:not(:checked) + .am-enlarge .am-collapse { display: none; }
.am-card a { color: var(--am-muted); }
.am-card hr { border: 0; border-top: 1px solid var(--am-line); margin: 16px 0; }
.am-card footer { font-size: 12px; gap: 8px; }
.am-card .cloze { color: var(--am-accent); }
@media (max-width: 600px) {
 body.am-card { padding: 20px !important; }
 .am-card .am-prompt { margin: 12px 0 16px !important; }
 .am-card .am-answer-grid { grid-template-columns: minmax(0, 1fr) 130px; gap: 16px; padding-top: 16px; }
 .am-card .target_word { font-size: 22px; }
 .am-card .reading, .am-card .definitions { font-size: 16px; }
 .am-card img { max-height: 130px !important; }
}
@media (max-width: 380px) { .am-card .am-answer-grid { grid-template-columns: 1fr; } }
`;
