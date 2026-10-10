const PARTICLE = '助詞';
const NOUN = '名詞';
const VERB = '動詞';
const ADJ = '形容詞';
const AUX = '助動詞';
const SA_HEN = 'サ変接続';
const NON_INDEPENDENT = '非自立';
const SUFFIX = '接尾';
const CONJUNCTIVE = '接続助詞';
const MAX_COMPOUND = 4;
const TE_FORMS = new Set(['て', 'で']);
const CHAIN_PARTICLES = new Set(['て', 'で', 'ちゃ', 'じゃ', 'ば', 'たり', 'ながら']);
const SURU_VERBS = new Set(['する', 'できる']);

const LABELS = new Map([
  ['ます', ['polite']],
  ['です', ['polite']],
  ['た', ['past']],
  ['だ', ['past']],
  ['ない', ['negative']],
  ['ん', ['negative']],
  ['ず', ['negative (literary)']],
  ['て', ['te-form']],
  ['で', ['te-form']],
  ['いる', ['continuing']],
  ['おる', ['continuing']],
  ['てる', ['continuing']],
  ['たい', ['want to']],
  ['たがる', ['desire']],
  ['れる', ['passive/potential']],
  ['られる', ['passive/potential']],
  ['せる', ['causative']],
  ['させる', ['causative']],
  ['ば', ['conditional (ba)']],
  ['よう', ['volitional']],
  ['う', ['volitional']],
  ['ちゃう', ['completed / regret']],
  ['しまう', ['completed / regret']],
  ['おく', ['do in advance']],
  ['そう', ['looks like']],
  ['すぎる', ['too much']],
]);

const PATTERNS = [
  [/なければなりません/y, ['must (obligation)', 'polite']],
  [/なければならない|なきゃならない|なくてはならない|なくてはいけない|ないといけない/y, ['must (obligation)']],
  [/なくてもいい|なくてもよい/y, ['need not']],
  [/てもいい|てもよい/y, ['may (permission)']],
  [/てはいけない|てはだめ/y, ['must not']],
  [/ないでください/y, ["please don't"]],
  [/てください/y, ['please do']],
  [/ている|てる/y, ['continuing']],
  [/てある/y, ['resulting state']],
  [/ておく/y, ['do in advance']],
  [/てしまう|ちゃう/y, ['completed / regret']],
  [/てみる/y, ['try doing']],
  [/ていく|てくる/y, ['goes on / comes to']],
  [/たことがある/y, ['have done']],
  [/ことができる/y, ['can do']],
  [/たほうがいい/y, ['had better']],
  [/ようとする/y, ['try to']],
  [/ませんでした/y, ['polite', 'negative', 'past']],
  [/ませんか/y, ['invitation']],
  [/ましょう/y, ["let's (volitional polite)"]],
  [/ません/y, ['polite', 'negative']],
];

const groupCache = new WeakMap();

function isVerbOrAdj(token) {
  return token.pos.startsWith(VERB) || token.pos.startsWith(ADJ);
}

function isChainMember(token) {
  if (!token.isWord) return false;
  if (token.pos === AUX) return true;
  if (token.pos === PARTICLE) return token.pos2 === CONJUNCTIVE && CHAIN_PARTICLES.has(token.surface);
  if (isVerbOrAdj(token)) return token.pos2 === NON_INDEPENDENT || token.pos2 === SUFFIX;
  return false;
}

function isSaHenHead(tokens, i) {
  const token = tokens[i];
  const next = tokens[i + 1];
  return (
    token.isWord &&
    token.pos === NOUN &&
    token.pos2 === SA_HEN &&
    next !== undefined &&
    next.isWord &&
    next.pos.startsWith(VERB) &&
    SURU_VERBS.has(next.base)
  );
}

function chainEnd(tokens, from) {
  let end = from;
  while (end + 1 < tokens.length && isChainMember(tokens[end + 1])) end++;
  return end;
}

function buildGroups(tokens) {
  const groups = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.isWord) {
      i++;
      continue;
    }
    let end = i;
    if (isSaHenHead(tokens, i)) end = chainEnd(tokens, i + 1);
    else if (isVerbOrAdj(token) || isChainMember(token)) end = chainEnd(tokens, i);
    groups.push({ lead: i, end, tokens: tokens.slice(i, end + 1) });
    i = end + 1;
  }
  return groups;
}

function groupTokens(tokens) {
  let groups = groupCache.get(tokens);
  if (!groups) {
    groups = buildGroups(tokens);
    groupCache.set(tokens, groups);
  }
  return groups;
}

