(function (root) {
  function originPatterns(urls) {
    const patterns = new Set();
    for (const raw of urls) {
      if (typeof raw !== 'string') continue;
      let url;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      patterns.add(`${url.protocol}//${url.hostname.toLowerCase()}/*`);
    }
    return [...patterns].sort();
  }

  const api = { originPatterns };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnimeMineSites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
