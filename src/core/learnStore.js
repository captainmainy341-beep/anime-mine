const fs = require('node:fs');
const path = require('node:path');
const srs = require('./srs');
const { toHiragana } = require('./kana');

const VERSION = 1;
const MARKER_PATTERN = /\{\{[^{}]*\}\}/g;
const REVIEW_ORDERS = ['random', 'lowestStageFirst', 'levelAscending'];
const CRAM_SOURCES = ['recentMistakes', 'recentLessons', 'burned', 'level', 'jlpt', 'ghosts'];
const PASS_STAGE = 5;
const MAX_LIST = 20;

const DEFAULT_SETTINGS = {
  lessonBatch: 5,
  dailyLessonLimit: 20,
  reviewOrder: 'random',
  vacationSince: null,
  autoAddMined: true,
  preferAnimeSentences: true,
  showFurigana: true,
  showEnglish: true,
};

function defaults() {
  return {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS },
    level: { current: 1, startedAt: null, history: [] },
    items: {},
    ghosts: {},
    lastWrong: {},
    userData: {},
    custom: {},
    animeSentences: {},
    log: {},
    daily: { date: null, lessons: 0 },
  };
}

function localDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return localDate(t.getTime());
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripMarkers(s) {
  return s.replace(/[.\-\s]/g, '');
}

function kunStems(readings) {
  return readings.map((r) => r.split('.')[0].replace(/-/g, '')).filter(Boolean);
}

function parseClozeLocal(ja) {
  const markers = [...ja.matchAll(MARKER_PATTERN)];
  if (markers.length !== 1) return null;
  const [marker] = markers;
  return {
    before: ja.slice(0, marker.index),
    after: ja.slice(marker.index + marker[0].length),
    answers: marker[0].slice(2, -2).split('|'),
  };
}

