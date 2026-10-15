// Pure model for the Netflix-style Story home: seasons, rows, the featured billboard and tile status.
// The DOM lives in storyHome.mjs.

export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

export const SEASONS = {
  N5: { number: 1, name: 'Spring: Arrival', blurb: 'A new school, a new language. Meet Mio and Sora and find your feet.', accent: '#f38bb0', mood: 'petals' },
  N4: { number: 2, name: 'Autumn: The Festival', blurb: 'A missing guitarist, a stage, a trip to Kyoto and a big decision.', accent: '#f0a35e', mood: 'leaves' },
  N3: { number: 3, name: 'Third Year: Save the Café', blurb: 'The riverside café is closing. The town has two weeks to answer.', accent: '#7cc6b4', mood: 'fireflies' },
  N2: { number: 4, name: 'Tokyo: Five Years On', blurb: 'Interviews, deadlines and a friendship tested by success.', accent: '#8fb8ff', mood: 'city' },
  N1: { number: 5, name: 'Ten Years Later', blurb: 'The promise at the school gate. Everything you have learned, once more.', accent: '#c9a7ff', mood: 'petals' },
};

const CHAPTER_TITLE = /^Chapter (\d+):\s*(.+)$/;

// "Chapter 4: かいもの" → { label: 'Chapter 4', name: 'かいもの' }. Other titles pass through.
export function titleParts(summary) {
  const match = CHAPTER_TITLE.exec(summary.title ?? '');
  if (match) return { label: `Chapter ${match[1]}`, name: match[2] };
  if (summary.lesson) return { label: `Lesson ${summary.lesson}`, name: summary.title };
  return { label: summary.jlpt ?? '', name: summary.title };
}

export function isDone(summary) {
  return Boolean(summary.completed || summary.plays > 0);
}

// What a tile says about the learner's progress, and how full its progress bar is.
// Genki lessons count the primer as the first half and the story as the second.
export function tileProgress(summary) {
  const story = isDone(summary) ? 1 : summary.saved ? Math.max(0.08, summary.resume ?? 0) : 0;
  if (!summary.primer) return { fraction: story, status: isDone(summary) ? 'done' : summary.saved ? 'saved' : 'new' };
  const learned = summary.primer.done ? 0.5 : 0;
  const fraction = learned + story * 0.5;
  const status = isDone(summary) && summary.primer.done ? 'done' : summary.saved ? 'saved' : summary.primer.done ? 'learned' : isDone(summary) ? 'story-only' : 'new';
  return { fraction, status };
}

export function statusLabel(status) {
  return { done: 'Completed', saved: 'Continue', learned: 'Learned · story next', 'story-only': 'Story done · lesson left', new: '' }[status] ?? '';
}

// The first chapter that has not been completed (saves are "in progress", so they come first).
export function nextUp(chapters) {
  return chapters.find((c) => c.saved) ?? chapters.find((c) => !isDone(c)) ?? null;
}

// One row per JLPT level with how far through it the learner is.
export function seasonRows(chapters) {
  return LEVELS.map((level) => {
    const list = chapters.filter((c) => c.jlpt === level).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (list.length === 0) return null;
    const next = nextUp(list);
    const done = list.filter(isDone).length;
    return { level, ...SEASONS[level], chapters: list, done, total: list.length, complete: done === list.length, nextId: next?.id ?? null, started: done > 0 || list.some((c) => c.saved) };
  }).filter(Boolean);
}

// The season the learner is in right now: the first with chapters left.
export function currentSeason(seasons) {
  return seasons.find((s) => !s.complete) ?? seasons.at(-1) ?? null;
}

export function genkiRows(list) {
  const rows = [...(list ?? [])].sort((a, b) => (a.lesson ?? 0) - (b.lesson ?? 0));
  const next = rows.find((r) => !(r.primer?.done && isDone(r))) ?? null;
  return rows.map((r) => ({ ...r, upNext: r === next }));
}

