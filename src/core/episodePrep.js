const PASS_STAGE = 5;

function cueText(cue) {
  return typeof cue === 'string' ? cue : (cue.text ?? '');
}

function unlearnedFirst(item) {
  return item.stage < PASS_STAGE ? 0 : 1;
}

async function buildEpisodePrep({ cues, tokenize, known, points, detectGrammar, stageOf, glossFor, wordLimit = 30, grammarLimit = 12 }) {
  const texts = cues.map(cueText).filter((text) => text.trim());
  const wordCounts = new Map();
  const plainReadings = new Map();
  const grammarCounts = new Map();
  for (const text of texts) {
    for (const token of await tokenize(text)) {
      if (known.classify(token) !== 'new') continue;
      const word = token.base || token.surface;
      if (word === token.surface && !plainReadings.has(word)) plainReadings.set(word, token.reading || '');
      const entry = wordCounts.get(word);
      if (entry) entry.count++;
      else wordCounts.set(word, { word, count: 1, example: text });
    }
    for (const id of new Set(detectGrammar(text, points).map((hit) => hit.id))) {
      const entry = grammarCounts.get(id);
      if (entry) entry.count++;
      else grammarCounts.set(id, { id, count: 1, example: text });
    }
  }

  const words = [...wordCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, wordLimit);
  for (const word of words) {
    const gloss = (await glossFor(word.word)) ?? { meanings: [], reading: '' };
    word.meanings = gloss.meanings;
    word.reading = gloss.reading || plainReadings.get(word.word) || '';
  }

  const grammar = [...grammarCounts.values()]
    .map((entry) => {
      const point = points.find((p) => p.id === entry.id);
      return {
        id: entry.id,
        title: point.title,
        jlpt: point.jlpt,
        meaning: point.meaning,
        count: entry.count,
        example: entry.example,
        stage: stageOf(entry.id),
      };
    })
    .sort((a, b) => unlearnedFirst(a) - unlearnedFirst(b) || b.count - a.count)
    .slice(0, grammarLimit);

  return { cueCount: texts.length, words, grammar };
}

module.exports = { buildEpisodePrep };
