import { toHiragana } from '../lib/romaji.mjs';

// Pure model for the "learn first" lesson that comes before a Genki story scene. The DOM lives in lesson.mjs.

export const SECTIONS = ['Words', 'Patterns', 'Practice'];
const WORDS_PER_ROUND = 5;
const DRILLS_PER_POINT = 2;
const XP_FIRST = 10;
const XP_RETRY = 4;
const STREAK_STEP = 3;

// Small seeded shuffle so tests (and a replayed lesson) are predictable.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// The ordered steps of a lesson: warm up with words, learn each pattern then try it, then mixed practice.
export function buildSteps(lesson) {
  const steps = [{ kind: 'intro', section: -1 }];
  chunk(lesson.vocab, WORDS_PER_ROUND).forEach((words, round) => {
    steps.push({ kind: 'cards', section: 0, round, words });
    if (words.length >= 3) steps.push({ kind: 'match', section: 0, round, words });
  });
  const used = new Set();
  lesson.points.forEach((point, index) => {
    steps.push({ kind: 'concept', section: 1, point: index });
    lesson.drills.forEach((drill, i) => {
      if (drill.point !== index || used.size >= lesson.drills.length) return;
      if ([...used].filter((u) => lesson.drills[u].point === index).length >= DRILLS_PER_POINT) return;
      used.add(i);
      steps.push({ kind: 'drill', section: 1, drill, key: i });
    });
  });
  lesson.drills.forEach((drill, i) => {
    if (!used.has(i)) steps.push({ kind: 'drill', section: 2, drill, key: i });
  });
  steps.push({ kind: 'done', section: 2 });
  return steps;
}

// Which sections exist for the progress bar (a lesson always has all three, but keep it honest).
export function sectionSpans(steps) {
  return SECTIONS.map((label, section) => {
    const indexes = steps.map((s, i) => (s.section === section ? i : -1)).filter((i) => i >= 0);
    return { label, from: indexes[0] ?? 0, to: (indexes.at(-1) ?? 0) + 1 };
  });
}

const normaliseKana = (text) => toHiragana(String(text ?? '').normalize('NFKC').replace(/\s+/g, ''));

export function gradeDrill(drill, answer) {
  if (drill.type === 'gap') return { ok: answer === drill.answer, expected: drill.answer };
  if (drill.type === 'pick') return { ok: answer === drill.answer, expected: drill.options[drill.answer] };
  if (drill.type === 'order') {
    const tiles = Array.isArray(answer) ? answer : [];
    const accepted = [drill.chunks, ...(drill.alts ?? [])];
    return { ok: accepted.some((a) => a.length === tiles.length && a.every((c, i) => c === tiles[i])), expected: drill.chunks.join('') };
  }
  const typed = normaliseKana(answer);
  return { ok: typed !== '' && drill.answers.some((a) => normaliseKana(a) === typed), expected: drill.answers[0] };
}

// Options in a stable shuffled order, with the right index mapped across.
export function shuffledPick(drill, rand) {
  const order = shuffled(drill.options.map((_, i) => i), rand);
  return { options: order.map((i) => drill.options[i]), answer: order.indexOf(drill.answer) };
}

// Tiles for a word-order puzzle: the chunks (plus decoys), never handed over already solved.
export function orderTiles(drill, rand) {
  const all = [...drill.chunks, ...(drill.extra ?? [])];
  let tiles = shuffled(all, rand);
  for (let tries = 0; tries < 6 && tiles.slice(0, drill.chunks.length).join('|') === drill.chunks.join('|'); tries += 1) tiles = shuffled(all, rand);
  return tiles;
}

