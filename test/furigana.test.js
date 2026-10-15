const { test } = require('node:test');
const assert = require('node:assert/strict');
const { furiganaSegments, furigana, toAnkiFurigana } = require('../src/core/furigana');
const { tokenize } = require('../src/core/tokenizer');

function token(surface, reading, start) {
  return { surface, reading, start, end: start + surface.length };
}

test('kanji token with okurigana aligns the reading to the kanji run', () => {
  assert.deepEqual(furiganaSegments('食べる', [token('食べる', 'たべる', 0)]), [
    { text: '食', ruby: 'た' },
    { text: 'べる' },
  ]);
});

test('alternating kanji and kana runs each get their own reading chunk', () => {
  assert.deepEqual(furiganaSegments('持ち込む', [token('持ち込む', 'もちこむ', 0)]), [
    { text: '持', ruby: 'も' },
    { text: 'ち' },
    { text: '込', ruby: 'こ' },
    { text: 'む' },
  ]);
});

test('kanji-only token gets the whole reading', () => {
  assert.deepEqual(furiganaSegments('今日', [token('今日', 'きょう', 0)]), [{ text: '今日', ruby: 'きょう' }]);
});

test('katakana reading is aligned against hiragana kana anchors', () => {
  assert.deepEqual(furiganaSegments('買い物', [token('買い物', 'カイモノ', 0)]), [
    { text: '買', ruby: 'か' },
    { text: 'い' },
    { text: '物', ruby: 'もの' },
  ]);
});

test('falls back to one ruby segment when a kana run cannot be located', () => {
  assert.deepEqual(furiganaSegments('見る', [token('見る', 'みない', 0)]), [{ text: '見る', ruby: 'みない' }]);
});

test('kana-only tokens and gaps between tokens stay plain', () => {
  const text = '今日は雨だ';
  const tokens = [token('今日', 'きょう', 0), token('は', 'は', 2), token('雨', 'あめ', 3), token('だ', 'だ', 4)];
  assert.deepEqual(furiganaSegments(text, tokens), [
    { text: '今日', ruby: 'きょう' },
    { text: 'は' },
    { text: '雨', ruby: 'あめ' },
    { text: 'だ' },
  ]);
  assert.deepEqual(furiganaSegments('ab 食', [token('食', 'しょく', 3)]), [
    { text: 'ab ' },
    { text: '食', ruby: 'しょく' },
  ]);
});

test('furigana tokenizes then aligns', async () => {
  const segments = await furigana('雨', async () => [token('雨', 'あめ', 0)]);
  assert.deepEqual(segments, [{ text: '雨', ruby: 'あめ' }]);
});

test('toAnkiFurigana puts a space before each ruby segment that does not follow one', () => {
  const segments = [
    { text: 'あれで' },
    { text: '侍女', ruby: 'じじょ' },
    { text: 'が' },
    { text: '務', ruby: 'つと' },
    { text: 'まるな' },
  ];
  assert.equal(toAnkiFurigana(segments), 'あれで 侍女[じじょ]が 務[つと]まるな');
});

test('toAnkiFurigana passes plain text through unchanged', () => {
  assert.equal(toAnkiFurigana([{ text: 'ねこ' }, { text: '！' }]), 'ねこ！');
  assert.equal(toAnkiFurigana([]), '');
});

test('toAnkiFurigana wraps every segment overlapping the highlight, after the leading space', () => {
  const segments = [{ text: 'あれで' }, { text: '侍女', ruby: 'じじょ' }, { text: 'が' }, { text: '務', ruby: 'つと' }];
  assert.equal(
    toAnkiFurigana(segments, { highlight: { start: 3, end: 6 } }),
    'あれで <b>侍女[じじょ]</b><b>が</b> 務[つと]',
  );
  assert.equal(
    toAnkiFurigana(segments, { highlight: { start: 2, end: 4 } }),
    '<b>あれで</b> <b>侍女[じじょ]</b>が 務[つと]',
  );
});

test('toAnkiFurigana escapes HTML in text and readings but not its own markup', () => {
  const segments = [{ text: 'a<b> & c' }, { text: '食', ruby: 'く&' }];
  assert.equal(toAnkiFurigana(segments, { highlight: { start: 0, end: 1 } }), '<b>a&lt;b&gt; &amp; c</b> 食[く&amp;]');
});

test('real tokenizer output rejoins to the original text', async () => {
  for (const text of ['食べる', '今日は雨だ']) {
    const segments = await furigana(text, tokenize);
    assert.equal(segments.map(segment => segment.text).join(''), text);
  }
});

test('toAnkiFurigana encodes literal brackets so only generated readings stay literal', () => {
  const out = toAnkiFurigana([{ text: 'A[B]' }, { text: '漢', ruby: 'かん[x]' }]);
  assert.equal(out, 'A&#91;B&#93; 漢[かん&#91;x&#93;]');
});
