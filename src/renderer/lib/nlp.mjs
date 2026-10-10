const cache = new Map();

export function tokenizeCached(text) {
  if (!cache.has(text)) {
    cache.set(
      text,
      window.api.nlp.tokenize(text).catch((err) => {
        console.error(err);
        cache.delete(text);
        return [];
      }),
    );
  }
  return cache.get(text);
}
