const path = require('node:path');
const { loadGrammar: defaultLoadGrammar } = require('../core/grammar');
const { analyzeSentence, MAX_TEXT } = require('../core/sentenceGrammar');

const GRAMMAR_DIR = path.join(__dirname, '../core/data/grammar');

function createGrammarHandlers({ tokenize, loadGrammar = defaultLoadGrammar } = {}) {
  let grammarPromise = null;

  function grammar() {
    if (!grammarPromise) {
      grammarPromise = Promise.resolve()
        .then(() => loadGrammar(GRAMMAR_DIR))
        .catch((err) => {
          grammarPromise = null;
          throw err;
        });
    }
    return grammarPromise;
  }

  const handlers = {
    'grammar:analyze': async (text) => {
      if (typeof text !== 'string' || text.length > MAX_TEXT) {
        throw new Error(`text must be a string of at most ${MAX_TEXT} characters`);
      }
      return analyzeSentence(text, { tokenize, grammar: await grammar() });
    },
  };

  return { handlers, stop: () => {} };
}

module.exports = { createGrammarHandlers };
