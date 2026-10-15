const PARTICLES = require('./data/particles.json');
const { detectGrammar } = require('./grammar');

const MAX_TEXT = 400;
const PARTICLE_BY_SURFACE = new Map(PARTICLES.map((p) => [p.surface, p]));

const PUNCT_POS = '記号';
const PARTICLE_POS = '助詞';
const AUX_POS = '助動詞';
const NOUN_POS = '名詞';
const VERB_POS = '動詞';
const ADJ_POS = '形容詞';
const SUFFIX = '接尾';
const DEPENDENT = '非自立';
const CONJ_PARTICLE = '接続助詞';
const FINAL_PARTICLE = '終助詞';
const PARALLEL_PARTICLE = '並立助詞';
const ADVERB_PARTICLE = '副助詞';
const NUMBER_DETAIL = '数';

const CHAIN_PARTICLES = new Set(['て', 'で', 'ば', 'ながら']);
const CAUSE_BASES = new Set(['せる', 'させる', 'られる', 'れる']);
const MOTION = new Set(['行く', '来る', '帰る', '戻る', '向かう', '出かける', '着く', '入る']);
const EXIST = new Set(['いる', 'ある', '住む', '座る']);
const GIVE = new Set(['あげる', 'くれる', '渡す', '教える', '送る', '貸す', '見せる', '伝える', '届ける']);
const QUOTE_VERBS = new Set(['言う', '思う', '考える', '聞く', '呼ぶ', '書く', '感じる']);
const TOOL_NOUNS = new Set(['電車', 'バス', '車', 'タクシー', '飛行機', '船', '自転車', 'ペン', '鉛筆', '箸', 'はさみ', '日本語', '英語', '言葉', '手', 'パソコン', '携帯', '電話', 'メール', 'カード', '現金', '紙', '筆']);
const CAUSE_NOUNS = new Set(['雨', '雪', '風', '台風', '病気', '事故', '地震', '渋滞', '寒さ', '暑さ', '疲れ']);
const TIME_WORDS = new Set(['今日', '明日', '昨日', '今朝', '今夜', '今週', '来週', '先週', '今年', '来年', '去年', '毎日', '毎朝', '毎晩', '今', '朝', '夜', '昼', '午前', '午後', '夜中', '深夜', '夕方', '正午']);
const TIME_SUFFIXES = new Set(['時', '分', '秒', '日', '月', '年', '週', '曜日']);
const EMPHATIC_PRONOUNS = new Set(['彼', '彼女', '私', '僕', '俺', '君', 'あなた', '誰']);
const PLACE_SUFFIX = /(校|園|館|店|屋|場|室|家|駅|院|社|所|国|町|市|県|村|寺|宅|台|島|都|京|局|堂|庭|浜|海|山|川)$/;

const AUX_INFO = new Map([
  ['ない', ['negative', 'not doing']],
  ['ん', ['negative', 'not doing']],
  ['ず', ['negative (literary)', 'not doing']],
  ['ます', ['polite', 'polite form']],
  ['です', ['polite', 'polite form']],
  ['た', ['past', 'happened or completed']],
  ['たい', ['want to', 'wants to do it']],
  ['れる', ['passive or potential', 'is done to / can do']],
  ['られる', ['passive or potential', 'is done to / can do']],
  ['せる', ['causative', 'make or let someone do it']],
  ['させる', ['causative', 'make or let someone do it']],
  ['ば', ['conditional (if)', 'if / when']],
  ['ながら', ['while doing', 'doing two things at once']],
  ['う', ['volitional', 'let\'s / I will']],
  ['よう', ['volitional', 'let\'s / I will']],
  ['そう', ['looks like', 'appears to be so']],
  ['て', ['te-form', 'connects to the next action']],
  ['で', ['te-form', 'connects to the next action']],
  ['いる', ['continuing', 'ongoing action or state']],
  ['おる', ['continuing', 'ongoing action or state']],
  ['ある', ['resulting state', 'a state left after an action']],
  ['しまう', ['completed / regret', 'finished, often with regret']],
  ['ちゃう', ['completed / regret', 'finished, often with regret']],
  ['おく', ['do in advance', 'done beforehand']],
  ['みる', ['try doing', 'try and see']],
  ['くる', ['coming (toward speaker)', 'action moving toward the speaker']],
  ['いく', ['going (away from speaker)', 'action moving away from the speaker']],
  ['すぎる', ['too much', 'more than enough']],
  ['なる', ['becomes', 'changes into a state']],
]);

function isParticleToken(t) {
  return t.pos === PARTICLE_POS || (t.surface === 'の' && t.pos === NOUN_POS && t.pos2 === DEPENDENT);
}

