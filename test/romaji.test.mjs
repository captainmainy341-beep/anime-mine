import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romajiToKana, toHiragana, toKatakana } from '../src/renderer/lib/romaji.mjs';

test('common words convert', () => {
  assert.equal(romajiToKana('konnichiwa'), 'こんにちわ');
  assert.equal(romajiToKana('shinbun', { final: true }), 'しんぶん');
  assert.equal(romajiToKana('kappa'), 'かっぱ');
  assert.equal(romajiToKana('sensei'), 'せんせい');
  assert.equal(romajiToKana('onnanoko'), 'おんなのこ');
  assert.equal(romajiToKana('kanji'), 'かんじ');
});

test('trailing n becomes ん only when final', () => {
  assert.equal(romajiToKana('hon'), 'ほn');
  assert.equal(romajiToKana('hon', { final: true }), 'ほん');
  assert.equal(romajiToKana("hon'"), 'ほん');
  assert.equal(romajiToKana('hon-'), 'ほんー');
  assert.equal(romajiToKana('ni'), 'に');
});

test('nn and n before consonant', () => {
  assert.equal(romajiToKana('nn', { final: true }), 'ん');
  assert.equal(romajiToKana('nna'), 'んな');
  assert.equal(romajiToKana('nya'), 'にゃ');
});

test('double consonants and tch', () => {
  assert.equal(romajiToKana('matchi'), 'まっち');
  assert.equal(romajiToKana('tchi'), 'っち');
  assert.equal(romajiToKana('zasshi'), 'ざっし');
});

test('small kana via x and l prefixes', () => {
  assert.equal(romajiToKana('xtsu'), 'っ');
  assert.equal(romajiToKana('ltu'), 'っ');
  assert.equal(romajiToKana('xya'), 'ゃ');
  assert.equal(romajiToKana('lyu'), 'ゅ');
  assert.equal(romajiToKana('la'), 'ぁ');
  assert.equal(romajiToKana('xtsuka'), 'っか');
});

test('Hepburn and Kunrei variants', () => {
  assert.equal(romajiToKana('si'), 'し');
  assert.equal(romajiToKana('ti'), 'ち');
  assert.equal(romajiToKana('tu'), 'つ');
  assert.equal(romajiToKana('hu'), 'ふ');
  assert.equal(romajiToKana('fuji'), 'ふじ');
  assert.equal(romajiToKana('zi'), 'じ');
  assert.equal(romajiToKana('sya'), 'しゃ');
  assert.equal(romajiToKana('tya'), 'ちゃ');
  assert.equal(romajiToKana('zya'), 'じゃ');
  assert.equal(romajiToKana('ja'), 'じゃ');
});

test('punctuation maps to Japanese punctuation', () => {
  assert.equal(romajiToKana('a.'), 'あ。');
  assert.equal(romajiToKana('a,b'), 'あ、b');
  assert.equal(romajiToKana('ka?'), 'か？');
  assert.equal(romajiToKana('ka!'), 'か！');
});

test('kana passes through and mixed input is handled per character', () => {
  assert.equal(romajiToKana('こんにちは'), 'こんにちは');
  assert.equal(romajiToKana('koんにちは'), 'こんにちは');
  assert.equal(romajiToKana('ka'), 'か');
});

test('input is case-insensitive', () => {
  assert.equal(romajiToKana('KONNICHIWA'), romajiToKana('konnichiwa'));
});

test('katakana and hiragana conversion', () => {
  assert.equal(toHiragana('カタカナー'), 'かたかなー');
  assert.equal(toKatakana('ひらがな'), 'ヒラガナ');
});
