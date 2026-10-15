async function extractVocabulary(text, tokenize, statusOf) {
  const rows = new Map();
  const skipped = new Set();
  const tokens = await tokenize(text);
  tokens.forEach((token, index) => {
    if (!token.isWord) return;
    const word = token.base || token.surface;
    if (!word || skipped.has(word)) return;
    const row = rows.get(word);
    if (row) {
      row.count += 1;
      return;
    }
    const status = statusOf(word);
    if (status === 'skip') {
      skipped.add(word);
      return;
    }
    rows.set(word, { word, reading: token.reading ?? null, count: 1, firstIndex: index, status });
  });
  return [...rows.values()];
}

function toWordList(rows, { onlyUnknown = false } = {}) {
  return rows
    .filter((row) => !onlyUnknown || row.status === 'new')
    .map((row) => row.word)
    .join('\n');
}

module.exports = { extractVocabulary, toWordList };
