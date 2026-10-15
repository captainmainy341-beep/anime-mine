const MIN_SIDE = 0.02;

const clamp01 = (n) => Math.min(Math.max(n, 0), 1);

function normalizeCover(value) {
  if (value === null || typeof value !== 'object') return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const left = clamp01(x);
  const top = clamp01(y);
  const width = Math.min(Math.max(w, 0), 1 - left);
  const height = Math.min(Math.max(h, 0), 1 - top);
  if (width < MIN_SIDE || height < MIN_SIDE) return null;
  return { x: left, y: top, w: width, h: height };
}

module.exports = { normalizeCover };
