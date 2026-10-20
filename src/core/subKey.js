const MAX_COLORS = 8;
const MIN_TOLERANCE = 4;
const MAX_TOLERANCE = 96;
const DEFAULT_TOLERANCE = 40;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

function normalizeColor(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
  return value.map((channel) => clamp(Math.round(channel), 0, 255));
}

// A subtitle colour key: sampled pixel colours plus how far (per channel) a pixel may differ and still count as text.
function normalizeKey(value) {
  if (value === null || typeof value !== 'object') return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (!Array.isArray(value.colors)) return null;
  const seen = new Set();
  const colors = [];
  for (const raw of value.colors) {
    const color = normalizeColor(raw);
    if (!color || seen.has(color.join())) continue;
    seen.add(color.join());
    colors.push(color);
  }
  if (colors.length === 0) return null;
  const tolerance = Number.isFinite(value.tolerance)
    ? clamp(Math.round(value.tolerance), MIN_TOLERANCE, MAX_TOLERANCE)
    : DEFAULT_TOLERANCE;
  return { colors: colors.slice(-MAX_COLORS), tolerance };
}

// ffmpeg geq filter that turns a gbrp frame into a red-plane mask: 255 where a pixel is within tolerance of any key colour.
function keyMaskFilter(key) {
  const near = key.colors.map(
    ([r, g, b]) => `lt(max(max(abs(r(X,Y)-${r}),abs(g(X,Y)-${g})),abs(b(X,Y)-${b})),${key.tolerance + 1})`,
  );
  return `geq=r='if(gt(${near.join('+')},0),255,0)':g='0':b='0'`;
}

module.exports = { DEFAULT_TOLERANCE, MAX_COLORS, MAX_TOLERANCE, MIN_TOLERANCE, keyMaskFilter, normalizeKey };
