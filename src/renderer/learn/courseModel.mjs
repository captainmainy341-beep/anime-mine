import { checkCloze } from '../lib/answer.mjs';

// A view into the real catalogue, not a second unlock/progression system.
export function trailWindow(rows, selectedId, size = 5) {
  const index = Math.max(0, rows.findIndex(row => row.id === selectedId));
  const start = Math.max(0, Math.min(index - Math.floor(size / 2), rows.length - size));
  return rows.slice(start, start + size).map((row, offset) => ({ ...row, ordinal: start + offset + 1, selected: row.id === selectedId }));
}

export function practiceVerdict(input, answers) {
  const verdict = checkCloze(input, { answers });
  if (verdict.result === 'correct') return { ...verdict, message: 'That’s it. You’ve got the pattern.' };
  if (verdict.result === 'invalid') return { ...verdict, message: verdict.hint ?? 'Type the missing Japanese phrase first.' };
  return { ...verdict, message: 'Not quite. Check the form, then give it another try.' };
}

// Local furigana also lets quick practice accept kana for kanji-containing answers.
export async function acceptedPracticeAnswers(answers, furigana) {
  const readings = await Promise.all(answers.map(async answer => {
    try { return (await furigana(answer)).map(token => token.ruby || token.text).join(''); }
    catch { return answer; }
  }));
  return [...new Set([...answers, ...readings].filter(Boolean))];
}