function joinSurfaces(tokens, from, to) {
  return tokens.slice(from, to + 1).map((token) => token.surface).join('');
}

function patternAt(text, offsets, i) {
  for (const [re, labels] of PATTERNS) {
    re.lastIndex = offsets[i];
    const match = re.exec(text);
    if (!match) continue;
    const end = offsets[i] + match[0].length;
    let covered = 0;
    while (i + covered < offsets.length && offsets[i + covered] < end) covered++;
    const boundary = i + covered < offsets.length ? offsets[i + covered] : text.length;
    if (boundary !== end) continue;
    return { covered, labels };
  }
  return null;
}

function tokenLabels(token) {
  return LABELS.get(token.base) ?? LABELS.get(token.surface) ?? [token.base];
}

function chainLabels(tokens, from, to) {
  if (from > to) return [];
  const offsets = [];
  let text = '';
  for (let k = from; k <= to; k++) {
    offsets.push(text.length);
    text += tokens[k].surface;
  }
  const labels = [];
  let i = 0;
  while (i < offsets.length) {
    const hit = patternAt(text, offsets, i);
    if (hit) {
      if (hit.covered > 1 && TE_FORMS.has(tokens[from + i].surface)) labels.push('te-form');
      labels.push(...hit.labels);
      i += hit.covered;
    } else {
      labels.push(...tokenLabels(tokens[from + i]));
      i++;
    }
  }
  return labels.filter((label, idx) => idx === 0 || label !== labels[idx - 1]);
}

function lookupToken(dictionary, token, candidates) {
  for (const form of candidates) {
    if (dictionary.lookup(form).length > 0) return { dictForm: form, entries: dictionary.lookup(token) };
  }
  return null;
}

function result(tokens, from, to, hit, inflection) {
  return {
    span: {
      startToken: from,
      endToken: to,
      start: tokens[from].start,
      end: tokens[to].end,
      text: joinSurfaces(tokens, from, to),
    },
    entries: hit.entries,
    dictForm: hit.dictForm,
    inflection,
  };
}

function hasVsSense(entry) {
  return entry.senses.some((sense) => sense.pos.some((code) => code.startsWith('vs')));
}

function resolveSaHen(tokens, group, dictionary) {
  const noun = tokens[group.lead];
  const suru = noun.base + 'する';
  let entries = dictionary.lookup(suru);
  if (entries.length === 0) {
    entries = dictionary.lookup(noun.base).sort((a, b) => Number(hasVsSense(b)) - Number(hasVsSense(a)));
  }
  if (entries.length === 0) return null;
  return result(tokens, group.lead, group.end, { dictForm: suru, entries }, chainLabels(tokens, group.lead + 2, group.end));
}

function isSingleNoun(tokens, k) {
  return tokens[k].isWord && tokens[k].pos === NOUN && !isSaHenHead(tokens, k);
}

function resolveCompound(tokens, lead, dictionary) {
  let runStart = lead;
  while (runStart > 0 && isSingleNoun(tokens, runStart - 1)) runStart--;
  let runEnd = lead;
  while (runEnd + 1 < tokens.length && isSingleNoun(tokens, runEnd + 1)) runEnd++;
  for (let start = runStart; start <= lead; start++) {
    for (let end = Math.min(start + MAX_COMPOUND - 1, runEnd); end >= lead; end--) {
      if (end === start) continue;
      const text = joinSurfaces(tokens, start, end);
      const entries = dictionary.lookup(text);
      if (entries.length > 0) return result(tokens, start, end, { dictForm: text, entries }, []);
    }
  }
  return null;
}

function resolveGroup(tokens, group, dictionary) {
  const { lead, end } = group;
  const head = tokens[lead];
  if (isSaHenHead(tokens, lead)) return resolveSaHen(tokens, group, dictionary);
  if (isVerbOrAdj(head) || end > lead) {
    const hit = lookupToken(dictionary, head, [head.base, head.surface]);
    return hit ? result(tokens, lead, end, hit, chainLabels(tokens, lead + 1, end)) : null;
  }
  if (head.pos === NOUN) {
    const compound = resolveCompound(tokens, lead, dictionary);
    if (compound) return compound;
  }
  const hit = lookupToken(dictionary, head, [head.base, head.surface, head.reading]);
  return hit ? result(tokens, lead, lead, hit, []) : null;
}

function lookupAt(tokens, index, dictionary) {
  const token = tokens[index];
  if (!token || !token.isWord) return null;
  const group = groupTokens(tokens).find((g) => g.lead <= index && index <= g.end);
  return group ? resolveGroup(tokens, group, dictionary) : null;
}

module.exports = { lookupAt, groupTokens };
