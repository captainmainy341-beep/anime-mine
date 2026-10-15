export const STORY_SOURCES = ['authored', 'anime', 'ai'];

export const TRANSLATE_PREF = 'storyTranslate';
const TRANSLATED_BY_DEFAULT = ['N5', 'N4'];

// Whether English shows under Japanese lines. An explicit choice wins; otherwise it is on for beginner
// (N5/N4) scenes and off for the rest.
export function translationOn(pref, scene) {
  if (typeof pref === 'boolean') return pref;
  return TRANSLATED_BY_DEFAULT.includes(scene?.jlpt);
}

// The English to render under a line, or '' when translations are hidden or the line has none.
export function translationFor(entry, on) {
  return on && typeof entry?.en === 'string' ? entry.en : '';
}

export function translateLabel(on) {
  return on ? 'Translation: on' : 'Translation: off';
}

// Backlog rows with the translation applied.
export function backlogRows(entries, on) {
  return entries.map((e) => ({ name: e.name ?? '', text: e.text, en: translationFor(e, on), bridge: e.bridge === true, explain: e.explain ?? '' }));
}

export function completionMark(summary) {
  return summary.completed || summary.plays > 0 ? 'Completed' : '';
}

export function chapterAction(summary) {
  if (summary.saved) return { label: 'Continue', secondary: 'Start over' };
  return { label: summary.plays > 0 ? 'Play again' : 'Play', secondary: null };
}

// The study card shown before an unseen item is tested.
export function introModel(item, status) {
  const tracked = status.state !== 'untracked';
  return {
    item,
    kind: item.startsWith('g:') ? 'grammar' : item.startsWith('v:') ? 'vocab' : 'kanji',
    label: status.label,
    reading: status.reading ?? '',
    meaning: status.meaning ?? '',
    note: status.note ?? '',
    tracked,
    action: status.state === 'new' ? 'Learn it' : 'Continue',
    footnote: tracked ? 'This starts the item in your reviews.' : 'Not in your study queue yet, so this will not change your reviews.',
  };
}

// One line describing what a reported challenge did to the learner's schedule.
export function reportLine(item, response) {
  if (!response?.tracked) return 'Practice only: not in your reviews yet';
  if (!response.applied) return 'Learned in story: first review comes later';
  const { prevStage, stage, group } = response.result;
  const label = group?.label ?? '';
  if (stage > prevStage) return `Review recorded: stage ${prevStage} → ${stage}${label ? ` (${label})` : ''}`;
  if (stage < prevStage) return `Review recorded: stage ${prevStage} → ${stage}`;
  return `Review recorded: stage ${stage}`;
}

export function affectionRows(overview) {
  return Object.entries(overview?.affection ?? {})
    .map(([id, entry]) => ({ id, name: entry.name, value: entry.value, percent: Math.max(0, Math.min(100, entry.value)) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function menuSections(list) {
  return {
    chapters: list.chapters,
    anime: list.anime ?? [],
    aiVisible: Boolean(list.ai?.ready),
    ai: list.ai?.scenes ?? [],
  };
}

export function pickSkin(packs, preferred) {
  const valid = packs.filter((p) => p.valid);
  return valid.some((p) => p.pack === preferred) ? preferred : null;
}

export function endSummary(summary) {
  return {
    heading: 'Scene complete',
    line: summary.total === 0 ? 'Story complete' : `${summary.firstTry} of ${summary.total} right first try`,
    revisited: summary.total - summary.firstTry,
    affection: Object.entries(summary.affection).filter(([, delta]) => delta !== 0),
    gallery: summary.gallery,
  };
}

// The HUD note for challenges that are waiting to come back.
export function pendingLabel(pending) {
  if (!pending) return '';
  return pending === 1 ? '1 to revisit' : `${pending} to revisit`;
}

const KANJI = /\p{Script=Han}/u;
const GAP = '＿';

// Splits Japanese text so each kanji can become its own tappable element.
export function splitKanji(text) {
  const out = [];
  for (const ch of String(text ?? '')) {
    const kanji = KANJI.test(ch);
    const last = out.at(-1);
    if (!kanji && last && !last.kanji) last.text += ch;
    else out.push({ text: ch, kanji });
  }
  return out;
}

const SRS_LINE = {
  started: (stage) => `In your reviews: stage ${stage}`,
  new: () => 'New: not learned yet',
  untracked: () => 'Not in your study pack (download it in Learn > Home)',
};

// The lookup card for one kanji, from story:kanji. `tested` is true when the open challenge asks about it.
export function kanjiCard(detail, { tested = false } = {}) {
  const meanings = detail.meanings ?? [];
  return {
    char: detail.char,
    meaning: meanings.slice(0, 4).join(', ') || 'No meaning available yet',
    on: (detail.on ?? []).join('、'),
    kun: (detail.kun ?? []).join('、'),
    reading: !detail.on?.length && !detail.kun?.length ? detail.reading ?? '' : '',
    facts: [detail.strokes ? `${detail.strokes} strokes` : null, detail.jlpt ? `JLPT N${detail.jlpt}` : null].filter(Boolean).join(' · '),
    words: (detail.words ?? []).map((w) => ({ text: w.text, reading: w.reading && w.reading !== w.text ? w.reading : '', gloss: w.gloss ?? '' })),
    status: SRS_LINE[detail.item?.state ?? 'untracked'](detail.item?.stage ?? 0),
    learnable: detail.item?.state === 'new',
    needsDownload: !detail.dictionaryReady,
    canDownload: detail.canDownload !== false,
    tested,
  };
}

export const PEEK_WARNING = 'This is the kanji this challenge asks about. Looking it up counts as a miss: you can still answer, but it will come back later in the scene.';

// A particle sentence around its gap.
export function particleParts(text) {
  const at = text.indexOf(GAP);
  return at < 0 ? { before: text, after: '' } : { before: text.slice(0, at), after: text.slice(at + GAP.length) };
}

// The confusion pair to open from a particle challenge: the first one that contains its answer.
export function guideFocus(guide, answer) {
  return guide?.confusions?.find((c) => c.pair.includes(answer))?.id ?? null;
}

// Genki path rows: in lesson order, with the first unfinished lesson marked as up next.
export function genkiRows(list) {
  const rows = [...(list ?? [])].sort((a, b) => (a.lesson ?? 0) - (b.lesson ?? 0));
  const next = rows.find((r) => !(r.completed || r.plays > 0));
  return rows.map((r) => ({ ...r, label: r.lesson ? `Lesson ${r.lesson}` : r.jlpt, upNext: r === next }));
}