// Tap-to-match game for one round of words. `pick(side, index)` returns what happened.
export function createMatchGame(words, rand) {
  const left = shuffled(words.map((w, id) => ({ id, text: w.ja, hint: w.reading })), rand);
  const right = shuffled(words.map((w, id) => ({ id, text: w.en })), rand);
  const matched = new Set();
  let pending = null;
  let misses = 0;
  return {
    left,
    right,
    get misses() { return misses; },
    get done() { return matched.size === words.length; },
    isMatched: (id) => matched.has(id),
    get pending() { return pending; },
    pick(side, index) {
      const item = (side === 'left' ? left : right)[index];
      if (!item || matched.has(item.id)) return { type: 'ignored' };
      if (!pending || pending.side === side) {
        pending = { side, index, id: item.id };
        return { type: 'pending', side, index };
      }
      const first = pending;
      pending = null;
      if (first.id === item.id) {
        matched.add(item.id);
        return { type: 'match', id: item.id, done: matched.size === words.length };
      }
      misses += 1;
      return { type: 'miss', first, second: { side, index, id: item.id } };
    },
  };
}

const PRAISE = ['Nice!', 'Exactly!', 'Great job!', 'そのとおり！', 'いいね！', 'Spot on!'];
const COMFORT = ['Close! Look at the pattern again.', 'No worries, it sticks on the second try.', 'Almost. Check the particle.', 'もう少し！'];

export function tutorLine(kind, n = 0) {
  if (kind === 'good') return PRAISE[n % PRAISE.length];
  if (kind === 'bad') return COMFORT[n % COMFORT.length];
  return '';
}

// Runs a lesson: where you are, XP, streaks, and missed drills that come back once at the end.
export function createLessonRun(lesson) {
  const steps = buildSteps(lesson);
  let index = 0;
  const stats = { scored: 0, firstTry: 0, xp: 0, streak: 0, bestStreak: 0, retries: 0, wordsSeen: 0 };
  const missed = new Set();
  const retried = new Set();

  const award = (ok, first) => {
    stats.scored += first ? 1 : 0;
    if (ok) {
      stats.streak += 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      const bonus = Math.floor(stats.streak / STREAK_STEP);
      stats.xp += (first ? XP_FIRST : XP_RETRY) + (first ? bonus : 0);
      if (first) stats.firstTry += 1;
    } else {
      stats.streak = 0;
    }
  };

  return {
    steps,
    spans: sectionSpans(steps),
    stats,
    get index() { return index; },
    get step() { return steps[index]; },
    get finished() { return steps[index].kind === 'done'; },
    progress: () => ({ index, total: steps.length - 1 }),
    // Grade a drill. A wrong first answer queues one retry at the end; retries pay less XP.
    answerDrill(step, answer) {
      const result = gradeDrill(step.drill, answer);
      const retry = retried.has(step.key);
      award(result.ok, !retry && !missed.has(step.key));
      if (!result.ok && !retry && !missed.has(step.key)) {
        missed.add(step.key);
        stats.retries += 1;
        steps.splice(steps.length - 1, 0, { kind: 'drill', section: 2, drill: step.drill, key: step.key, retry: true });
        retried.add(step.key);
      }
      return result;
    },
    // A match round: perfect rounds count as one correct item.
    finishMatch(misses) {
      award(misses === 0, true);
    },
    sawWords(count) { stats.wordsSeen += count; },
    advance() {
      if (index < steps.length - 1) index += 1;
      return steps[index];
    },
    accuracy: () => (stats.scored === 0 ? 1 : stats.firstTry / stats.scored),
  };
}

// The formula "A は B です" as colored chips: slots (A, B), single-kana particles, and fixed words.
export function formulaChips(formula) {
  return String(formula)
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, kind: /^[A-Z]/.test(text) ? 'slot' : /^[ぁ-ゖ]$/.test(text) ? 'particle' : 'word' }));
}

// An example split on `|` with its gloss captions.
export function exampleChunks(example) {
  const parts = example.ja.split('|');
  const gloss = example.gloss ? example.gloss.split('|') : [];
  return parts.map((text, i) => ({ text, gloss: gloss[i] ?? '' }));
}

export function lessonSummaryLine(run) {
  const { stats } = run;
  return { words: stats.wordsSeen, accuracy: Math.round(run.accuracy() * 100), xp: stats.xp, bestStreak: stats.bestStreak };
}

// Grammar points that can be added to the learner's reviews from the lesson.
export function startablePoints(lesson, items) {
  return lesson.points.filter((p) => items?.[p.id]?.state === 'new');
}
