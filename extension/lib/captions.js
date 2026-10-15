(function (root) {
  const JP_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const TITLE_SUFFIX = /\s+[-|–—]\s+(Netflix|YouTube|Crunchyroll)\s*$/i;
  const MAX_TITLE = 200;
  const MAX_GLOSSES = 6;

  function normalizeCaption(raw) {
    if (raw == null) return '';
    const lines = String(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let out = '';
    for (const line of lines) {
      if (!out) {
        out = line;
        continue;
      }
      const joinWithNothing = JP_CHAR.test(out.slice(-1)) && JP_CHAR.test(line[0]);
      out += (joinWithNothing ? '' : ' ') + line;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function hasJapanese(text) {
    return typeof text === 'string' && JP_CHAR.test(text);
  }

  function charSpans(text) {
    const spans = [];
    let index = 0;
    for (const char of String(text ?? '')) {
      spans.push({ char, index });
      index += char.length;
    }
    return spans;
  }

  function pickWordRange(text, span) {
    const length = String(text ?? '').length;
    if (!span) return { start: 0, end: 0 };
    const start = Math.min(Math.max(0, span.start | 0), length);
    const end = Math.min(Math.max(start, span.end | 0), length);
    return { start, end };
  }

  function extractSurface(text, span) {
    const { start, end } = pickWordRange(text, span);
    return String(text ?? '').slice(start, end);
  }

  function uniqueGlosses(entry) {
    const seen = new Set();
    const out = [];
    for (const sense of entry?.senses ?? []) {
      for (const gloss of sense.glosses ?? []) {
        if (seen.has(gloss)) continue;
        seen.add(gloss);
        out.push(gloss);
      }
    }
    return out.slice(0, MAX_GLOSSES);
  }

  function cleanTitle(documentTitle) {
    const title = String(documentTitle ?? '').replace(TITLE_SUFFIX, '').trim();
    return title.slice(0, MAX_TITLE);
  }

  function buildMinePayload({ mode, text, lookupResult, translation, title, pictureBase64, captionShownAt, captionEndedAt }) {
    const sentence = normalizeCaption(text);
    const payload = { mode, sentence };
    if (mode === 'word') {
      const span = lookupResult?.span ?? null;
      const entry = lookupResult?.entries?.[0] ?? null;
      const surface = span ? span.text : '';
      payload.word = {
        base: lookupResult?.dictForm || surface,
        reading: entry?.kana?.[0] || '',
        surface,
      };
      const meaning = uniqueGlosses(entry).join('; ');
      if (meaning) payload.meaning = meaning;
    }
    if (translation) payload.translation = translation;
    const sourceTitle = cleanTitle(title);
    if (sourceTitle) payload.sourceTitle = sourceTitle;
    if (Number.isFinite(captionShownAt) && captionShownAt > 0) payload.captionShownAt = captionShownAt;
    if (Number.isFinite(captionEndedAt) && captionEndedAt > 0) payload.captionEndedAt = captionEndedAt;
    if (pictureBase64) {
      payload.pictureBase64 = pictureBase64;
      payload.pictureExt = 'jpg';
    }
    return payload;
  }

  const SEASON_EPISODE = /\bS(?:eason)?\s*(\d+)[\s.\-]*(?:Episode|Ep\.?|E)\s*(\d+)/i;
  const EPISODE = /\b(?:Episode|Ep\.?|E)\s*(\d+)/i;
  const JP_EPISODE = /第\s*(\d+)\s*話/;

  function parseEpisodeLabel(text) {
    const label = String(text ?? '');
    const pair = label.match(SEASON_EPISODE);
    if (pair) return { season: parseInt(pair[1], 10), episode: parseInt(pair[2], 10) };
    const episode = label.match(EPISODE) ?? label.match(JP_EPISODE);
    return { season: null, episode: episode ? parseInt(episode[1], 10) : null };
  }

  const api = {
    normalizeCaption,
    hasJapanese,
    charSpans,
    pickWordRange,
    extractSurface,
    buildMinePayload,
    cleanTitle,
    parseEpisodeLabel,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnimeMineCaptions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
