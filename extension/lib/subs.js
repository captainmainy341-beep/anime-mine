(function (root) {
  const TIME_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
  const ASS_TIME_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/;
  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

  function stripMarkup(text) {
    return text
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|nbsp);/g, (m) => ENTITIES[m]);
  }

  function parseTime(value) {
    const match = TIME_RE.exec(value.trim());
    if (!match) return null;
    const [, h = '0', m, s, frac] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000;
  }

  function parseAssTime(value) {
    const match = ASS_TIME_RE.exec(value.trim());
    if (!match) return null;
    const [, h, m, s, cs] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(cs.padEnd(2, '0')) / 100;
  }

  function finish(cues) {
    return cues
      .filter((cue) => cue && cue.text && cue.text.trim() && Number.isFinite(cue.start) && Number.isFinite(cue.end))
      .map((cue) => ({ start: cue.start, end: cue.end, text: cue.text.trim() }))
      .sort((a, b) => a.start - b.start);
  }

  function parseTimed(text) {
    const cues = [];
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const arrow = lines.findIndex((line) => line.includes('-->'));
      if (arrow < 0) continue;
      const [startRaw, endRaw] = lines[arrow].split('-->');
      const start = parseTime(startRaw);
      const end = parseTime(endRaw.trim().split(/\s+/)[0]);
      if (start === null || end === null) continue;
      cues.push({ start, end, text: stripMarkup(lines.slice(arrow + 1).join('\n')) });
    }
    return cues;
  }

  function parseVtt(text) {
    const blocks = text.split(/\n\s*\n/).filter((block) => !/^(NOTE|STYLE|REGION)(\s|$)/.test(block.trim()));
    return parseTimed(blocks.join('\n\n'));
  }

  function parseAss(text) {
    const cues = [];
    let inEvents = false;
    let cols = null;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (/^\[.*\]$/.test(line)) {
        inEvents = line.toLowerCase() === '[events]';
        continue;
      }
      if (!inEvents) continue;
      if (/^format:/i.test(line)) {
        cols = line.slice(line.indexOf(':') + 1).split(',').map((name) => name.trim().toLowerCase());
        continue;
      }
      if (!cols || !/^dialogue:/i.test(line)) continue;
      const fields = line.slice(line.indexOf(':') + 1).split(',');
      const textIdx = cols.indexOf('text');
      if (textIdx >= 0) fields.splice(textIdx, fields.length, fields.slice(textIdx).join(','));
      const start = parseAssTime(fields[cols.indexOf('start')] ?? '');
      const end = parseAssTime(fields[cols.indexOf('end')] ?? '');
      if (start === null || end === null) continue;
      const body = (fields[cols.indexOf('text')] ?? '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' ');
      cues.push({ start, end, text: stripMarkup(body) });
    }
    return cues;
  }

  function parseSubtitles(text, filename = '') {
    const body = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    let cues;
    if (/^WEBVTT/.test(body)) cues = parseVtt(body);
    else if (/\[script info\]/i.test(body) || /^\s*dialogue:/im.test(body)) cues = parseAss(body);
    else cues = parseTimed(body);
    return finish(cues);
  }

  function findCue(cues, time) {
    let lo = 0;
    let hi = cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    for (let i = found; i >= 0; i--) {
      if (time < cues[i].end) return cues[i];
    }
    return null;
  }

  function decodeSubtitleBytes(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return new TextDecoder('shift_jis').decode(buffer);
    }
  }

  const api = { parseSubtitles, findCue, decodeSubtitleBytes };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnimeMineSubs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
