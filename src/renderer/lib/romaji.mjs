const TABLE = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', she: 'しぇ', sho: 'しょ',
  sya: 'しゃ', syu: 'しゅ', sye: 'しぇ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', je: 'じぇ', jo: 'じょ',
  jya: 'じゃ', jyu: 'じゅ', jye: 'じぇ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zye: 'じぇ', zyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', che: 'ちぇ', cho: 'ちょ',
  tya: 'ちゃ', tyu: 'ちゅ', tye: 'ちぇ', tyo: 'ちょ',
  cya: 'ちゃ', cyu: 'ちゅ', cye: 'ちぇ', cyo: 'ちょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xwa: 'ゎ', lwa: 'ゎ', xka: 'ゕ', lka: 'ゕ', xke: 'ゖ', lke: 'ゖ',
  xtu: 'っ', xtsu: 'っ', ltu: 'っ', ltsu: 'っ',
};

const PUNCTUATION = { '-': 'ー', '.': '。', ',': '、', '?': '？', '!': '！' };
const KANA = /[\u3040-\u30ff]/;
const LETTER = /[a-z]/;
const VOWEL = /[aiueo]/;

export function romajiToKana(input, { final = false } = {}) {
  const s = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (KANA.test(c) || c === ' ') {
      out += c;
      i += 1;
      continue;
    }
    if (Object.hasOwn(PUNCTUATION, c)) {
      out += PUNCTUATION[c];
      i += 1;
      continue;
    }
    if (c === 'n') {
      if (next === undefined) {
        out += final ? 'ん' : 'n';
        i += 1;
        continue;
      }
      if (next === "'") {
        out += 'ん';
        i += 2;
        continue;
      }
      if (next === 'n') {
        out += 'ん';
        i += i + 2 < s.length ? 1 : 2;
        continue;
      }
      if (!LETTER.test(next) || (!VOWEL.test(next) && next !== 'y')) {
        out += 'ん';
        i += 1;
        continue;
      }
    }
    if (LETTER.test(c) && !VOWEL.test(c) && c !== 'n'
      && (next === c || (c === 't' && s.startsWith('tch', i)))) {
      out += 'っ';
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = 4; len >= 1 && !matched; len--) {
      const key = s.slice(i, i + len);
      if (len <= s.length - i && Object.hasOwn(TABLE, key)) {
        out += TABLE[key];
        i += len;
        matched = true;
      }
    }
    if (matched) continue;
    if (c === 'n') {
      out += 'ん';
    } else {
      out += c;
    }
    i += 1;
  }
  return out;
}

export function toHiragana(s) {
  return s.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function toKatakana(s) {
  return s.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}
