import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnswer,
  normaliseInput,
  outcomeOf,
  promptModel,
  revealAnswers,
} from '../src/renderer/learn/sessionModel.mjs';

const kanji = {
  id: 'k:好',
  kind: 'kanji',
  char: '好',
  meanings: ['like'],
  synonyms: ['fond'],
  blacklist: ['dislike'],
  reading: { accepted: ['こう'], alsoKnown: ['この'], askType: 'on' },
};

const vocab = {
  id: 'v:1',
  kind: 'vocab',
  word: '好き',
  meanings: ['liking'],
  reading: { accepted: ['すき'], alsoKnown: [], askType: null },
};

const radical = { id: 'r:女', kind: 'radical', char: '女', meanings: ['woman'], reading: null };

const grammar = {
  id: 'g:n5-te-mo-ii',
  kind: 'grammar',
  cloze: {
    ja: 'ここで写真を{{撮ってもいい|撮ってもよい}}ですか。',
    en: 'May I take photos here?',
    hint: '撮る + てもいい',
    answers: ['撮ってもいい', '撮ってもよい'],
  },
};

test('prompt model labels meaning, reading and cloze questions', () => {
  assert.equal(promptModel(kanji, 'meaning').label, 'Meaning');
  assert.equal(promptModel(kanji, 'meaning').tone, 'meaning');
  assert.equal(promptModel(kanji, 'reading').label, 'Reading');
  assert.equal(promptModel(kanji, 'reading').tone, 'reading');
  assert.equal(promptModel(grammar, 'cloze').label, 'Fill in the grammar');
  assert.equal(promptModel(grammar, 'cloze').tone, 'grammar');
});

test('prompt model shows the glyph for item kinds and the cloze for grammar', () => {
  assert.equal(promptModel(kanji, 'meaning').glyph, '好');
  assert.equal(promptModel(vocab, 'reading').glyph, '好き');
  assert.equal(promptModel(radical, 'meaning').glyph, '女');
  assert.equal(promptModel(grammar, 'cloze').glyph, null);
  const model = promptModel(grammar, 'cloze');
  assert.equal(model.clozeEnglish, 'May I take photos here?');
  assert.equal(model.hint, '撮る + てもいい');
  assert.equal(model.cloze.before, 'ここで写真を');
  assert.equal(model.cloze.answers[0], '撮ってもいい');
});

test('prompt model names the kind and sets input language per question', () => {
  assert.equal(promptModel(radical, 'meaning').kindLabel, 'Radical');
  assert.equal(promptModel(kanji, 'meaning').lang, 'en');
  assert.equal(promptModel(kanji, 'reading').lang, 'ja');
  assert.equal(promptModel(kanji, 'meaning').convertsRomaji, false);
  assert.equal(promptModel(kanji, 'reading').convertsRomaji, true);
});

test('prompt model speaks the word or the filled-in sentence', () => {
  assert.equal(promptModel(vocab, 'reading').speakText, '好き');
  assert.equal(promptModel(grammar, 'cloze').speakText, 'ここで写真を撮ってもいいですか。');
});

test('normaliseInput converts romaji for reading and cloze only', () => {
  assert.equal(normaliseInput('reading', 'ka'), 'か');
  assert.equal(normaliseInput('cloze', 'tabe'), 'たべ');
  assert.equal(normaliseInput('meaning', 'Ka'), 'Ka');
});

test('checkAnswer routes each question to its checker', () => {
  assert.equal(checkAnswer('meaning', 'like', kanji).result, 'correct');
  assert.equal(checkAnswer('meaning', 'fond', kanji).result, 'correct');
  assert.equal(checkAnswer('meaning', 'dislike', kanji).result, 'incorrect');
  assert.equal(checkAnswer('reading', 'kou', kanji).result, 'correct');
  assert.equal(checkAnswer('reading', 'kono', kanji).result, 'invalid');
  assert.equal(checkAnswer('reading', 'ten', kanji).result, 'incorrect');
  assert.equal(checkAnswer('cloze', 'tottemoii', grammar).result, 'invalid');
  assert.equal(checkAnswer('cloze', 'たべてもいい', grammar).result, 'incorrect');
});

test('revealAnswers lists the accepted answers per question', () => {
  assert.deepEqual(revealAnswers('meaning', kanji), ['like']);
  assert.deepEqual(revealAnswers('reading', kanji), ['こう']);
  assert.deepEqual(revealAnswers('cloze', grammar), ['撮ってもいい', '撮ってもよい']);
});

test('outcomeOf maps checker results to correct, incorrect or invalid', () => {
  assert.equal(outcomeOf('correct'), 'correct');
  assert.equal(outcomeOf('incorrect'), 'incorrect');
  assert.equal(outcomeOf('invalid'), 'invalid');
  assert.equal(outcomeOf(undefined), 'invalid');
});
