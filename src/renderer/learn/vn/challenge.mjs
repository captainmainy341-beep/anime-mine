import { checkReading } from '../../lib/answer.mjs';
import { romajiToKana, toHiragana } from '../../lib/romaji.mjs';

export const CHALLENGE_TYPES = ['choice', 'reading', 'meaning'];

export const isChallenge = (beat) => CHALLENGE_TYPES.includes(beat?.type);

// Live conversion while the learner types: romaji becomes kana, kana passes through.
export function typedKana(raw, { final = false } = {}) {
  return toHiragana(romajiToKana(raw, { final }));
}

// Grades one attempt. Results mirror the review session: correct, incorrect, or invalid (no penalty).
export function gradeAttempt(beat, input) {
  if (beat.type === 'reading') {
    if (typeof input !== 'string') return { result: 'invalid' };
    return checkReading(input, { accepted: beat.answers });
  }
  const picked = Number.isInteger(input) ? input : -1;
  if (beat.type === 'choice') {
    const option = beat.options[picked];
    if (!option) return { result: 'invalid' };
    return option.correct ? { result: 'correct' } : { result: 'incorrect', awkward: option.awkward ?? null };
  }
  if (beat.type === 'meaning') {
    if (picked < 0 || picked >= beat.options.length) return { result: 'invalid' };
    return picked === beat.correct ? { result: 'correct' } : { result: 'incorrect' };
  }
  return { result: 'invalid' };
}

export const GENERIC_AWKWARD = {
  choice: { who: null, text: '…少し、へんな ふんいきに なった。もう一度。', en: 'That came out a little awkward. Try again.' },
  reading: { who: null, text: '…読めない。もう一度 よく 見てみよう。', en: "You can't quite read it. Look again." },
  meaning: { who: null, text: '…ちがう 気がする。もう一度。', en: 'That does not feel right. Try again.' },
};

export function revealAnswer(beat) {
  if (beat.type === 'reading') return beat.answers[0];
  if (beat.type === 'choice') return beat.options.find((o) => o.correct).text;
  return beat.options[beat.correct];
}
