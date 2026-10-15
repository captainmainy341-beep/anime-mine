import { romajiToKana, toHiragana } from './romaji.mjs';

export { toHiragana };

const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆]/;
const KANJI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆]/;
const ASCII_LETTER = /[a-z]/i;
const ARTICLE = /^(to|a|an|the) /;
const DIGIT = /\d/;

const VOWEL_ROWS = {
  a: 'あかさたなはまやらわがざだばぱぁゃゎ',
  i: 'いきしちにひみりぎじぢびぴぃ',
  u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  e: 'えけせてねへめれげぜでべぺぇ',
  o: 'おこそとのほもよろをごぞどぼぽぉょ',
};
const VOWEL_OF = new Map();
for (const row of Object.values(VOWEL_ROWS)) {
  for (const ch of row) VOWEL_OF.set(ch, row[0]);
}

function normalizeText(s) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripArticle(s) {
  return s.replace(ARTICLE, '');
}

function tolerance(length) {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  if (length <= 11) return 2;
  if (length <= 15) return 3;
  return 4;
}

function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[y.length];
}

function isTypo(input, candidate) {
  if (DIGIT.test(candidate)) return input === candidate;
  return levenshtein(input, candidate) <= tolerance(Array.from(candidate).length);
}

function expandLongVowels(s) {
  let out = '';
  for (const ch of s) {
    const vowel = ch === 'ー' && out ? VOWEL_OF.get(out.slice(-1)) : undefined;
    out += vowel ?? ch;
  }
  return out;
}

function readingKey(s) {
  return expandLongVowels(toHiragana(s).replace(/[.\-。]/g, ''));
}

function clozePair(answer, text) {
  return KANJI.test(answer) ? [answer, text] : [toHiragana(answer), toHiragana(text)];
}

export function checkMeaning(input, { meanings, synonyms = [], blacklist = [] }) {
  const text = normalizeText(input);
  if (!text) return { result: 'invalid' };
  if (JAPANESE.test(text)) return { result: 'invalid', hint: 'Answer in English' };
  const bare = stripArticle(text);
  if (blacklist.some((b) => stripArticle(normalizeText(b)) === bare)) {
    return { result: 'incorrect', hint: 'That meaning is not accepted for this item' };
  }
  const candidates = [...meanings, ...synonyms]
    .map((c) => stripArticle(normalizeText(c)))
    .filter(Boolean);
  return candidates.some((c) => isTypo(bare, c))
    ? { result: 'correct' }
    : { result: 'incorrect' };
}

export function checkReading(input, { accepted, alsoKnown = [] }) {
  const text = input.normalize('NFKC').replace(/\s+/g, '');
  const kana = toHiragana(romajiToKana(text, { final: true }));
  if (!kana || ASCII_LETTER.test(kana) || KANJI.test(kana)) {
    return { result: 'invalid', hint: 'Type the reading in kana' };
  }
  const key = readingKey(kana);
  if (accepted.some((a) => readingKey(a) === key)) return { result: 'correct' };
  if (alsoKnown.some((a) => readingKey(a) === key)) {
    return { result: 'invalid', hint: 'That is a valid reading, but not the one asked for' };
  }
  return { result: 'incorrect' };
}

export function checkCloze(input, { answers }) {
  let text = input.normalize('NFKC').replace(/\s+/g, '');
  if (!text) return { result: 'invalid' };
  if (/^[a-z]+$/i.test(text)) text = romajiToKana(text, { final: true });
  const forms = answers.map((a) => a.normalize('NFKC').replace(/\s+/g, ''));
  if (forms.some((a) => {
    const [x, y] = clozePair(a, text);
    return x === y;
  })) {
    return { result: 'correct' };
  }
  if (forms.some((a) => {
    const [x, y] = clozePair(a, text);
    return Array.from(a).length >= 4 && levenshtein(x, y) === 1;
  })) {
    return { result: 'invalid', hint: 'Close — check the conjugation' };
  }
  return { result: 'incorrect' };
}