function cleanList(values, { lower = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (typeof raw !== 'string') continue;
    let v = raw.trim();
    if (lower) v = v.toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

class LearnStore {
  constructor({ dataDir, pack = null, grammar = { points: [], byId: new Map() }, now = () => Date.now(), onStage } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'learn.json');
    this.pack = pack;
    this.grammar = grammar;
    this.now = now;
    this.onStage = onStage;
    this.state = this.load();
    this.ensureLevelStart();
  }

  load() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return defaults();
    }
    if (!isObject(parsed)) return defaults();
    const base = defaults();
    return {
      ...base,
      ...parsed,
      version: VERSION,
      settings: { ...base.settings, ...(isObject(parsed.settings) ? parsed.settings : {}) },
      level: { ...base.level, ...(isObject(parsed.level) ? parsed.level : {}) },
      items: isObject(parsed.items) ? parsed.items : {},
      ghosts: isObject(parsed.ghosts) ? parsed.ghosts : {},
      lastWrong: isObject(parsed.lastWrong) ? parsed.lastWrong : {},
      userData: isObject(parsed.userData) ? parsed.userData : {},
      custom: isObject(parsed.custom) ? parsed.custom : {},
      animeSentences: isObject(parsed.animeSentences) ? parsed.animeSentences : {},
      log: isObject(parsed.log) ? parsed.log : {},
      daily: isObject(parsed.daily) ? { ...base.daily, ...parsed.daily } : base.daily,
    };
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    try {
      fs.renameSync(tmp, this.file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }

  setPack(pack) {
    this.pack = pack;
    this.ensureLevelStart();
    this.save();
  }

  setGrammar(grammar) {
    this.grammar = grammar;
    this.save();
  }

  ensureLevelStart() {
    if (this.pack && this.state.level.startedAt === null) {
      this.state.level.startedAt = this.now();
    }
  }

  settingsGet() {
    return { ...this.state.settings };
  }

  settingsSet(patch) {
    const s = { ...this.state.settings };
    if (!isObject(patch)) throw new Error('settings patch must be an object');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'lessonBatch') {
        if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error('lessonBatch must be 1..50');
      } else if (key === 'dailyLessonLimit') {
        if (!Number.isInteger(value) || value < 0 || value > 200) throw new Error('dailyLessonLimit must be 0..200');
      } else if (key === 'reviewOrder') {
        if (!REVIEW_ORDERS.includes(value)) throw new Error(`reviewOrder must be one of ${REVIEW_ORDERS.join(', ')}`);
      } else if (['autoAddMined', 'preferAnimeSentences', 'showFurigana', 'showEnglish'].includes(key)) {
        if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
      } else {
        continue;
      }
      s[key] = value;
    }
    this.state.settings = s;
    this.save();
    return this.settingsGet();
  }

  entry(id) {
    const kind = srs.kindOf(id);
    if (kind === 'grammar') return this.grammar.byId?.get(id) ?? null;
    if (kind === 'custom') return this.state.custom[id] ?? null;
    if (!this.pack) return null;
    const table = { radical: this.pack.radicals, kanji: this.pack.kanji, vocab: this.pack.vocab }[kind];
    return table?.[id] ?? null;
  }

  stageOf(id) {
    return this.state.items[id]?.stage ?? 0;
  }

  isStarted(id) {
    return Object.hasOwn(this.state.items, id);
  }

  isAvailable(id) {
    const kind = srs.kindOf(id);
    if (kind === 'grammar' || kind === 'custom') return this.entry(id) !== null && !this.isStarted(id);
    const e = this.entry(id);
    if (!e || this.isStarted(id) || e.level > this.state.level.current) return false;
    if (kind === 'radical') return true;
    if (kind === 'kanji') return e.components.every((r) => this.stageOf(r) >= PASS_STAGE);
    return e.kanji.every((k) => this.stageOf(k) >= PASS_STAGE);
  }

  levelIds(level) {
    const row = this.pack?.levelList?.find((l) => l.level === level);
    return row ? [...row.kanji] : [];
  }

  levelKanjiStats(level) {
    const ids = this.levelIds(level);
    const passed = ids.filter((id) => this.stageOf(id) >= PASS_STAGE).length;
    return { total: ids.length, passed, needed: Math.ceil(ids.length * 0.9) };
  }

  checkLevelUp() {
    const lv = this.state.level;
    let raised = false;
    while (this.pack && lv.current < this.pack.levels) {
      const stats = this.levelKanjiStats(lv.current);
      if (stats.total === 0 || stats.passed < stats.needed) break;
      const now = this.now();
      lv.history.push({ level: lv.current, startedAt: lv.startedAt, passedAt: now });
      lv.current += 1;
      lv.startedAt = now;
      raised = true;
    }
    return raised;
  }

  today() {
    return localDate(this.now());
  }

  dailyCount() {
    const today = this.today();
    if (this.state.daily.date !== today) this.state.daily = { date: today, lessons: 0 };
    return this.state.daily.lessons;
  }

  bumpLog(field, n = 1) {
    const date = this.today();
    const day = this.state.log[date] ?? { reviews: 0, correct: 0, lessons: 0 };
    day[field] += n;
    this.state.log[date] = day;
  }

  dashboard() {
    const now = this.now();
    const { current, history } = this.state.level;
    const total = this.pack?.levels ?? 60;
    const kstats = this.levelKanjiStats(current);
    const started = Object.entries(this.state.items);
    const lessonsKanji = this.availableKanjiSide().length;
    const lessonsGrammar = this.availableGrammar().length;
    const remaining = this.remainingToday();
    const vacation = this.state.settings.vacationSince !== null;
    const dueOf = (pred) => started.filter(([id, s]) => pred(id) && s.nextReview !== null && s.nextReview <= now).length;
    const isGrammar = (id) => srs.kindOf(id) === 'grammar';
    const due = vacation ? 0 : dueOf(() => true);
    const dueKanji = vacation ? 0 : dueOf((id) => !isGrammar(id));
    const dueGrammar = vacation ? 0 : dueOf(isGrammar);
    const futureTimes = started.map(([, s]) => s.nextReview).filter((t) => t !== null && t > now);
    const nextAt = futureTimes.length ? Math.min(...futureTimes) : null;
    const wkStates = Object.fromEntries(started.filter(([id]) => !isGrammar(id)));
    const bpStates = Object.fromEntries(started.filter(([id]) => isGrammar(id)));
    const forecastHours = srs.forecast({ ...wkStates, ...bpStates }, now, { hours: 24 });
    const forecastDayRows = srs.forecastDays({ ...wkStates, ...bpStates }, now, 7);
    const pick = (counts, keys) => Object.fromEntries(keys.map((k) => [k, counts[k]]));
    const groups = {
      wk: pick(srs.countByGroup(wkStates, () => 'wk'), ['apprentice', 'guru', 'master', 'enlightened', 'burned']),
      bp: pick(srs.countByGroup(bpStates, () => 'bp'), ['beginner', 'adept', 'seasoned', 'expert', 'completed']),
    };
    return {
      packReady: this.pack !== null,
      grammarReady: this.grammar.points.length > 0,
      level: {
        current,
        total,
        kanjiPassed: kstats.passed,
        kanjiTotal: kstats.total,
        needed: kstats.needed,
        percent: kstats.total ? Math.floor((kstats.passed / kstats.total) * 100) : 0,
      },
      lessons: {
        kanji: lessonsKanji,
        grammar: lessonsGrammar,
        remainingToday: remaining === Infinity ? null : remaining,
      },
      reviews: { due, dueKanji, dueGrammar, nextAt },
      groups,
      forecastHours: forecastHours.map((b) => ({ hourOffset: b.hourOffset, count: b.count })),
      forecastDays: forecastDayRows,
      streakDays: this.streakDays(),
      vacation,
    };
  }

  streakDays() {
    const isActive = (date) => {
      const day = this.state.log[date];
      return !!day && day.reviews + day.lessons > 0;
    };
    let date = this.today();
    if (!isActive(date)) date = shiftDate(date, -1);
    let n = 0;
    while (isActive(date)) {
      n += 1;
      date = shiftDate(date, -1);
    }
    return n;
  }

  remainingToday() {
    const count = this.dailyCount();
    const limit = this.state.settings.dailyLessonLimit;
    return limit === 0 ? Infinity : Math.max(0, limit - count);
  }

  availableKanjiSide() {
    const out = [];
    const current = this.state.level.current;
    for (const kind of ['radical', 'kanji', 'vocab']) {
      for (let level = 1; level <= current; level += 1) {
        const row = this.pack?.levelList?.find((l) => l.level === level);
        const ids = row ? row[{ radical: 'radicals', kanji: 'kanji', vocab: 'vocab' }[kind]] : [];
        for (const id of ids) if (this.isAvailable(id)) out.push(id);
      }
    }
    for (const id of Object.keys(this.state.custom)) if (this.isAvailable(id)) out.push(id);
    return out;
  }

  availableGrammar() {
    const rank = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
    return this.grammar.points
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => this.isAvailable(p.id))
      .sort((a, b) => (rank[a.p.jlpt] ?? 9) - (rank[b.p.jlpt] ?? 9) || a.index - b.index)
      .map(({ p }) => p.id);
  }

  lessonQueue({ scope = 'all', jlpt, ids, limit } = {}) {
    if (ids) {
      return ids.filter((id) => this.isAvailable(id)).slice(0, this.remainingToday()).map((id) => this.card(id));
    }
    let list = [];
    if (scope === 'kanji' || scope === 'all') list = list.concat(this.availableKanjiSide());
    if (scope === 'grammar' || scope === 'all') {
      list = list.concat(this.availableGrammar().filter((id) => !jlpt || this.entry(id).jlpt === jlpt));
    }
    const remaining = this.remainingToday();
    const cap = Math.min(this.state.settings.lessonBatch, remaining);
    const n = limit === undefined ? cap : Math.min(limit, remaining);
    return list.slice(0, n).map((id) => this.card(id));
  }

  completeLessons(ids) {
    const started = [];
    const now = this.now();
    for (const id of ids) {
      if (started.includes(id) || !this.isAvailable(id)) continue;
      const kind = srs.kindOf(id);
      this.state.items[id] = srs.startState(kind, now);
      started.push(id);
      this.onStage?.({ id, kind, prevStage: 0, stage: 1 });
    }
    if (started.length) {
      this.dailyCount();
      this.state.daily.lessons += started.length;
      this.bumpLog('lessons', started.length);
    }
    this.ensureLevelStart();
    const levelUp = this.checkLevelUp();
    this.save();
    return { started, levelUp };
  }

  reviewQueue({ scope = 'all', limit } = {}) {
    if (this.state.settings.vacationSince !== null) return [];
    const now = this.now();
    let ids = Object.entries(this.state.items)
      .filter(([id, s]) => this.entry(id) !== null && s.stage < 9 && s.nextReview !== null && s.nextReview <= now)
      .map(([id]) => id)
      .filter((id) => {
        const isGrammar = srs.kindOf(id) === 'grammar';
        return scope === 'all' || (scope === 'grammar' ? isGrammar : !isGrammar);
      });
    const order = this.state.settings.reviewOrder;
    if (order === 'random') {
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    } else if (order === 'lowestStageFirst') {
      ids.sort((a, b) => this.state.items[a].stage - this.state.items[b].stage);
    } else {
      const levelOf = (id) => this.entry(id)?.level ?? Infinity;
      ids.sort((a, b) => levelOf(a) - levelOf(b));
    }
    if (limit !== undefined) ids = ids.slice(0, limit);
    return ids.map((id) => this.card(id));
  }

  submitReview({ id, incorrectCount }) {
    const state = this.state.items[id];
    if (!this.entry(id)) throw new Error(`unknown id: ${id}`);
    if (!state) throw new Error(`not started: ${id}`);
    if (!Number.isInteger(incorrectCount) || incorrectCount < 0) throw new Error('incorrectCount must be a non-negative integer');
    const kind = srs.kindOf(id);
    const now = this.now();
    const next = srs.applyResult(kind, state, { incorrectCount, now });
    this.state.items[id] = next;
    this.bumpLog('reviews');
    if (incorrectCount === 0) {
      this.bumpLog('correct');
      delete this.state.ghosts[id];
    } else {
      this.state.lastWrong[id] = now;
      this.state.ghosts[id] = true;
    }
    const levelUp = this.checkLevelUp();
    this.save();
    if (next.stage !== state.stage) {
      this.onStage?.({ id, kind, prevStage: state.stage, stage: next.stage });
    }
    return {
      id,
      prevStage: state.stage,
      stage: next.stage,
      group: srs.groupOf(srs.scheduleFor(kind), next.stage),
      nextReview: next.nextReview,
      burned: next.stage === 9,
      passedNow: state.passedAt === null && next.passedAt !== null,
      levelUp,
    };
  }

  radicalRef(rid) {
    if (rid.startsWith('k:')) {
      const k = this.pack?.kanji[rid];
      return { id: rid, char: k?.char ?? '', name: k?.meanings[0] ?? '' };
    }
    const r = this.pack?.radicals[rid];
    return { id: rid, char: r?.char ?? '', name: r?.name ?? '' };
  }

  pickExample(pointId) {
    const point = this.grammar.byId?.get(pointId);
    if (!point) return null;
    const candidates = [];
    for (const ex of point.examples ?? []) {
      const cloze = parseClozeLocal(ex.ja);
      if (cloze) candidates.push({ ja: ex.ja, en: ex.en ?? null, hint: ex.hint ?? null, answers: cloze.answers });
    }
    if (this.state.settings.preferAnimeSentences) {
      for (const a of (this.state.animeSentences[pointId] ?? []).slice(0, 5)) {
        const answer = a.text.slice(a.matchStart, a.matchEnd);
        candidates.push({
          ja: `${a.text.slice(0, a.matchStart)}{{${answer}}}${a.text.slice(a.matchEnd)}`,
          en: null,
          hint: path.basename(a.videoPath, path.extname(a.videoPath)),
          answers: [answer],
        });
      }
    }
    if (!candidates.length) return null;
    const s = this.state.items[pointId];
    const index = s ? (s.correct + s.incorrect) % candidates.length : 0;
    return candidates[index];
  }

  card(id) {
    const kind = srs.kindOf(id);
    const e = this.entry(id);
    if (!e) throw new Error(`unknown id: ${id}`);
    const state = this.state.items[id] ?? null;
    const ud = this.state.userData[id] ?? {};
    const base = {
      id,
      kind,
      stage: state?.stage ?? 0,
      nextReview: state?.nextReview ?? null,
      group: state ? srs.groupOf(srs.scheduleFor(kind), state.stage) : null,
      locked: !state && !this.isAvailable(id),
    };
    if (kind === 'grammar') {
      return {
        ...base,
        jlpt: e.jlpt,
        title: e.title,
        meaning: e.meaning,
        structure: e.structure,
        formality: e.formality,
        notes: e.notes,
        similar: (e.similar ?? []).map((title) => ({ id: this.grammar.points.find((p) => p.title === title)?.id ?? null, title })),
        cloze: this.pickExample(id),
        examples: (e.examples ?? []).map((ex) => ({ ja: ex.ja.replace(/\{\{([^|}]*)[^}]*\}\}/g, '$1'), en: ex.en, hint: ex.hint })),
        animeExamples: this.state.animeSentences[id] ?? [],
      };
    }
    const userFields = {
      synonyms: cleanList(ud.synonyms),
      blacklist: cleanList(ud.blacklist),
      notes: { meaning: ud.meaning ?? '', reading: ud.reading ?? '', mnemonic: ud.mnemonic ?? '' },
    };
    if (kind === 'radical') {
      return {
        ...base,
        level: e.level,
        char: e.char,
        meanings: [e.name],
        ...userFields,
        reading: null,
        readingText: '',
        sentences: [],
        components: [],
        hint: null,
      };
    }
    if (kind === 'kanji') {
      const on = e.onyomi.map((r) => toHiragana(stripMarkers(r)));
      const kun = kunStems(e.kunyomi).map(toHiragana);
      const askType = e.onyomi.length ? 'on' : 'kun';
      return {
        ...base,
        level: e.level,
        char: e.char,
        meanings: e.meanings,
        ...userFields,
        reading: { accepted: askType === 'on' ? on : kun, alsoKnown: askType === 'on' ? kun : on, askType },
        readingText: [...on, ...kun].join(' / '),
        sentences: [],
        components: e.components.map((rid) => this.radicalRef(rid)),
        vocab: e.vocab.slice(0, 6).map((vid) => ({ id: vid, word: this.pack.vocab[vid]?.word ?? '', meaning: this.pack.vocab[vid]?.meanings[0] ?? '' })),
        hint: e.hint ?? null,
      };
    }
    const accepted = e.kana.map(toHiragana);
    return {
      ...base,
      level: e.level ?? null,
      word: e.word,
      meanings: e.meanings,
      ...userFields,
      reading: { accepted, alsoKnown: [], askType: null },
      readingText: accepted.join(' / '),
      sentences: e.sentences ?? [],
      components: [],
      hint: null,
    };
  }

  cramQueue({ source, value, limit } = {}) {
    if (!CRAM_SOURCES.includes(source)) throw new Error(`unknown cram source: ${source}`);
    const items = this.state.items;
    const started = Object.keys(items);
    const ids = {
      recentMistakes: () => Object.entries(this.state.lastWrong).sort(([, a], [, b]) => b - a).map(([id]) => id),
      recentLessons: () => started.sort((a, b) => items[b].startedAt - items[a].startedAt),
      burned: () => started.filter((id) => items[id].stage === 9),
      level: () => started.filter((id) => this.entry(id)?.level === value),
      jlpt: () => started.filter((id) => srs.kindOf(id) === 'grammar' && this.entry(id)?.jlpt === value),
      ghosts: () => Object.keys(this.state.ghosts),
    }[source]();
    return ids.filter((id) => this.isStarted(id) && this.entry(id) !== null).slice(0, limit).map((id) => this.card(id));
  }

  setUserData(id, patch = {}) {
    if (!this.entry(id)) throw new Error(`unknown id: ${id}`);
    const next = { meaning: '', reading: '', synonyms: [], blacklist: [], mnemonic: '', ...this.state.userData[id] };
    for (const key of ['meaning', 'reading', 'mnemonic']) {
      if (typeof patch[key] === 'string') next[key] = patch[key].trim();
    }
    for (const key of ['synonyms', 'blacklist']) {
      if (Array.isArray(patch[key])) next[key] = cleanList(patch[key], { lower: true });
    }
    this.state.userData[id] = next;
    this.save();
    return this.card(id);
  }

  addCustomWord({ word, kana = [], meanings = [], sentence = null } = {}) {
    const text = typeof word === 'string' ? word.trim() : '';
    if (!text) throw new Error('word is required');
    const id = `c:${text}`;
    if (this.state.custom[id]) return this.card(id);
    const cleanMeanings = cleanList(meanings);
    if (!cleanMeanings.length) throw new Error('at least one meaning is required');
    const sentences = [];
    if (sentence) {
      if (typeof sentence.ja !== 'string' || !sentence.ja.trim()) throw new Error('sentence.ja is required');
      sentences.push({ ja: sentence.ja.trim(), en: typeof sentence.en === 'string' ? sentence.en.trim() : '' });
    }
    this.state.custom[id] = {
      id,
      word: text,
      kana: cleanList(Array.isArray(kana) ? kana : [kana]),
      meanings: cleanMeanings,
      sentences,
      addedAt: this.now(),
    };
    this.save();
    return this.card(id);
  }

  removeCustomWord(id) {
    if (!this.state.custom[id]) return false;
    delete this.state.custom[id];
    delete this.state.items[id];
    delete this.state.ghosts[id];
    delete this.state.lastWrong[id];
    delete this.state.userData[id];
    this.save();
    return true;
  }

  setAnimeSentences(map) {
    if (!isObject(map)) throw new Error('animeSentences must be an object');
    this.state.animeSentences = map;
    this.save();
  }

  packIds(kind) {
    const table = { radical: 'radicals', kanji: 'kanji', vocab: 'vocab' }[kind];
    return table && this.pack ? Object.keys(this.pack[table]) : [];
  }

  labelOf(id) {
    const e = this.entry(id);
    if (!e) return id;
    const kind = srs.kindOf(id);
    if (kind === 'grammar') return e.title;
    if (kind === 'vocab' || kind === 'custom') return e.word;
    return e.char;
  }

  subOf(id) {
    const e = this.entry(id);
    if (!e) return '';
    const kind = srs.kindOf(id);
    if (kind === 'grammar') return e.meaning;
    if (kind === 'radical') return e.name;
    return e.meanings[0] ?? '';
  }

  readingsOf(id) {
    const e = this.entry(id);
    if (!e) return [];
    const kind = srs.kindOf(id);
    if (kind === 'kanji') return [...e.onyomi.map((r) => toHiragana(stripMarkers(r))), ...kunStems(e.kunyomi).map(toHiragana)];
    if (kind === 'vocab' || kind === 'custom') return e.kana.map(toHiragana);
    return [];
  }

  browse({ type, level, jlpt, group, query } = {}) {
    const kinds = type ? [type] : ['radical', 'kanji', 'vocab', 'grammar', 'custom'];
    const q = typeof query === 'string' ? toHiragana(query.trim().toLowerCase()) : '';
    const ids = [];
    for (const kind of kinds) {
      if (kind === 'grammar') ids.push(...(this.grammar.points ?? []).map((p) => p.id));
      else if (kind === 'custom') ids.push(...Object.keys(this.state.custom));
      else ids.push(...this.packIds(kind));
    }
    const rows = [];
    for (const id of ids) {
      const e = this.entry(id);
      if (!e) continue;
      const kind = srs.kindOf(id);
      const started = this.isStarted(id);
      const stage = this.stageOf(id);
      const groupKey = started ? srs.groupOf(srs.scheduleFor(kind), stage).key : null;
      if (level !== undefined && e.level !== level) continue;
      if (jlpt !== undefined && e.jlpt !== jlpt) continue;
      if (group !== undefined && groupKey !== group) continue;
      const label = this.labelOf(id);
      const sub = this.subOf(id);
      if (q && ![label, sub, ...this.readingsOf(id)].some((s) => toHiragana(s.toLowerCase()).includes(q))) continue;
      rows.push({
        id,
        kind,
        label,
        sub,
        ...(kind === 'grammar' ? { jlpt: e.jlpt } : { level: e.level ?? null }),
        stage,
        groupKey,
        locked: !started && !this.isAvailable(id),
      });
      if (rows.length >= 600) break;
    }
    return rows;
  }

  levelOverview() {
    if (!this.pack) return [];
    const current = this.state.level.current;
    const out = [];
    for (let level = 1; level <= this.pack.levels; level += 1) {
      const row = this.pack.levelList?.find((l) => l.level === level) ?? { radicals: [], kanji: [], vocab: [] };
      const tally = (ids) => ({
        total: ids.length,
        started: ids.filter((id) => this.isStarted(id)).length,
        passed: ids.filter((id) => this.stageOf(id) >= PASS_STAGE).length,
      });
      out.push({
        level,
        radicals: tally(row.radicals),
        kanji: tally(row.kanji),
        vocab: tally(row.vocab),
        current: level === current,
        locked: level > current,
      });
    }
    return out;
  }

  resetToLevel(n) {
    if (!Number.isInteger(n) || n < 1 || n > (this.pack?.levels ?? 60)) throw new Error('level out of range');
    const drop = (id) => ['radical', 'kanji', 'vocab'].includes(srs.kindOf(id)) && this.entry(id)?.level > n;
    for (const id of Object.keys(this.state.items)) if (drop(id)) delete this.state.items[id];
    for (const map of [this.state.ghosts, this.state.lastWrong]) {
      for (const id of Object.keys(map)) if (drop(id)) delete map[id];
    }
    const lv = this.state.level;
    lv.current = n;
    lv.history = lv.history.filter((h) => h.level < n);
    lv.startedAt = this.now();
    this.save();
    return { current: n };
  }

  resurrect(id) {
    const state = this.state.items[id];
    if (!state) throw new Error(`not started: ${id}`);
    const kind = srs.kindOf(id);
    const next = srs.resurrect(kind, state, this.now());
    this.state.items[id] = next;
    this.save();
    if (next.stage !== state.stage) this.onStage?.({ id, kind, prevStage: state.stage, stage: next.stage });
    return this.card(id);
  }

  setVacation(on) {
    const s = this.state.settings;
    const now = this.now();
    if (on) {
      if (s.vacationSince === null) s.vacationSince = now;
    } else if (s.vacationSince !== null) {
      this.state.items = srs.shiftReviews(this.state.items, now - s.vacationSince);
      s.vacationSince = null;
    }
    this.save();
    return s.vacationSince !== null;
  }

  stats() {
    const today = this.today();
    const daily = [];
    for (let i = 29; i >= 0; i -= 1) {
      const date = shiftDate(today, -i);
      const d = this.state.log[date] ?? {};
      daily.push({ date, reviews: d.reviews ?? 0, correct: d.correct ?? 0, lessons: d.lessons ?? 0 });
    }
    const sum = (rows, field) => rows.reduce((acc, d) => acc + (d[field] ?? 0), 0);
    const reviews30 = sum(daily, 'reviews');
    const totals = { reviews: 0, lessons: 0, correct: 0 };
    for (const d of Object.values(this.state.log)) {
      totals.reviews += d.reviews ?? 0;
      totals.lessons += d.lessons ?? 0;
      totals.correct += d.correct ?? 0;
    }
    const stageCounts = { wk: {}, bp: {} };
    for (let s = 1; s <= 9; s += 1) {
      stageCounts.wk[s] = 0;
      stageCounts.bp[s] = 0;
    }
    for (const [id, st] of Object.entries(this.state.items)) {
      stageCounts[srs.scheduleFor(srs.kindOf(id))][st.stage] += 1;
    }
    const jlpt = {};
    for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) jlpt[level] = { total: 0, started: 0, completed: 0 };
    for (const p of this.grammar.points ?? []) {
      const row = jlpt[p.jlpt];
      if (!row) continue;
      row.total += 1;
      if (this.isStarted(p.id)) row.started += 1;
      if (this.stageOf(p.id) === 9) row.completed += 1;
    }
    const wkItems = {};
    for (const [key, kind] of [['radicals', 'radical'], ['kanji', 'kanji'], ['vocab', 'vocab']]) {
      const ids = this.packIds(kind);
      wkItems[key] = { total: ids.length, started: ids.filter((id) => this.isStarted(id)).length };
    }
    const leeches = Object.entries(this.state.items)
      .filter(([, s]) => s.incorrect >= 6 && s.incorrect > s.correct)
      .sort(([, a], [, b]) => b.incorrect - a.incorrect)
      .slice(0, 20)
      .map(([id, s]) => ({ id, label: this.labelOf(id), incorrect: s.incorrect, correct: s.correct }));
    return {
      accuracy30: reviews30 ? sum(daily, 'correct') / reviews30 : null,
      totals,
      daily,
      stageCounts,
      jlpt,
      wkItems,
      leeches,
    };
  }

  markKnownIds() {
    return Object.entries(this.state.items)
      .filter(([id, s]) => ['kanji', 'vocab', 'custom'].includes(srs.kindOf(id)) && s.stage >= PASS_STAGE)
      .map(([id]) => id);
  }
}

module.exports = { LearnStore };
