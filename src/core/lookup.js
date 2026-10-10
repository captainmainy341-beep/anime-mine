const NON_INDEPENDENT = '非自立';
const PARTICLE = '助詞';
const MAX_COMPOUND = 4;
const TE_PARTICLES = new Set(['て', 'で', 'ちゃ', 'じゃ', 'ば']);

const LABELS = new Map([
  ['ます', ['polite']],
  ['です', ['polite']],
  ['た', ['past']],
  ['だ', ['past']],
  ['ない', ['negative']],
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
  ['ば', ['conditional']],
  ['よう', ['volitional']],
  ['う', ['volitional']],
  ['ちゃう', ['completed', 'regret']],
  ['しまう', ['completed', 'regret']],
  ['おく', ['do in advance']],
  ['そう', ['looks like']],
  ['すぎる', ['too much']],
]);

const PHRASE_LABELS = new Map([
  ['ません', ['polite', 'negative']],
  ['ませんでした', ['polite', 'negative', 'past']],
  ['なかった', ['past', 'negative']],
]);

function isVerbOrAdj(token) {
  return token.pos.startsWith('動詞') || token.pos.startsWith('形容詞');
}

function isIndependentVerbOrAdj(token) {
  return isVerbOrAdj(token) && token.pos2 !== NON_INDEPENDENT;
}

function isInflection(token) {
  if (!token.isWord) return false;
  if (token.pos === '助動詞') return true;
  if (token.pos === PARTICLE) return token.pos2 === '接続助詞' && TE_PARTICLES.has(token.surface);
  if (isVerbOrAdj(token)) return token.pos2 === NON_INDEPENDENT;
  return false;
}

function joinSurfaces(tokens, from, to) {
  return tokens.slice(from, to + 1).map((token) => token.surface).join('');
}

function chainEnd(tokens, lead) {
  let end = lead;
  while (end + 1 < tokens.length && isInflection(tokens[end + 1])) end++;
  return end;
}

function chainLeadFor(tokens, index) {
  let j = index;
  while (j > 0 && isInflection(tokens[j])) j--;
  return isIndependentVerbOrAdj(tokens[j]) ? j : null;
}

function groupStart(tokens, lead) {
  let start = lead;
  while (start > 0 && tokens[start - 1].isWord && tokens[start - 1].pos.startsWith('名詞')) start--;
  return start;
}

function leadFrom(tokens, start) {
  for (let k = start; k < tokens.length && tokens[k].isWord && tokens[k].pos !== PARTICLE; k++) {
    if (isIndependentVerbOrAdj(tokens[k])) return k;
  }
  return null;
}

function wordRunEnd(tokens, start) {
  let end = start;
  while (end + 1 < tokens.length && tokens[end + 1].isWord) end++;
  return end;
}

function candidates(tokens, start, end, lead) {
  if (end === start) return [tokens[start].base, tokens[start].surface, tokens[start].reading];
  const surface = joinSurfaces(tokens, start, end);
  if (lead !== null && end <= lead) {
    return [joinSurfaces(tokens, start, end - 1) + tokens[end].base, surface];
  }
  return [surface];
}

function phraseAt(tokens, i, to) {
  for (let len = Math.min(4, to - i + 1); len >= 2; len--) {
    const labels = PHRASE_LABELS.get(joinSurfaces(tokens, i, i + len - 1));
    if (labels) return { labels, len };
  }
  return null;
}

function chainLabels(tokens, from, to) {
  const labels = [];
  let i = from;
  while (i <= to) {
    const phrase = phraseAt(tokens, i, to);
    if (phrase) {
      labels.push(...phrase.labels);
      i += phrase.len;
      continue;
    }
    const token = tokens[i];
    labels.push(...(LABELS.get(token.base) ?? LABELS.get(token.surface) ?? [token.base]));
    i++;
  }
  return labels.filter((label, idx) => idx === 0 || label !== labels[idx - 1]);
}

function matchFrom(tokens, start, index, dictionary) {
  const lead = leadFrom(tokens, start);
  const top = Math.max(lead ?? start, Math.min(start + MAX_COMPOUND - 1, wordRunEnd(tokens, start)));
  for (let end = top; end >= start; end--) {
    const reachesLead = lead !== null && end === lead;
    const spanEnd = reachesLead ? chainEnd(tokens, lead) : end;
    if (spanEnd < index) continue;
    for (const query of candidates(tokens, start, end, lead)) {
      const entries = dictionary.lookup(query);
      if (entries && entries.length > 0) {
        return {
          span: {
            startToken: start,
            endToken: spanEnd,
            start: tokens[start].start,
            end: tokens[spanEnd].end,
            text: joinSurfaces(tokens, start, spanEnd),
          },
          entries,
          dictForm: query,
          inflection: reachesLead ? chainLabels(tokens, lead + 1, spanEnd) : [],
        };
      }
    }
  }
  return null;
}

function lookupAt(tokens, index, dictionary) {
  const token = tokens[index];
  if (!token || !token.isWord) return null;
  const lead = chainLeadFor(tokens, index);
  const first = lead === null ? index : groupStart(tokens, lead);
  const last = lead ?? index;
  const starts = Array.from({ length: last - first + 1 }, (_, k) => first + k);
  for (const start of starts) {
    const hit = matchFrom(tokens, start, index, dictionary);
    if (hit) return hit;
  }
  return null;
}

module.exports = { lookupAt };
