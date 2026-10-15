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

// Lines that lead back into a missed challenge, so a re-ask reads as part of the scene.
// Picked by challenge type; `end` is used while draining the requeue after the last beat.
export const BRIDGE_LINES = {
  choice: [
    { speaker: true, text: 'あ、ちょっと まって。さっきの こと、もう一度 いい？', en: 'Oh, wait a second. Can we go back to what you said earlier?' },
    { speaker: true, text: 'そういえば、さっきの…。', en: 'Come to think of it, about earlier...' },
  ],
  reading: [
    { speaker: false, text: 'さっきの 字が、まだ 気になる…。', en: 'That word from earlier is still on your mind...' },
    { speaker: false, text: 'もう一度、あの 字を 思い出してみよう。', en: 'Try to picture that word again.' },
  ],
  meaning: [
    { speaker: false, text: 'さっきの ことばを 思い出す。', en: 'You think back to that word from earlier.' },
  ],
  end: [
    { speaker: true, text: 'あ、その前に… もう 一つだけ。', en: 'Oh, before we go... just one more thing.' },
  ],
};

export function bridgeLine(type, { atEnd = false, turn = 0 } = {}) {
  const lines = (atEnd ? BRIDGE_LINES.end : BRIDGE_LINES[type]) ?? BRIDGE_LINES.meaning;
  return lines[turn % lines.length];
}

// Re-asked choices show their options in a different order: a rotation that moves every option.
export function reorder(count, misses) {
  if (count < 2) return [...Array(count).keys()];
  const shift = ((Math.max(1, misses) - 1) % (count - 1)) + 1;
  return Array.from({ length: count }, (_, i) => (i + shift) % count);
}

// The beat as shown on a re-ask: options in `order`, with `correct` remapped for meaning beats.
export function reorderedBeat(beat, order) {
  if (!order || (beat.type !== 'choice' && beat.type !== 'meaning')) return beat;
  if (order.length !== beat.options.length) return beat;
  const options = order.map((i) => beat.options[i]);
  return beat.type === 'meaning' ? { ...beat, options, correct: order.indexOf(beat.correct) } : { ...beat, options };
}