function isAuxVerb(t) {
  return t.pos.startsWith(VERB_POS) && (t.pos2 === SUFFIX || t.pos2 === DEPENDENT);
}

function chunkKind(t) {
  if (!t.isWord) return 'punct';
  if (isParticleToken(t)) return 'particle';
  if (t.pos === AUX_POS || isAuxVerb(t)) return 'aux';
  return 'content';
}

function isChainHead(t) {
  return t.isWord && (t.pos.startsWith(VERB_POS) || t.pos.startsWith(ADJ_POS)) && t.pos2 !== SUFFIX && t.pos2 !== DEPENDENT;
}

function isChainMember(t) {
  if (!t.isWord) return false;
  if (t.pos === AUX_POS || isAuxVerb(t)) return true;
  return isParticleToken(t) && t.pos2 === CONJ_PARTICLE && CHAIN_PARTICLES.has(t.surface);
}

function nextVerb(tokens, i) {
  for (let j = i + 1; j < Math.min(tokens.length, i + 5); j++) {
    const t = tokens[j];
    if (!t.isWord) break;
    if (t.pos.startsWith(VERB_POS) && t.pos2 !== SUFFIX) return t;
  }
  return null;
}

function causativeAhead(tokens, i) {
  for (let j = i + 1; j < Math.min(tokens.length, i + 9); j++) {
    const t = tokens[j];
    if (!t.isWord) break;
    if ((t.pos.startsWith(VERB_POS) || t.pos === AUX_POS) && CAUSE_BASES.has(t.base)) return true;
  }
  return false;
}

function isTimeWord(t) {
  return TIME_WORDS.has(t.surface) || (t.pos2 === SUFFIX && TIME_SUFFIXES.has(t.surface));
}

function isPlaceNoun(t) {
  return t.pos === NOUN_POS && PLACE_SUFFIX.test(t.surface);
}

function isQuantity(tokens, i) {
  const t = tokens[i];
  return t.pos2 === NUMBER_DETAIL || (t.pos2 === SUFFIX && tokens[i - 1]?.pos2 === NUMBER_DETAIL);
}

function isPlainPredicate(t) {
  return (t.pos.startsWith(VERB_POS) || t.pos.startsWith(ADJ_POS)) && t.conjugatedForm === '基本形';
}

const RESOLVERS = {
  に(tokens, i) {
    const prev = tokens[i - 1];
    if (prev && isTimeWord(prev)) return { role: 'time', sure: true };
    if (causativeAhead(tokens, i)) return { role: 'agent', sure: true };
    const verb = nextVerb(tokens, i);
    if (verb && MOTION.has(verb.base)) return { role: 'destination', sure: true };
    if (verb && EXIST.has(verb.base)) return { role: 'location', sure: true };
    if (verb && GIVE.has(verb.base)) return { role: 'recipient', sure: true };
    return { role: 'destination', sure: false };
  },
  で(tokens, i) {
    if (tokens[i].pos2 === CONJ_PARTICLE) return { role: 'te-form', sure: true };
    const prev = tokens[i - 1];
    if (prev && CAUSE_NOUNS.has(prev.base)) return { role: 'cause', sure: true };
    if (prev && TOOL_NOUNS.has(prev.base)) return { role: 'means', sure: true };
    if (prev && isPlaceNoun(prev)) return { role: 'location', sure: true };
    return { role: 'location', sure: false };
  },
  と(tokens, i) {
    const verb = nextVerb(tokens, i);
    if (verb && QUOTE_VERBS.has(verb.base)) return { role: 'quotation', sure: true };
    const prev = tokens[i - 1];
    if (tokens[i].pos2 === CONJ_PARTICLE || (prev && isPlainPredicate(prev))) return { role: 'conditional', sure: true };
    if (tokens[i].pos2 === PARALLEL_PARTICLE) {
      return verb ? { role: 'with', sure: false } : { role: 'and', sure: true };
    }
    return { role: 'with', sure: true };
  },
  の(tokens, i) {
    const t = tokens[i];
    if (t.pos2 === FINAL_PARTICLE) return { role: 'explanatory', sure: true };
    if (t.pos === NOUN_POS) return { role: 'nominalizer', sure: true };
    return { role: 'possessive', sure: tokens[i - 1]?.pos === NOUN_POS };
  },
  か(tokens, i) {
    const pos2 = tokens[i].pos2;
    if (pos2 === FINAL_PARTICLE) return { role: 'question', sure: true };
    if (pos2 === PARALLEL_PARTICLE || pos2 === ADVERB_PARTICLE) return { role: 'or', sure: true };
    return { role: 'question', sure: false };
  },
  が(tokens, i) {
    return tokens[i].pos2 === CONJ_PARTICLE ? { role: 'contrast', sure: true } : { role: 'subject', sure: true };
  },
  から(tokens, i) {
    return tokens[i].pos2 === CONJ_PARTICLE ? { role: 'because', sure: true } : { role: 'from', sure: true };
  },
  まで(tokens, i) {
    if (tokens[i].pos2 !== ADVERB_PARTICLE) return { role: 'until', sure: true };
    const prev = tokens[i - 1];
    if (prev && EMPHATIC_PRONOUNS.has(prev.surface)) return { role: 'even', sure: true };
    const endpoint = Boolean(prev) && prev.pos === NOUN_POS && (isTimeWord(prev) || isPlaceNoun(prev) || isQuantity(tokens, i - 1));
    return { role: 'until', sure: endpoint };
  },
  な(tokens, i) {
    const prev = tokens[i - 1];
    if (prev && prev.pos.startsWith(VERB_POS)) return { role: 'prohibition', sure: prev.conjugatedForm === '基本形' };
    return { role: 'feeling', sure: true };
  },
  って(tokens, i) {
    const verb = nextVerb(tokens, i);
    if (verb && QUOTE_VERBS.has(verb.base)) return { role: 'quotation', sure: true };
    return { role: 'quotation', sure: false };
  },
};

