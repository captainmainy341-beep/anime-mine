import { GENERIC_AWKWARD, bridgeLine, gradeAttempt, isChallenge, reorder, reorderedBeat, testedKanji } from './challenge.mjs';

const SNAPSHOT_VERSION = 2;
const MAX_BACKLOG = 200;
const SAVED_BACKLOG = 40;
const MAX_REPORTED_MISTAKES = 50;
const MAX_CAST = 8;

// How many displayed beats pass before a missed challenge comes back: 3 after the first miss,
// then 6, then every 10 until it is answered.
export const REQUEUE_GAPS = [3, 6, 10];

export function requeueGap(misses) {
  return REQUEUE_GAPS[Math.min(Math.max(misses, 1), REQUEUE_GAPS.length) - 1];
}

// Said when a challenge was answered right after looking up the kanji it tests.
export const PEEK_LINE = { who: null, text: '…調べたから、あとで もう一度 ためそう。', en: 'You looked it up, so this one comes back later.' };

const clone = (value) => JSON.parse(JSON.stringify(value));
const isCount = (n) => Number.isInteger(n) && n >= 0;

// A pure state machine over one scene. It never touches the DOM or IPC: the mount module reads frame(),
// calls advance()/answer(), and drains takeReports() into the SRS.
//
// Mistakes work like an Anki learning step: a wrong answer shows the awkward reaction, the story moves on,
// and the challenge comes back a few beats later (behind a short bridge line) until it is answered.
// The scene only ends once nothing is waiting. Each challenge is reported once, when finally answered,
// with the number of wrong attempts it took.
export function createEngine(scene, { restore = null, skipIntro = [] } = {}) {
  const labels = new Map(scene.beats.flatMap((beat, i) => (beat.label ? [[beat.label, i]] : [])));
  const skip = new Set(skipIntro);
  const state = {
    index: 0,
    step: 0,
    bg: scene.bg ?? null,
    cast: {},
    affection: {},
    gallery: [],
    results: [],
    backlog: [],
    queue: [],
    reask: null,
    carry: null,
    awkward: null,
    moveOn: false,
    peeked: null,
    finished: false,
    logged: -1,
    turns: 0,
  };
  let reports = [];

  if (restore) applySnapshot(restore);
  if (state.moveOn) moveOn();
  else settle();

  function applySnapshot(snap) {
    if (!snap || (snap.v !== 1 && snap.v !== SNAPSHOT_VERSION) || snap.scene !== scene.id) throw new Error('This save belongs to a different scene');
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
    state.logged = state.index;
    if (snap.v === 1) {
      // Version 1 retried in place: keep the mistakes made on the challenge it stopped at.
      if (isCount(snap.attempts) && snap.attempts > 0 && isChallenge(scene.beats[state.index])) {
        state.carry = { at: state.index, wrong: Math.min(snap.attempts, MAX_REPORTED_MISTAKES) };
      }
      return;
    }
    state.step = isCount(snap.step) ? snap.step : 0;
    state.turns = isCount(snap.turns) ? snap.turns : 0;
    state.queue = (Array.isArray(snap.queue) ? snap.queue : []).map(entryFrom).filter(Boolean).slice(0, scene.beats.length);
    state.reask = snap.reask ? entryFrom(snap.reask) : null;
    if (state.reask) {
      state.reask.phase = snap.reask.phase === 'ask' ? 'ask' : 'bridge';
      state.reask.atEnd = snap.reask.atEnd === true;
      state.reask.line = bridgeLine(scene.beats[state.reask.at].type, { atEnd: state.reask.atEnd, turn: state.reask.turn });
    }
    state.moveOn = snap.moveOn === true;
    state.peeked = isCount(snap.peeked) && isChallenge(scene.beats[snap.peeked]) ? snap.peeked : null;
  }

  // Validates one requeue entry from a save; unknown or non-challenge beats are dropped.
  function entryFrom(raw) {
    if (!raw || !isCount(raw.at) || !isChallenge(scene.beats[raw.at])) return null;
    const misses = isCount(raw.misses) && raw.misses > 0 ? raw.misses : 1;
    return {
      at: raw.at,
      misses,
      wrong: Math.min(isCount(raw.wrong) && raw.wrong > 0 ? raw.wrong : misses, MAX_REPORTED_MISTAKES),
      due: isCount(raw.due) ? raw.due : 0,
      turn: isCount(raw.turn) ? raw.turn : 0,
    };
  }

  function log(entry) {
    state.backlog.push(entry);
    if (state.backlog.length > MAX_BACKLOG) state.backlog.shift();
  }

  function nextDue({ any = false } = {}) {
    let best = -1;
    state.queue.forEach((entry, i) => {
      if ((any || entry.due <= state.step) && (best < 0 || entry.due < state.queue[best].due)) best = i;
    });
    return best < 0 ? null : state.queue.splice(best, 1)[0];
  }

  // Opens a re-ask: first a bridge line in the story, then the challenge itself.
  function startReask(entry, atEnd) {
    const beat = scene.beats[entry.at];
    const line = bridgeLine(beat.type, { atEnd, turn: state.turns });
    state.reask = { ...entry, phase: 'bridge', atEnd, turn: state.turns, line };
    state.turns += 1;
    const who = bridgeSpeaker();
    log({ who, text: line.text, en: line.en, bridge: true });
  }

  function bridgeSpeaker() {
    const { line, at } = state.reask;
    const who = scene.beats[at].who;
    return line.speaker && who && state.cast[who] ? who : null;
  }

  function settle() {
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
    if (state.reask) return;
    const atEnd = state.index >= scene.beats.length;
    const due = nextDue({ any: atEnd });
    if (due) return startReask(due, atEnd);
    if (atEnd) {
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

  // Leaves the beat (or re-ask) on screen and continues the story.
  function moveOn() {
    state.moveOn = false;
    state.peeked = null;
    if (state.reask) state.reask = null;
    else state.index += 1;
    state.step += 1;
    settle();
  }

  function nameOf(who) {
    return who ? scene.characters[who]?.name ?? '' : '';
  }

  // The last dialogue line before a challenge, shown as a recap when it is asked again.
  function recapFor(at) {
    for (let i = at - 1; i >= 0; i -= 1) {
      const beat = scene.beats[i];
      if (beat.type === 'say') return { who: beat.who, name: nameOf(beat.who), text: beat.text, en: beat.en ?? '' };
    }
    return null;
  }

  function currentChallenge() {
    if (state.reask) {
      const beat = scene.beats[state.reask.at];
      return reorderedBeat(beat, beat.type === 'reading' ? null : reorder(optionCount(beat), state.reask.misses));
    }
    return scene.beats[state.index];
  }

  function optionCount(beat) {
    return beat.options?.length ?? 0;
  }

  function frame() {
    if (state.awkward) {
      const a = state.awkward;
      return { kind: 'awkward', who: a.who, name: nameOf(a.who), text: a.text, en: a.en ?? '', explain: a.explain ?? '', beat: currentChallenge() };
    }
    if (state.finished) return { kind: 'end', summary: summary() };
    if (state.reask?.phase === 'bridge') {
      const who = bridgeSpeaker();
      const { line } = state.reask;
      return { kind: 'say', who, name: nameOf(who), text: line.text, en: line.en, bridge: true, beat: scene.beats[state.reask.at] };
    }
    if (state.reask) {
      const beat = currentChallenge();
      return { kind: beat.type, beat, attempts: state.reask.wrong, requeued: true, recap: recapFor(state.reask.at), name: nameOf(beat.who), peeked: state.peeked === state.reask.at };
    }
    const beat = scene.beats[state.index];
    if (beat.type === 'say') return { kind: 'say', who: beat.who, name: nameOf(beat.who), text: beat.text, en: beat.en ?? '', beat };
    if (beat.type === 'intro') return { kind: 'intro', item: beat.item, beat };
    const carried = state.carry?.at === state.index ? state.carry.wrong : 0;
    return { kind: beat.type, beat, attempts: carried, requeued: false, recap: null, name: nameOf(beat.who), peeked: state.peeked === state.index };
  }

  function advance() {
    if (state.awkward) {
      state.awkward = null;
      moveOn();
      return true;
    }
    if (state.finished) return false;
    if (state.reask?.phase === 'bridge') {
      state.reask.phase = 'ask';
      return true;
    }
    if (state.reask || isChallenge(scene.beats[state.index])) return false;
    moveOn();
    return true;
  }

  // The scene index of the challenge on screen, or null when no challenge is waiting for an answer.
  function challengeAt() {
    if (state.finished || state.awkward || state.reask?.phase === 'bridge') return null;
    if (state.reask) return state.reask.at;
    return isChallenge(scene.beats[state.index]) ? state.index : null;
  }

  function isTested(char) {
    const at = challengeAt();
    return at !== null && testedKanji(scene.beats[at]).includes(char);
  }

  // Looking up a kanji. If it is the one the open challenge asks about, that challenge counts as missed:
  // it can still be answered now, but it comes back later and the lookup counts as one wrong attempt.
  function peek(char) {
    if (!isTested(char)) return { counted: false };
    const already = state.peeked === challengeAt();
    state.peeked = challengeAt();
    return { counted: true, already };
  }

  function answer(input) {
    if (state.finished || state.awkward) return { result: 'invalid' };
    if (state.reask?.phase === 'bridge') return { result: 'invalid' };
    const beat = currentChallenge();
    if (!isChallenge(beat)) return { result: 'invalid' };
    const graded = gradeAttempt(beat, input);
    const at = state.reask ? state.reask.at : state.index;
    const wrongBefore = state.reask ? state.reask.wrong : state.carry?.at === at ? state.carry.wrong : 0;
    const peeked = state.peeked === at;
    if (graded.result === 'correct' && peeked) {
      requeue(at, wrongBefore, PEEK_LINE);
      return { result: 'correct', counted: 'peeked', requeuedIn: requeueGap(state.queue.at(-1).misses) };
    }
    if (graded.result === 'correct') {
      const incorrectCount = Math.min(wrongBefore, MAX_REPORTED_MISTAKES);
      state.results.push({ item: beat.item, incorrectCount, type: beat.type });
      reports.push({ item: beat.item, incorrectCount });
      state.carry = null;
      moveOn();
      return { result: 'correct', incorrectCount };
    }
    if (graded.result === 'incorrect') {
      const gap = requeue(at, wrongBefore, graded.awkward ?? GENERIC_AWKWARD[beat.type]);
      return { ...graded, requeuedIn: gap };
    }
    return graded;
  }

  // One miss (a wrong answer, or a right one after peeking): react, queue the challenge, move on after.
  function requeue(at, wrongBefore, reaction) {
    const misses = (state.reask?.misses ?? (wrongBefore > 0 ? wrongBefore : 0)) + 1;
    const wrong = Math.min(wrongBefore + 1, MAX_REPORTED_MISTAKES);
    const gap = requeueGap(misses);
    state.queue.push({ at, misses, wrong, due: state.step + 1 + gap, turn: 0 });
    state.carry = null;
    state.awkward = reaction;
    state.moveOn = true;
    log({ who: reaction.who, text: reaction.text, en: reaction.en ?? '', ...(reaction.explain ? { explain: reaction.explain } : {}) });
    return gap;
  }

  // While an awkward reaction is on screen its speaker looks surprised (or uses the reaction's own expr).
  function stage() {
    const cast = clone(state.cast);
    const who = state.awkward?.who;
    if (who && cast[who]) cast[who].expr = state.awkward.expr ?? 'surprised';
    return { bg: state.bg, cast };
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
      affection: { ...state.affection },
      gallery: clone(state.gallery),
    };
  }

  function snapshot() {
    const entry = ({ at, misses, wrong, due, turn }) => ({ at, misses, wrong, due, turn });
    return {
      v: SNAPSHOT_VERSION,
      scene: scene.id,
      index: state.index,
      step: state.step,
      turns: state.turns,
      bg: state.bg,
      cast: clone(state.cast),
      affection: { ...state.affection },
      gallery: clone(state.gallery),
      results: clone(state.results),
      queue: state.queue.map(entry),
      reask: state.reask ? { ...entry(state.reask), phase: state.reask.phase, atEnd: state.reask.atEnd } : null,
      moveOn: state.moveOn,
      peeked: state.peeked,
      backlog: clone(state.backlog.slice(-SAVED_BACKLOG)),
    };
  }

  return {
    frame,
    advance,
    answer,
    peek,
    isTested,
    takeReports,
    summary,
    snapshot,
    scene: () => state.bg,
    stage,
    backlog: () => state.backlog.map((e) => ({ ...e, name: nameOf(e.who) })),
    progress: () => ({ index: state.index, total: scene.beats.length, pending: state.queue.length + (state.reask ? 1 : 0) }),
    isFinished: () => state.finished,
  };
}
