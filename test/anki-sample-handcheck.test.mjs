import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deckDue } from '../src/renderer/anki.mjs';

const require = createRequire(import.meta.url);
const { SampleBrowser } = require('../src/core/ankiSample.js');

test('sample studied count is separate from each deck’s due components', async () => {
  const overview = await new SampleBrowser().overview();
  assert.equal(overview.today.studied, 37);
  for (const deck of overview.decks) {
    assert.equal(deckDue(deck), deck.new + deck.learn + deck.due);
  }
  assert.equal(overview.decks.reduce((sum, deck) => sum + deckDue(deck), 0),
    overview.today.new + overview.today.learning + overview.today.due);
});
