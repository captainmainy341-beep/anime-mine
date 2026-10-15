export function learnWordInput({ dictForm, entry, sentenceText }) {
  return {
    word: dictForm,
    kana: entry.kana,
    meanings: entry.senses.map((sense) => sense.glosses.join('; ')).filter(Boolean),
    sentence: { ja: sentenceText },
  };
}

export function grammarChipLabel(hit) {
  return hit.jlpt ? `${hit.title} · ${hit.jlpt}` : hit.title;
}
