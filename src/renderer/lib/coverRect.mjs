const MIN_SIDE = 0.02;
const BELOW_THRESHOLD = 0.08;
const EXPAND_X = 0.04;
const EXPAND_TOP = 0.14;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

export function pictureRect(boxW, boxH, vw, vh) {
  if (!(vw > 0 && vh > 0)) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / vw, boxH / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

export function rectFromDrag(a, b, pic) {
  const right = pic.left + pic.width;
  const bottom = pic.top + pic.height;
  const left = clamp(Math.min(a.x, b.x), pic.left, right);
  const top = clamp(Math.min(a.y, b.y), pic.top, bottom);
  const w = (clamp(Math.max(a.x, b.x), pic.left, right) - left) / pic.width;
  const h = (clamp(Math.max(a.y, b.y), pic.top, bottom) - top) / pic.height;
  if (!(w >= MIN_SIDE && h >= MIN_SIDE)) return null;
  return { x: (left - pic.left) / pic.width, y: (top - pic.top) / pic.height, w, h };
}

export function expandCover(cover) {
  const x = clamp(cover.x - EXPAND_X, 0, 1);
  const y = clamp(cover.y - EXPAND_TOP, 0, 1);
  return {
    x,
    y,
    w: clamp(cover.x + cover.w + EXPAND_X, 0, 1) - x,
    h: clamp(cover.y + cover.h, 0, 1) - y,
  };
}

export function coverToPixels(cover, pic) {
  return {
    left: pic.left + cover.x * pic.width,
    top: pic.top + cover.y * pic.height,
    width: cover.w * pic.width,
    height: cover.h * pic.height,
  };
}

export function sourceBand(cover, vw, vh) {
  const below = 1 - cover.y - cover.h;
  const useBelow = cover.y < BELOW_THRESHOLD && below > 0;
  const span = Math.min(cover.h, useBelow ? below : cover.y);
  const sh = Math.max(1, Math.round(span * vh));
  const start = useBelow ? cover.y + cover.h : cover.y - span;
  const sy = Math.min(Math.max(0, Math.round(start * vh)), vh - sh);
  return { sx: cover.x * vw, sy, sw: cover.w * vw, sh };
}
