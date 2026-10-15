import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMeaning, checkReading, checkCloze } from '../src/renderer/lib/answer.mjs';

test('meaning: article and "to" are ignored on either side', () => {
  assert.equal(checkMeaning('eat', { meanings: ['to eat'] }).result, 'correct');
  assert.equal(checkMeaning('to eat', { meanings: ['eat'] }).result, 'correct');
  assert.equal(checkMeaning('The Dog', { meanings: ['a dog'] }).result, 'correct');
  assert.equal(checkMeaning('eat!', { meanings: ['to eat'] }).result, 'correct');
});

test('meaning: typo tolerance thresholds by candidate length', () => {
  assert.equal(checkMeaning('fush', { meanings: ['fish'] }).result, 'incorrect');
  assert.equal(checkMeaning('applx', { meanings: ['apple'] }).result, 'correct');
  assert.equal(checkMeaning('apl', { meanings: ['apple'] }).result, 'incorrect');
  assert.equal(checkMeaning('incrase', { meanings: ['increase'] }).result, 'correct');
  assert.equal(checkMeaning('incrxsx', { meanings: ['increase'] }).result, 'incorrect');
  assert.equal(checkMeaning('prouciatin', { meanings: ['pronunciation'] }).result, 'correct');
  assert.equal(checkMeaning('prouciatn', { meanings: ['pronunciation'] }).result, 'incorrect');
  assert.equal(checkMeaning('rnationalization', { meanings: ['internationalization'] }).result, 'correct');
  assert.equal(checkMeaning('nationalization', { meanings: ['internationalization'] }).result, 'incorrect');
});

test('meaning: candidates containing digits require exact match', () => {
  assert.equal(checkMeaning('top 10 list', { meanings: ['top 10 list'] }).result, 'correct');
  assert.equal(checkMeaning('top 11 list', { meanings: ['top 10 list'] }).result, 'incorrect');
});

test('meaning: synonyms are accepted', () => {
  assert.equal(checkMeaning('liking', { meanings: ['fond'], synonyms: ['liking'] }).result, 'correct');
});

test('meaning: blacklist gives incorrect with hint', () => {
  const r = checkMeaning('love', { meanings: ['like'], blacklist: ['love'] });
  assert.equal(r.result, 'incorrect');
  assert.equal(typeof r.hint, 'string');
});

test('meaning: empty and Japanese input are invalid', () => {
  assert.equal(checkMeaning('   ', { meanings: ['eat'] }).result, 'invalid');
  assert.equal(checkMeaning('...', { meanings: ['eat'] }).result, 'invalid');
  const r = checkMeaning('好き', { meanings: ['like'] });
  assert.equal(r.result, 'invalid');
  assert.equal(r.hint, 'Answer in English');
});

test('reading: accepted readings match in hiragana, katakana and romaji', () => {
  assert.equal(checkReading('こう', { accepted: ['こう'] }).result, 'correct');
  assert.equal(checkReading('kou', { accepted: ['こう'] }).result, 'correct');
  assert.equal(checkReading('コウ', { accepted: ['こう'] }).result, 'correct');
  assert.equal(checkReading('ko u', { accepted: ['こう'] }).result, 'correct');
  assert.equal(checkReading('konomu', { accepted: ['この.む'] }).result, 'correct');
  assert.equal(checkReading('kono.mu', { accepted: ['この.む'] }).result, 'correct');
  assert.equal(checkReading('hon', { accepted: ['ほん'] }).result, 'correct');
});

test('reading: long vowel mark is treated the same as the vowel', () => {
  assert.equal(checkReading('ookii', { accepted: ['おおきい'] }).result, 'correct');
  assert.equal(checkReading('o-kii', { accepted: ['おおきい'] }).result, 'correct');
  assert.equal(checkReading('おーきい', { accepted: ['おおきい'] }).result, 'correct');
});

test('reading: wrong reading type is invalid with hint', () => {
  const r = checkReading('suku', { accepted: ['こう'], alsoKnown: ['すく'] });
  assert.equal(r.result, 'invalid');
  assert.equal(r.hint, 'That is a valid reading, but not the one asked for');
});

test('reading: English typed into the reading box is invalid', () => {
  const dog = checkReading('dog', { accepted: ['いぬ'] });
  assert.equal(dog.result, 'invalid');
  assert.equal(dog.hint, 'Type the reading in kana');
  assert.equal(checkReading('eat', { accepted: ['たべる'] }).result, 'invalid');
  assert.equal(checkReading('', { accepted: ['こう'] }).result, 'invalid');
});

test('reading: kanji typed is invalid', () => {
  assert.equal(checkReading('好', { accepted: ['こう'] }).result, 'invalid');
});

test('reading: wrong reading is incorrect', () => {
  assert.equal(checkReading('kao', { accepted: ['こう'] }).result, 'incorrect');
});

test('cloze: exact matches in kanji, kana and romaji', () => {
  const answers = ['食べます', 'たべます'];
  assert.equal(checkCloze('食べます', { answers }).result, 'correct');
  assert.equal(checkCloze('たべます', { answers }).result, 'correct');
  assert.equal(checkCloze('tabemasu', { answers }).result, 'correct');
  assert.equal(checkCloze('食べ ます', { answers }).result, 'correct');
  assert.equal(checkCloze('タベマス', { answers: ['たべます'] }).result, 'correct');
});

test('cloze: near miss on a long enough answer is invalid with hint', () => {
  const r = checkCloze('tabemasi', { answers: ['たべます'] });
  assert.equal(r.result, 'invalid');
  assert.equal(r.hint, 'Close — check the conjugation');
});

test('cloze: near miss on a short answer is incorrect', () => {
  assert.equal(checkCloze('iki', { answers: ['いく'] }).result, 'incorrect');
});

test('cloze: distant answer is incorrect and empty input is invalid', () => {
  assert.equal(checkCloze('tabemasen', { answers: ['たべます'] }).result, 'incorrect');
  assert.equal(checkCloze('   ', { answers: ['たべます'] }).result, 'invalid');
});
