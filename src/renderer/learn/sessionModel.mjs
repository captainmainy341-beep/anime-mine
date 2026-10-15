import { romajiToKana } from '../lib/romaji.mjs';
import { checkCloze, checkMeaning, checkReading } from '../lib/answer.mjs';
import { clozeParts, clozeToText, kindLabel } from '../lib/learnView.mjs';

const QUESTIONS = {
  meaning: { label: 'Meaning', tone: 'meaning', placeholder: 'Type the meaning in English', lang: 'en', romaji: false },
  reading: { label: 'Reading', tone: 'reading', placeholder: 'Type the reading', lang: 'ja', romaji: true },
  cloze: { label: 'Fill in the grammar', tone: 'grammar', placeholder: 'Type the missing form', lang: 'ja', romaji: true },
};

export function promptModel(card, question) {
  const { label, tone, placeholder, lang, romaji } = QUESTIONS[question];
  const grammar = card.kind === 'grammar';
  const clozeText = grammar ? card.cloze.ja : null;
  return {
    kind: card.kind,
    kindLabel: kindLabel(card.kind),
    question,
    label,
    tone,
    placeholder,
    lang,
    convertsRomaji: romaji,
    glyph: grammar ? null : (card.char ?? card.word),
    cloze: grammar ? clozeParts(clozeText) : null,
    clozeEnglish: grammar ? card.cloze.en : null,
    hint: grammar ? card.cloze.hint ?? null : null,
    speakText: grammar ? clozeToText(clozeText) : (card.word ?? card.char),
  };
}

export function normaliseInput(question, raw, { final = false } = {}) {
  if (!QUESTIONS[question].romaji) return raw;
  return romajiToKana(raw, { final });
}

export function checkAnswer(question, input, card) {
  if (question === 'meaning') {
    return checkMeaning(input, {
      meanings: card.meanings,
      synonyms: card.synonyms ?? [],
      blacklist: card.blacklist ?? [],
    });
  }
  if (question === 'reading') {
    return checkReading(input, {
      accepted: card.reading.accepted,
      alsoKnown: card.reading.alsoKnown ?? [],
    });
  }
  return checkCloze(input, { answers: card.cloze.answers });
}

export function revealAnswers(question, card) {
  if (question === 'meaning') return card.meanings;
  if (question === 'reading') return card.reading.accepted;
  return card.cloze.answers;
}

export function outcomeOf(result) {
  return result === 'correct' || result === 'incorrect' ? result : 'invalid';
}
