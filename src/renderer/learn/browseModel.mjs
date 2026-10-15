import { percent } from '../lib/learnView.mjs';

export const TYPE_FILTERS = [
  ['radical', 'Radicals'],
  ['kanji', 'Kanji'],
  ['vocab', 'Vocabulary'],
  ['custom', 'Mined words'],
];
export const DEFAULT_TYPE = 'kanji';

export function tileModel(item) {
  const classes = ['learn-tile', item.groupKey ? `learn-tile-${item.groupKey}` : 'learn-tile-new'];
  if (item.locked) classes.push('learn-tile-locked');
  return {
    id: item.id,
    label: item.label,
    sub: item.sub ?? '',
    locked: Boolean(item.locked),
    className: classes.join(' '),
  };
}

export function levelProgress(row) {
  const { passed, total } = row.kanji;
  return {
    level: row.level,
    passed,
    total,
    percent: percent(passed, total),
    current: Boolean(row.current),
    locked: Boolean(row.locked),
  };
}

export function parseMeanings(text) {
  return String(text ?? '')
    .split(/[,;，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function addWordPayload({ word, reading, meaning, sentence }) {
  const text = String(word ?? '').trim();
  const kana = String(reading ?? '').trim();
  const meanings = parseMeanings(meaning);
  if (!text) throw new Error('Enter the word.');
  if (!kana) throw new Error('Enter the reading.');
  if (!meanings.length) throw new Error('Enter at least one meaning.');
  const ja = String(sentence ?? '').trim();
  return { word: text, kana: [kana], meanings, sentence: ja ? { ja } : null };
}