// The path follows two books: Genki I is lessons 1-12 and Genki II is 13-23.
export const GENKI_BOOKS = [
  { key: 'genki-1', name: 'Genki I', from: 1, to: 12 },
  { key: 'genki-2', name: 'Genki II', from: 13, to: 23 },
];

export function genkiBooks(rows) {
  return GENKI_BOOKS.map((book) => ({ ...book, rows: rows.filter((r) => r.lesson >= book.from && r.lesson <= book.to) })).filter((book) => book.rows.length);
}

// Rows for "Continue watching": anything with a save, newest-first is not tracked, so keep story order.
export function continueRow(all) {
  return all.filter((s) => s.saved);
}

// Billboards the home rotates through. Always at least one when there is any story.
export function featured(list) {
  const seasons = seasonRows(list.chapters ?? []);
  const season = currentSeason(seasons);
  const out = [];
  const resume = continueRow([...(list.chapters ?? []), ...(list.genki ?? [])])[0];
  const mainNext = season ? (list.chapters ?? []).find((c) => c.id === season.nextId) : null;
  if (resume) out.push({ kind: 'continue', scene: resume, season: seasons.find((s) => s.level === resume.jlpt) ?? null });
  else if (mainNext) out.push({ kind: season.started ? 'next' : 'start', scene: mainNext, season });
  const genki = genkiRows(list.genki).find((r) => r.upNext);
  if (genki && (!resume || resume.id !== genki.id)) out.push({ kind: 'genki', scene: genki, season: null });
  if (mainNext && resume && resume.id !== mainNext.id && !out.some((f) => f.scene.id === mainNext.id)) out.push({ kind: 'next', scene: mainNext, season });
  return out.slice(0, 3);
}

export function heroCopy(item) {
  const parts = titleParts(item.scene);
  const season = item.season;
  const eyebrow = item.kind === 'genki' ? `Genki path · Lesson ${item.scene.lesson}` : season ? `Season ${season.number} · ${season.level} · ${parts.label}` : parts.label;
  const cta = item.kind === 'continue' ? 'Continue' : item.kind === 'genki' ? (item.scene.primer?.done ? 'Play story' : 'Start lesson') : item.scene.plays > 0 ? 'Play again' : 'Play';
  return { eyebrow, title: parts.name, summary: item.scene.summary || '', cta, parts };
}

// Overall story progress for the header ring.
export function storyProgress(list) {
  const chapters = list.chapters ?? [];
  const done = chapters.filter(isDone).length;
  const genki = list.genki ?? [];
  const lessons = genki.filter((g) => g.primer?.done && isDone(g)).length;
  return { done, total: chapters.length, percent: chapters.length ? Math.round((done / chapters.length) * 100) : 0, lessons, lessonTotal: genki.length };
}

// How the detail sheet lays out its buttons for one scene.
export function sheetActions(summary) {
  const hasPrimer = Boolean(summary.primer);
  const primerDone = Boolean(summary.primer?.done);
  const play = summary.saved ? 'Continue' : isDone(summary) ? 'Play again' : hasPrimer && !primerDone ? 'Skip to the story' : 'Play';
  return {
    lesson: hasPrimer ? (primerDone ? 'Review the lesson' : 'Learn first') : null,
    lessonPrimary: hasPrimer && !primerDone,
    play,
    playPrimary: !hasPrimer || primerDone,
    restart: summary.saved ? 'Start over' : null,
  };
}

// "Today" nudges shown under the billboard. Keep it short; at most two.
export function nudges(list) {
  const out = [];
  const genki = genkiRows(list.genki).find((r) => r.upNext);
  if (genki && !genki.primer?.done) out.push({ id: 'lesson', text: `Warm up with Lesson ${genki.lesson}: ${genki.primer?.minutes ?? 8} minutes`, scene: genki.id, action: 'lesson' });
  const saved = continueRow([...(list.chapters ?? []), ...(list.genki ?? [])]);
  if (saved.length) out.push({ id: 'resume', text: `${saved.length} scene${saved.length === 1 ? '' : 's'} waiting where you left off`, scene: saved[0].id, action: 'play' });
  return out.slice(0, 2);
}
