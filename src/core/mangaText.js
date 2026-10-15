const KANA_OR_KANJI = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const REPEATED_PUNCTUATION = /([！？。、，．・～])\1+|…+/g;
const POINT_TOLERANCE = 0.02;

function normalizeText(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(REPEATED_PUNCTUATION, run => (run[0] === '…' ? '……' : run[0]));
}

function isNoise(text) {
  return text.length < 2 && !KANA_OR_KANJI.test(text);
}

function cleanBlocks(blocks) {
  return blocks
    .map(block => ({ ...block, text: normalizeText(block.text) }))
    .filter(block => block.text !== '' && !isNoise(block.text));
}

function pageToSentences(blocks) {
  return cleanBlocks(blocks).map(block => block.text);
}

function distanceToBox(box, x, y) {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

function sentenceAtPoint(blocks, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const block of cleanBlocks(blocks)) {
    const distance = distanceToBox(block.box, x, y);
    if (distance < bestDistance) {
      best = block;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= POINT_TOLERANCE ? best.text : null;
}

module.exports = { pageToSentences, sentenceAtPoint };
