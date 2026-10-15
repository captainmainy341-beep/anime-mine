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
  return entries.map((e) => ({ name: e.name ?? '', text: e.text, en: translationFor(e, on), bridge: e.bridge === true }));
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
