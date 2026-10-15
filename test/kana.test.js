const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toHiragana } = require('../src/core/kana');

test('toHiragana converts katakana in U+30A1-30F6 and leaves everything else', () => {
  assert.equal(toHiragana('アイウエオ'), 'あいうえお');
  assert.equal(toHiragana('ヴァ'), 'ゔぁ');
  assert.equal(toHiragana('ヶ'), 'ゖ');
  assert.equal(toHiragana('ヷ・ー'), 'ヷ・ー');
  assert.equal(toHiragana('漢字 かな abc'), '漢字 かな abc');
  assert.equal(toHiragana(''), '');
});
