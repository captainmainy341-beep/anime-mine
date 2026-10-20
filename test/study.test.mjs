import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardDocument, createCardDocumentCache, deckLabel, easeForKey, gradeButtons, plainSentence, sessionSummary } from '../src/renderer/lib/study.mjs';

const card = {
  id: 1,
  deck: 'Core',
  question: '<b>猫</b>',
  answer: '<i>cat</i>',
  css: '.card { color: red; } </style><script>x()</script>',
  audio: null,
  intervals: ['<1m', '6m', '1d', '4d'],
};

test('cardDocument puts the CSP meta first in the head', () => {
  const doc = cardDocument(card, 'question');
  assert.match(doc, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'">/);
});

test('cardDocument escapes closing style tags in the card css', () => {
  const doc = cardDocument(card, 'question');
  assert.ok(doc.includes('.card { color: red; } <\\/style><script>x()</script>'));
  assert.equal(doc.match(/<\/style>/g).length, 2);
});

test('cardDocument renders the question side only for question', () => {
  const doc = cardDocument(card, 'question');
  assert.ok(doc.includes('<body class="card"><b>猫</b></body>'));
  assert.ok(!doc.includes('<i>cat</i>'));
});

test('cardDocument renders the answer side for answer', () => {
  const doc = cardDocument(card, 'answer');
  assert.ok(doc.includes('<body class="card"><i>cat</i></body>'));
  assert.ok(!doc.includes('<b>猫</b>'));
});

test('cardDocument gives the body Anki’s card class so deck colors and layout apply', () => {
  const doc = cardDocument({ question: '昨日、父から手紙が届いた。', css: '.card { color: #2a1b0a; background: #fffaf0; }' }, 'question');
  assert.match(doc, /<body class="card">/);
});

test('cardDocument has a readable light fallback and leaves layout to the deck CSS', () => {
  const doc = cardDocument({}, 'question');
  const base = doc.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(base, /background:\s*#fffaf0/);
  assert.match(base, /color:\s*#2a1b0a/);
  assert.doesNotMatch(base, /display:\s*flex/);
});

test('app-themed cards use the paper palette without changing the card content or CSP', () => {
  const doc = cardDocument(card, 'answer', { theme: 'app' });
  assert.match(doc, /class="card am-card"/);
  assert.match(doc, /--am-paper:\s*#f5f2ea/);
  assert.match(doc, /--am-red:\s*#ff2e6e/);
  assert.ok(doc.includes('<i>cat</i>'));
  assert.match(doc, /default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'/);
  assert.doesNotMatch(doc, /allow-scripts/);
});

test('cardDocument marks the app theme card side so the theme can lay out front and back', () => {
  assert.match(cardDocument(card, 'question', { theme: 'app' }), /<body class="card am-card" data-side="question">/);
  assert.match(cardDocument(card, 'answer', { theme: 'app' }), /<body class="card am-card" data-side="answer">/);
  assert.doesNotMatch(cardDocument(card, 'answer'), /data-side/);
});

test('app theme bounds images without removing the native card-style option', () => {
  const doc = cardDocument(card, 'answer', { theme: 'app' });
  assert.match(doc, /--am-shot:\s*290px/);
  assert.match(doc, /object-fit:\s*cover/);
  assert.doesNotMatch(cardDocument(card, 'answer'), /am-card/);
});

test('card documents are built once per card, side and style, not once per grade save', () => {
  let builds = 0;
  const get = createCardDocumentCache((c, side, theme) => `${++builds}:${side}:${theme}`);
  const first = get(card, 'question', 'app');
  assert.equal(get(card, 'question', 'app'), first);
  get(card, 'answer', 'app');
  get(card, 'answer', 'original');
  get(card, 'answer', 'original');
  get({ ...card }, 'question', 'app');
  assert.equal(builds, 4);
});

test('deckLabel keeps the full parent path separate from the short deck name', () => {
  assert.deepEqual(deckLabel('JAP LEARN::AJT JP1K'), { name: 'AJT JP1K', parent: 'JAP LEARN' });
  assert.deepEqual(deckLabel('A::B::C'), { name: 'C', parent: 'A / B' });
  assert.deepEqual(deckLabel('Core'), { name: 'Core', parent: '' });
});

test('gradeButtons pairs each ease with its label and interval', () => {
  assert.deepEqual(gradeButtons(card), [
    { ease: 1, label: 'Again', interval: '<1m' },
    { ease: 2, label: 'Hard', interval: '6m' },
    { ease: 3, label: 'Good', interval: '1d' },
    { ease: 4, label: 'Easy', interval: '4d' },
  ]);
});

test('gradeButtons leaves interval empty when intervals are missing', () => {
  assert.deepEqual(gradeButtons({ intervals: [] }).map((b) => b.interval), ['', '', '', '']);
  assert.deepEqual(gradeButtons({}).map((b) => b.label), ['Again', 'Hard', 'Good', 'Easy']);
});

test('sessionSummary reports nothing reviewed for zero', () => {
  assert.equal(sessionSummary({ reviewed: 0, again: 0 }), 'Nothing reviewed yet');
});

test('sessionSummary reports the rounded percentage correct', () => {
  assert.equal(sessionSummary({ reviewed: 12, again: 2 }), '12 reviewed · 83% correct');
  assert.equal(sessionSummary({ reviewed: 3, again: 0 }), '3 reviewed · 100% correct');
  assert.equal(sessionSummary({ reviewed: 1, again: 1 }), '1 reviewed · 0% correct');
});

test('easeForKey maps 1 to 4 and rejects other keys', () => {
  assert.equal(easeForKey('1'), 1);
  assert.equal(easeForKey('4'), 4);
  assert.equal(easeForKey('0'), null);
  assert.equal(easeForKey('5'), null);
  assert.equal(easeForKey('a'), null);
  assert.equal(easeForKey(' 1'), null);
  assert.equal(easeForKey(''), null);
});

test('plainSentence drops ruby readings, tags, Anki furigana brackets and entities', () => {
  assert.equal(plainSentence('<ruby>約束<rt>やくそく</rt></ruby>を<b>破</b>る&amp;'), '約束を破る&');
  assert.equal(plainSentence('今日[きょう]は&nbsp;晴れ<br>だ'), '今日は 晴れ だ');
  assert.equal(plainSentence(undefined), '');
});
