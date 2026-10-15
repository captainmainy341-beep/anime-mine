import { GENERIC_AWKWARD, gradeAttempt, isChallenge } from './challenge.mjs';

const SNAPSHOT_VERSION = 1;
const MAX_BACKLOG = 200;
const SAVED_BACKLOG = 40;
const MAX_REPORTED_MISTAKES = 50;
const MAX_CAST = 8;

export function starsFor(accuracy) {
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.6) return 2;
  return 1;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// A pure state machine over one scene. It never touches the DOM or IPC: the mount module reads frame(),
// calls advance()/answer(), and drains takeReports() into the SRS.
export function createEngine(scene, { restore = null, skipIntro = [] } = {}) {
  const labels = new Map(scene.beats.flatMap((beat, i) => (beat.label ? [[beat.label, i]] : [])));
  const skip = new Set(skipIntro);
  const state = {
    index: 0,
    bg: scene.bg ?? null,
    cast: {},
    affection: {},
    gallery: [],
    results: [],
    backlog: [],
    attempts: 0,
    awkward: null,
    finished: false,
    logged: -1,
  };
  let reports = [];

  if (restore) applySnapshot(restore);
  settle();

  function applySnapshot(snap) {
    if (!snap || snap.v !== SNAPSHOT_VERSION || snap.scene !== scene.id) throw new Error('This save belongs to a different scene');
    if (!Number.isInteger(snap.index) || snap.index < 0 || snap.index > scene.beats.length) throw new Error('This save is damaged');
    state.index = snap.index;
    state.bg = typeof snap.bg === 'string' ? snap.bg : state.bg;
    state.cast = Object.fromEntries(
      Object.entries(snap.cast ?? {}).filter(([id]) => Object.hasOwn(scene.characters, id)).slice(0, MAX_CAST),
    );
    state.affection = { ...(snap.affection ?? {}) };
    state.gallery = Array.isArray(snap.gallery) ? snap.gallery.slice(0, 20) : [];
    state.results = Array.isArray(snap.results) ? snap.results.filter((r) => r && typeof r.item === 'string') : [];
    state.backlog = Array.isArray(snap.backlog) ? snap.backlog.slice(-MAX_BACKLOG) : [];
    state.attempts = Number.isInteger(snap.attempts) ? Math.min(snap.attempts, MAX_REPORTED_MISTAKES) : 0;
    state.logged = state.index;
  }

  function log(entry) {
    state.backlog.push(entry);
    if (state.backlog.length > MAX_BACKLOG) state.backlog.shift();
  }

  function settle() {
    state.awkward = null;
    while (state.index < scene.beats.length) {
      const beat = scene.beats[state.index];
      if (beat.type === 'bg') state.bg = beat.bg;
      else if (beat.type === 'show') state.cast[beat.char] = { expr: beat.expr, pos: beat.pos };
      else if (beat.type === 'hide') delete state.cast[beat.char];
      else if (beat.type === 'affection') state.affection[beat.char] = (state.affection[beat.char] ?? 0) + beat.delta;
      else if (beat.type === 'cg') {
        if (!state.gallery.some((g) => g.id === beat.id)) state.gallery.push({ id: beat.id, title: beat.title ?? beat.id });
      } else if (beat.type === 'jump') {
        state.index = labels.get(beat.to);
        continue;
      } else if (beat.type === 'intro' && skip.has(beat.item)) {
        // Already studied: no explanation card.
      } else break;
      state.index += 1;
    }
    if (state.index >= scene.beats.length) {
      state.finished = true;
      return;
    }
    const beat = scene.beats[state.index];
    if (beat.type === 'say' && state.logged < state.index) {
      log({ who: beat.who, text: beat.text, en: beat.en ?? '' });
      if (beat.who && beat.expr && state.cast[beat.who]) state.cast[beat.who].expr = beat.expr;
    }
    state.logged = state.index;
  }

  function nameOf(who) {
    return who ? scene.characters[who]?.name ?? '' : '';
  }

  function frame() {
    if (state.finished) return { kind: 'end', summary: summary() };
    const beat = scene.beats[state.index];
    if (state.awkward) {
      const a = state.awkward;
      return { kind: 'awkward', who: a.who, name: nameOf(a.who), text: a.text, en: a.en ?? '', beat };
    }
    if (beat.type === 'say') return { kind: 'say', who: beat.who, name: nameOf(beat.who), text: beat.text, en: beat.en ?? '', beat };
    if (beat.type === 'intro') return { kind: 'intro', item: beat.item, beat };
    return { kind: beat.type, beat, attempts: state.attempts, name: nameOf(beat.who) };
  }

  function advance() {
    if (state.finished) return false;
    if (state.awkward) {
      state.awkward = null;
      return true;
    }
    const beat = scene.beats[state.index];
    if (isChallenge(beat)) return false;
    state.index += 1;
    settle();
    return true;
  }

  function answer(input) {
    if (state.finished || state.awkward) return { result: 'invalid' };
    const beat = scene.beats[state.index];
    if (!isChallenge(beat)) return { result: 'invalid' };
    const graded = gradeAttempt(beat, input);
    if (graded.result === 'correct') {
      const incorrectCount = Math.min(state.attempts, MAX_REPORTED_MISTAKES);
      state.results.push({ item: beat.item, incorrectCount, type: beat.type });
      reports.push({ item: beat.item, incorrectCount });
      state.attempts = 0;
      state.index += 1;
      settle();
      return { result: 'correct', incorrectCount };
    }
    if (graded.result === 'incorrect') {
      state.attempts += 1;
      state.awkward = graded.awkward ?? GENERIC_AWKWARD[beat.type];
      log({ who: state.awkward.who, text: state.awkward.text, en: state.awkward.en ?? '' });
    }
    return graded;
  }

  function takeReports() {
    const out = reports;
    reports = [];
    return out;
  }

  function summary() {
    const total = state.results.length;
    const firstTry = state.results.filter((r) => r.incorrectCount === 0).length;
    const accuracy = total === 0 ? 1 : firstTry / total;
    return {
      total,
      firstTry,
      accuracy,
      stars: starsFor(accuracy),
      affection: { ...state.affection },
      gallery: clone(state.gallery),
    };
  }

  function snapshot() {
    return {
      v: SNAPSHOT_VERSION,
      scene: scene.id,
      index: state.index,
      bg: state.bg,
      cast: clone(state.cast),
      affection: { ...state.affection },
      gallery: clone(state.gallery),
      results: clone(state.results),
      attempts: state.attempts,
      backlog: clone(state.backlog.slice(-SAVED_BACKLOG)),
    };
  }

  return {
    frame,
    advance,
    answer,
    takeReports,
    summary,
    snapshot,
    scene: () => state.bg,
    stage: () => ({ bg: state.bg, cast: clone(state.cast) }),
    backlog: () => state.backlog.map((e) => ({ ...e, name: nameOf(e.who) })),
    progress: () => ({ index: state.index, total: scene.beats.length }),
    isFinished: () => state.finished,
  };
}
