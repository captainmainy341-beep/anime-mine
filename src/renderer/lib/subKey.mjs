export const MAX_COLORS = 8;
export const MIN_TOLERANCE = 4;
export const MAX_TOLERANCE = 96;
export const DEFAULT_TOLERANCE = 40;

// Wand click: add a sampled colour to the key (newest last, oldest dropped past the cap, repeats ignored).
export function addKeyColor(key, color) {
  const colors = (key?.colors ?? []).filter((c) => c.join() !== color.join());
  colors.push(color);
  return { colors: colors.slice(-MAX_COLORS), tolerance: key?.tolerance ?? DEFAULT_TOLERANCE };
}

export function setKeyTolerance(key, tolerance) {
  return { colors: key.colors, tolerance: Math.min(Math.max(Math.round(tolerance), MIN_TOLERANCE), MAX_TOLERANCE) };
}

// 1 where an RGBA pixel is within `tolerance` (per channel) of any key colour, else 0.
export function keyMask(rgba, width, height, key) {
  const mask = new Uint8Array(width * height);
  const { colors, tolerance } = key;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    for (const c of colors) {
      if (Math.abs(r - c[0]) <= tolerance && Math.abs(g - c[1]) <= tolerance && Math.abs(b - c[2]) <= tolerance) {
        mask[i] = 1;
        break;
      }
    }
  }
  return mask;
}

// Grow the mask by `radius` pixels (square structuring element) so anti-aliased text edges are covered too.
export function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      const to = Math.min(width - 1, x + radius);
      for (let k = Math.max(0, x - radius); k <= to; k++) across[row + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!across[y * width + x]) continue;
      const to = Math.min(height - 1, y + radius);
      for (let k = Math.max(0, y - radius); k <= to; k++) out[k * width + x] = 1;
    }
  }
  return out;
}

// Reconstruct keyed text by blending nearby unmasked pixels from the same frame.
export function inpaintPixels(rgba, width, height, mask, searchRadius = 24) {
  const result = new Uint8ClampedArray(rgba);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return result;

  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let totalWeight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of directions) {
        for (let distance = 1; distance <= searchRadius; distance++) {
          const nx = x + dx * distance;
          const ny = y + dy * distance;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
          const neighbor = ny * width + nx;
          if (mask[neighbor]) continue;
          const weight = 1 / distance;
          const p = neighbor * 4;
          totalWeight += weight;
          r += rgba[p] * weight;
          g += rgba[p + 1] * weight;
          b += rgba[p + 2] * weight;
          break;
        }
      }
      if (totalWeight === 0) continue;
      const p = i * 4;
      result[p] = r / totalWeight;
      result[p + 1] = g / totalWeight;
      result[p + 2] = b / totalWeight;
    }
  }
  return result;
}

// Turn a 0/1 mask into RGBA pixels with the given colour where set and fully transparent elsewhere.
export function maskToRgba(mask, rgb, out) {
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    out[p] = rgb[0];
    out[p + 1] = rgb[1];
    out[p + 2] = rgb[2];
    out[p + 3] = mask[i] ? 255 : 0;
  }
  return out;
}