function resolveParticle(entry, tokens, i) {
  const resolver = RESOLVERS[entry.surface];
  if (resolver) return resolver(tokens, i);
  return { role: entry.roles[0].id, sure: entry.roles.length === 1 };
}

function stepFor(t) {
  const [label, explanation] = AUX_INFO.get(t.base) ?? ['auxiliary', `"${t.base}" (auxiliary)`];
  return { form: t.surface, label, explanation };
}

function conjugationsOf(tokens, covered = new Set()) {
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isChainHead(tokens[i])) continue;
    let end = i;
    while (end + 1 < tokens.length && isChainMember(tokens[end + 1])) end++;
    if (end === i) continue;
    const chain = tokens.slice(i, end + 1);
    for (let k = i + 1; k <= end; k++) covered.add(k);
    found.push({
      surface: chain.map((t) => t.surface).join(''),
      base: tokens[i].base,
      steps: chain.slice(1).map(stepFor),
      start: tokens[i].start,
      end: tokens[end].end,
    });
    i = end;
  }
  return found;
}

function emptyAnalysis(text, notes = []) {
  return { text, chunks: [], particles: [], conjugations: [], patterns: [], notes };
}

async function analyzeSentence(text, { tokenize, grammar = null } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return emptyAnalysis('');
  if (text.length > MAX_TEXT) return emptyAnalysis('', [`Sentences over ${MAX_TEXT} characters are not analyzed.`]);

  let tokens;
  try {
    tokens = await tokenize(text);
  } catch {
    return emptyAnalysis(text, ['Could not analyze this sentence.']);
  }

  const notes = [];
  const particles = [];
  const covered = new Set();
  const conjugations = conjugationsOf(tokens, covered);
  const chunks = tokens.map((t, i) => {
    const chunk = { text: t.surface, reading: t.reading, kind: chunkKind(t), start: t.start, end: t.end };
    if (chunk.kind === 'particle' && covered.has(i)) chunk.kind = 'aux';
    const entry = chunk.kind === 'particle' ? PARTICLE_BY_SURFACE.get(t.surface) : undefined;
    if (entry) {
      const { role, sure } = resolveParticle(entry, tokens, i);
      const info = entry.roles.find((r) => r.id === role);
      chunk.role = role;
      particles.push({
        surface: t.surface,
        start: t.start,
        end: t.end,
        id: entry.id,
        name: entry.name,
        role,
        explanation: info.explanation,
        example: info.example,
        ...(entry.level ? { level: entry.level } : {}),
      });
      if (!sure && entry.roles.length > 1) {
        const others = entry.roles.filter((r) => r.id !== role).map((r) => r.id);
        notes.push(`"${t.surface}" here is most likely ${role}; it could also be ${others.join(' or ')}.`);
      }
    }
    return chunk;
  });

  const patterns = grammar
    ? detectGrammar(text, grammar.points).map((hit) => {
        const point = grammar.byId.get(hit.id);
        return { id: hit.id, title: point?.title ?? hit.id, start: hit.start, end: hit.end, text: hit.text, level: point?.jlpt ?? '' };
      })
    : [];

  return { text, chunks, particles, conjugations, patterns, notes };
}

module.exports = { analyzeSentence, MAX_TEXT };
