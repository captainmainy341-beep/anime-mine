// Pure manga reader logic. No DOM access, so it runs under node --test.

const HIT_TOLERANCE = 0.01;

function groupsOf(pageCount, spread, landscape) {
  const alone = (i) => !spread || i === 0 || i === pageCount - 1 || landscape(i);
  const groups = [];
  let i = 0;
  while (i < pageCount) {
    if (!alone(i) && i + 1 < pageCount && !alone(i + 1)) {
      groups.push([i, i + 1]);
      i += 2;
    } else {
      groups.push([i]);
      i += 1;
    }
  }
  return groups;
}

// Visible pages are returned in left-to-right display order: RTL puts the lower index on the right.
export function createPager({ pageCount, direction = 'rtl', spread = false, landscape = () => false }) {
  let index = 0;

  function locate() {
    const groups = groupsOf(pageCount, spread, landscape);
    return { groups, at: groups.findIndex((group) => group.includes(index)) };
  }

  function display(group) {
    return direction === 'rtl' ? [...group].reverse() : [...group];
  }

  function current() {
    const { groups, at } = locate();
    return at < 0 ? [] : display(groups[at]);
  }

  function next() {
    const { groups, at } = locate();
    if (at >= 0 && at + 1 < groups.length) index = groups[at + 1][0];
    return current();
  }

  function prev() {
    const { groups, at } = locate();
    if (at > 0) index = groups[at - 1][0];
    return current();
  }

  function goto(page) {
    if (pageCount > 0) index = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
    return current();
  }

  return { next, prev, goto, current };
}

// Nearest neighbours of the visible pages, closest first, excluding the visible pages themselves.
export function preloadWindow(visible, pageCount, radius) {
  if (!visible.length || pageCount <= 0) return [];
  const lo = Math.min(...visible);
  const hi = Math.max(...visible);
  const out = [];
  for (let distance = 1; distance <= radius; distance++) {
    if (lo - distance >= 0) out.push(lo - distance);
    if (hi + distance < pageCount) out.push(hi + distance);
  }
  return out;
}

// x and y are fractions of the page. Returns the smallest matching block index, or -1.
export function hitTestBlock(blocks, x, y) {
  let best = -1;
  let bestArea = Infinity;
  blocks.forEach(({ box }, i) => {
    const inside =
      x >= box.x - HIT_TOLERANCE &&
      x <= box.x + box.w + HIT_TOLERANCE &&
      y >= box.y - HIT_TOLERANCE &&
      y <= box.y + box.h + HIT_TOLERANCE;
    const area = box.w * box.h;
    if (inside && area < bestArea) {
      best = i;
      bestArea = area;
    }
  });
  return best;
}

// Pixel rect around a fractional box, padded by padFraction of the box size and clamped to the image.
export function cropRect(box, imgW, imgH, padFraction) {
  const padX = box.w * imgW * padFraction;
  const padY = box.h * imgH * padFraction;
  const left = Math.min(imgW, Math.max(0, Math.floor(box.x * imgW - padX)));
  const top = Math.min(imgH, Math.max(0, Math.floor(box.y * imgH - padY)));
  const right = Math.min(imgW, Math.max(left, Math.ceil((box.x + box.w) * imgW + padX)));
  const bottom = Math.min(imgH, Math.max(top, Math.ceil((box.y + box.h) * imgH + padY)));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function fitScale(mode, imgW, imgH, viewW, viewH) {
  if (mode === 'width') return imgW > 0 ? viewW / imgW : 1;
  if (mode === 'height') return imgH > 0 ? viewH / imgH : 1;
  return 1;
}

// Per-page box inside a stage: client size minus padding, with the flex gaps between pages removed.
export function fitViewport({ width, height, padX, padY, gap, count }) {
  const n = Math.max(1, count);
  return {
    perW: Math.max(1, (width - padX - gap * (n - 1)) / n),
    viewH: Math.max(1, height - padY),
  };
}

export function clampZoom(zoom, min, max) {
  return Math.min(max, Math.max(min, zoom));
}

// Continuous: a trackpad pinch tick and a wheel notch both scale multiplicatively.
export function zoomStep(zoom, deltaY, min, max) {
  return clampZoom(zoom * Math.exp(-deltaY * 0.01), min, max);
}

// New scroll offset on one axis that keeps the point under the pointer fixed after a zoom.
// origin* is the page's top/left edge in viewport coordinates before and after layout.
export function zoomScroll(scroll, pointer, originBefore, originAfter, ratio) {
  const offset = (pointer - originBefore) * ratio;
  return scroll + originAfter - (pointer - offset);
}

export function shouldSuppressClick(dx, dy, threshold = 4) {
  return Math.hypot(dx, dy) > threshold;
}

// Space pages down (Shift+Space up) by 90% of the view, turning the page only once the scroll edge is reached.
export function spaceStep({ scrollTop, viewHeight, contentHeight, backward }) {
  const scrollBy = viewHeight * 0.9;
  if (backward) return scrollTop > 1 ? { scrollBy: -scrollBy } : { turn: 'prev' };
  const max = Math.max(0, contentHeight - viewHeight);
  return scrollTop < max - 1 ? { scrollBy } : { turn: 'next' };
}

export function progressLabel(visible, pageCount) {
  if (!visible.length) return `0 / ${pageCount}`;
  const pages = [...visible].sort((a, b) => a - b).map((i) => i + 1);
  const range = pages.length > 1 ? `${pages[0]}–${pages[pages.length - 1]}` : `${pages[0]}`;
  return `${range} / ${pageCount}`;
}

export function nextVolume(series, volId) {
  const volumes = series?.volumes ?? [];
  const at = volumes.findIndex((volume) => volume.id === volId);
  return at >= 0 && at + 1 < volumes.length ? volumes[at + 1] : null;
}

export function previousVolume(series, volId) {
  const volumes = series?.volumes ?? [];
  const at = volumes.findIndex((volume) => volume.id === volId);
  return at > 0 ? volumes[at - 1] : null;
}
