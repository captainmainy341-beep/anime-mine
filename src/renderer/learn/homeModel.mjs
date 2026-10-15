export function levelGap(level) {
  return Math.max(0, (level.needed ?? 0) - (level.kanjiPassed ?? 0));
}

export function levelSentence(level) {
  const gap = levelGap(level);
  if (gap === 0) return `Ready to unlock level ${level.current + 1}`;
  return `${gap} kanji must reach Guru to unlock level ${level.current + 1}`;
}

export const PACK_HINT = 'Download the kanji & vocab data first';

export function lessonsDisabledReason(count) {
  return count > 0 ? null : 'Nothing to learn right now';
}

export function reviewsDisabledReason(count) {
  return count > 0 ? null : 'No reviews due';
}

export function vacationBanner(on) {
  return on ? 'Vacation mode: reviews paused' : null;
}

export function scanSummary({ points, sentences }) {
  return `Found examples for ${points} grammar point${points === 1 ? '' : 's'} (${sentences} sentence${sentences === 1 ? '' : 's'})`;
}

export function scanProgressText({ done, total }) {
  return `Scanning ${done}/${total} episodes…`;
}

export function groupHue(key) {
  const hues = {
    apprentice: 330,
    guru: 250,
    master: 210,
    enlightened: 170,
    burned: 0,
    beginner: 330,
    adept: 250,
    seasoned: 190,
    expert: 150,
    completed: 40,
  };
  return hues[key] ?? 200;
}
