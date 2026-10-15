const fs = require('node:fs/promises');
const path = require('node:path');

const TIME_RANGE = /((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?)/;
const ASS_DEFAULT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

function parseTime(value) {
  return value
    .replace(',', '.')
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

function isValidCue(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function stripTags(text) {
  return text.replace(/<[^>]*>/g, '').trim();
}

function parseBlocks(text) {
  return text.split(/\r?\n\s*\r?\n/).flatMap(block => {
    const lines = block.split(/\r?\n/);
    const index = lines.findIndex(line => TIME_RANGE.test(line));
    if (index === -1) return [];
    const [, start, end] = lines[index].match(TIME_RANGE);
    const cue = { start: parseTime(start), end: parseTime(end), text: stripTags(lines.slice(index + 1).join('\n')) };
    return isValidCue(cue.start, cue.end) ? [cue] : [];
  });
}

function parseDialogue(value, format) {
  if (!['start', 'end', 'text'].every(name => format.includes(name))) return null;
  const parts = value.split(',');
  if (parts.length < format.length) return null;
  const fields = [...parts.slice(0, format.length - 1), parts.slice(format.length - 1).join(',')];
  const field = name => fields[format.indexOf(name)];
  const cue = {
    start: parseTime(field('start').trim()),
    end: parseTime(field('end').trim()),
    style: (field('style') ?? '').trim(),
    text: field('text').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim(),
  };
  return isValidCue(cue.start, cue.end) ? cue : null;
}

const JAPANESE_STYLE = /(^|[^a-z])(jp|jpn|ja|japanese)([^a-z]|$)|日本語|日文/i;

function keepJapaneseCues(cues) {
  if (!cues.some(cue => JAPANESE_STYLE.test(cue.style))) return cues;
  return cues.filter(cue => JAPANESE_STYLE.test(cue.style));
}

function parseAss(text) {
  let section = '';
  let format = ASS_DEFAULT_FORMAT;
  const cues = [];
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[(.+)\]\s*$/);
    if (header) {
      section = header[1].toLowerCase();
      continue;
    }
    const entry = line.match(/^\s*(\w+)\s*:\s?(.*)$/);
    if (section !== 'events' || !entry) continue;
    const key = entry[1].toLowerCase();
    if (key === 'format') format = entry[2].split(',').map(name => name.trim().toLowerCase());
    if (key !== 'dialogue') continue;
    const cue = parseDialogue(entry[2], format);
    if (cue) cues.push(cue);
  }
  return keepJapaneseCues(cues.filter(cue => cue.text && !isCreditBanner(cue))).map(cue => ({ start: cue.start, end: cue.end, text: cue.text }));
}

const CREDIT_TEXT = /編集|同期|字幕|翻訳|提供|制作/;

function isCreditBanner(cue) {
  return cue.start < 1 && cue.end - cue.start >= 8 && CREDIT_TEXT.test(cue.text);
}

function parseSubtitles(text, ext) {
  const cues = ['.ass', '.ssa'].includes(ext.toLowerCase()) ? parseAss(text) : parseBlocks(text);
  return cues.filter(cue => cue.text && !isCreditBanner(cue)).sort((a, b) => a.start - b.start);
}

async function parseSubtitleFile(file) {
  const text = await fs.readFile(file, 'utf8');
  return parseSubtitles(text.replace(/^\uFEFF/, ''), path.extname(file));
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

function toSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

module.exports = { parseSubtitles, parseSubtitleFile, toSrt };
