const USED_IN_LIMIT = 20;
const EXAMPLE_LIMIT = 3;
const KANJI_RE = /\p{Script=Han}/u;

const hasDictionary = (dictionary) => Boolean(dictionary?.index);
const isKanji = (ch) => KANJI_RE.test(ch);
const round1 = (n) => Math.round(n * 10) / 10;

function gloss(entry) {
  return entry.senses[0]?.glosses[0] ?? null;
}

function containingEntries(dictionary, text) {
  if (!hasDictionary(dictionary) || !text) return [];
  const seen = new Set();
  const found = [];
  for (const entries of dictionary.index.values()) {
    for (const entry of entries) {
      if (seen.has(entry.id) || !entry.kanji.some((form) => form.includes(text))) continue;
      seen.add(entry.id);
      found.push(entry);
    }
  }
  return found;
}

function wordRow(dictionary, word) {
  const [entry] = hasDictionary(dictionary) ? dictionary.lookup(word) : [];
  return { text: word, reading: entry?.kana[0] ?? null, gloss: entry ? gloss(entry) : null };
}

function entryRow(entry) {
  return { text: entry.kanji[0] ?? entry.kana[0], reading: entry.kana[0] ?? null, gloss: gloss(entry) };
}

function groupSenses(senses) {
  const groups = new Map();
  for (const sense of senses) {
    const pos = sense.pos.join(', ');
    groups.set(pos, [...(groups.get(pos) ?? []), ...sense.glosses]);
  }
  return [...groups].map(([pos, glosses]) => ({ pos, glosses }));
}

function formUsage(corpus, forms) {
  const counts = forms.map((form) => (corpus ? corpus.wordCount(form.text) : 0));
  const total = counts.reduce((sum, count) => sum + count, 0);
  return forms.map((form, i) => ({
    ...form,
    usagePct: total ? round1((100 * counts[i]) / total) : null,
  }));
}

function entryDetail(entry, corpus) {
  const forms = entry.kanji.length
    ? entry.kanji.map((text) => ({ text, reading: entry.kana[0] ?? null }))
    : entry.kana.map((text) => ({ text, reading: text }));
  return {
    id: entry.id,
    forms: formUsage(corpus, forms),
    senses: groupSenses(entry.senses),
    common: entry.common,
  };
}

function frequency(corpus, text) {
  return corpus
    ? { rank: corpus.globalRank(text), bucket: corpus.frequencyBucket(text) }
    : { rank: null, bucket: null };
}

function kanjiKeywords(text, kanjidic) {
  return [...new Set([...text].filter(isKanji))].map((char) => ({
    char,
    keyword: kanjidic?.get(char)?.keyword ?? null,
  }));
}

function wordDetail(deps, key) {
  const { dictionary, kanjidic, examples, pitch, corpus, known } = deps;
  const entries = hasDictionary(dictionary) ? dictionary.lookup(key) : [];
  const [primary] = entries;
  const primaryText = primary ? (primary.kanji[0] ?? primary.kana[0]) : key;
  const reading = primary?.kana[0] ?? null;
  const usedIn = primary?.kanji[0]
    ? containingEntries(dictionary, primary.kanji[0]).filter((entry) => entry.id !== primary.id)
    : [];
  return {
    key,
    entries: entries.map((entry) => entryDetail(entry, corpus)),
    kanji: primary?.kanji[0] ? kanjiKeywords(primary.kanji[0], kanjidic) : [],
    pitch: pitch && primary ? pitch.lookup(primaryText, reading) : null,
    frequency: frequency(corpus, primaryText),
    usedInWords: usedIn.slice(0, USED_IN_LIMIT).map(entryRow),
    usedInCount: usedIn.length,
    examples: examples && primary ? examples.forWord(primary.id, EXAMPLE_LIMIT) : [],
    status: known ? known.status(key) : null,
  };
}

function kanjiDetail(deps, char) {
  const { dictionary, kanjidic, examples, corpus, known } = deps;
  const info = kanjidic?.get(char) ?? {
    char,
    keyword: null,
    meanings: [],
    on: [],
    kun: [],
    strokes: null,
    grade: null,
    jlpt: null,
    newspaperRank: null,
    heisig: null,
    radical: { number: null, name: null },
    kanken: null,
  };
  const used = containingEntries(dictionary, char);
  const corpusWords = corpus ? corpus.wordsWith(char, USED_IN_LIMIT) : [];
  const usedInVocab = corpusWords.length
    ? corpusWords.map(({ word }) => wordRow(dictionary, word))
    : used.filter((entry) => entry.common).slice(0, USED_IN_LIMIT).map(entryRow);
  return {
    ...info,
    frequency: corpus
      ? { rank: corpus.kanjiRank(char), bucket: corpus.kanjiFrequencyBucket(char) }
      : { rank: null, bucket: null },
    usedInKanji: [],
    usedInVocab,
    usedInCount: used.length,
    examples: examples ? examples.forKanji(char, EXAMPLE_LIMIT) : [],
    status: known ? known.status(char) : null,
  };
}

module.exports = { wordDetail, kanjiDetail };
