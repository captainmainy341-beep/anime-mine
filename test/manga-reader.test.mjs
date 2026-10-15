import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampZoom,
  createPager,
  cropRect,
  fitScale,
  fitViewport,
  hitTestBlock,
  nextVolume,
  preloadWindow,
  previousVolume,
  progressLabel,
  shouldSuppressClick,
  spaceStep,
  zoomScroll,
  zoomStep,
} from '../src/renderer/lib/mangaReader.mjs';

const never = () => false;

test('RTL pager shows the lower index on the right of a spread', () => {
  const pager = createPager({ pageCount: 10, direction: 'rtl', spread: true, landscape: never });
  assert.deepEqual(pager.current(), [0]);
  assert.deepEqual(pager.next(), [2, 1]);
  assert.deepEqual(pager.next(), [4, 3]);
  assert.deepEqual(pager.next(), [6, 5]);
  assert.deepEqual(pager.next(), [8, 7]);
  assert.deepEqual(pager.next(), [9]);
  assert.deepEqual(pager.next(), [9]);
  assert.deepEqual(pager.prev(), [8, 7]);
});

test('LTR pager keeps the lower index on the left of a spread', () => {
  const pager = createPager({ pageCount: 10, direction: 'ltr', spread: true, landscape: never });
  assert.deepEqual(pager.next(), [1, 2]);
  assert.deepEqual(pager.goto(4), [3, 4]);
});

test('spread mode shows the first and last page alone', () => {
  const pager = createPager({ pageCount: 4, direction: 'ltr', spread: true, landscape: never });
  assert.deepEqual(pager.goto(0), [0]);
  assert.deepEqual(pager.goto(3), [3]);
  assert.deepEqual(pager.goto(2), [1, 2]);
});

test('a two-page volume in spread mode shows each page alone', () => {
  const pager = createPager({ pageCount: 2, direction: 'rtl', spread: true, landscape: never });
  assert.deepEqual(pager.current(), [0]);
  assert.deepEqual(pager.next(), [1]);
});

test('landscape pages in spread mode show alone and break the pairing', () => {
  const landscape = (i) => i === 2;
  const pager = createPager({ pageCount: 6, direction: 'ltr', spread: true, landscape });
  assert.deepEqual(pager.next(), [1]);
  assert.deepEqual(pager.next(), [2]);
  assert.deepEqual(pager.next(), [3, 4]);
  assert.deepEqual(pager.next(), [5]);
});

test('single-page mode shows one page and clamps navigation', () => {
  const pager = createPager({ pageCount: 3, direction: 'rtl', spread: false });
  assert.deepEqual(pager.goto(1), [1]);
  assert.deepEqual(pager.next(), [2]);
  assert.deepEqual(pager.next(), [2]);
  assert.deepEqual(pager.goto(-5), [0]);
  assert.deepEqual(pager.goto(99), [2]);
});

test('an empty volume has no visible pages', () => {
  const pager = createPager({ pageCount: 0, direction: 'rtl', spread: true });
  assert.deepEqual(pager.current(), []);
  assert.deepEqual(pager.next(), []);
  assert.deepEqual(pager.goto(3), []);
});

test('preloadWindow returns neighbours closest first, excluding visible pages', () => {
  assert.deepEqual(preloadWindow([3], 10, 2), [2, 4, 1, 5]);
  assert.deepEqual(preloadWindow([2, 1], 10, 1), [0, 3]);
});

test('preloadWindow stays inside the volume', () => {
  assert.deepEqual(preloadWindow([0], 10, 2), [1, 2]);
  assert.deepEqual(preloadWindow([8, 9], 10, 3), [7, 6, 5]);
  assert.deepEqual(preloadWindow([0], 1, 5), []);
});

test('preloadWindow is empty without visible pages, pages or radius', () => {
  assert.deepEqual(preloadWindow([], 10, 2), []);
  assert.deepEqual(preloadWindow([3], 0, 2), []);
  assert.deepEqual(preloadWindow([3], 10, 0), []);
});

const blocks = [
  { box: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 } },
  { box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
];

test('hitTestBlock finds the block containing a point', () => {
  assert.equal(hitTestBlock(blocks, 0.2, 0.3), 0);
  assert.equal(hitTestBlock(blocks, 0.55, 0.55), 1);
});

test('hitTestBlock accepts points within 1% outside a box', () => {
  assert.equal(hitTestBlock(blocks, 0.095, 0.3), 0);
  assert.equal(hitTestBlock(blocks, 0.305, 0.3), 0);
  assert.equal(hitTestBlock(blocks, 0.2, 0.505), 0);
});

test('hitTestBlock rejects points beyond the 1% tolerance', () => {
  assert.equal(hitTestBlock(blocks, 0.08, 0.3), -1);
  assert.equal(hitTestBlock(blocks, 0.315, 0.3), -1);
  assert.equal(hitTestBlock(blocks, 0.2, 0.52), -1);
  assert.equal(hitTestBlock(blocks, 0, 0), -1);
  assert.equal(hitTestBlock([], 0.5, 0.5), -1);
});

test('hitTestBlock prefers the smallest overlapping block', () => {
  const overlap = [{ box: { x: 0, y: 0, w: 1, h: 1 } }, { box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } }];
  assert.equal(hitTestBlock(overlap, 0.45, 0.45), 1);
  assert.equal(hitTestBlock(overlap, 0.1, 0.1), 0);
});

test('cropRect pads the box and returns pixel coordinates', () => {
  const box = { x: 0.125, y: 0.25, w: 0.25, h: 0.125 };
  assert.deepEqual(cropRect(box, 800, 800, 0), { x: 100, y: 200, w: 200, h: 100 });
});

test('cropRect clamps padding at the image origin', () => {
  const box = { x: 0.125, y: 0.25, w: 0.25, h: 0.125 };
  assert.deepEqual(cropRect(box, 800, 800, 0.5), { x: 0, y: 150, w: 400, h: 200 });
});

test('cropRect clamps padding at the image far edges', () => {
  const box = { x: 0.9, y: 0.9, w: 0.2, h: 0.2 };
  assert.deepEqual(cropRect(box, 100, 100, 0.06), { x: 88, y: 88, w: 12, h: 12 });
});

test('cropRect clamps a box that starts before the image', () => {
  const box = { x: -0.5, y: 0, w: 0.6, h: 1 };
  assert.deepEqual(cropRect(box, 100, 100, 0), { x: 0, y: 0, w: 10, h: 100 });
});

test('cropRect returns an empty rect for a box fully outside the image', () => {
  const rect = cropRect({ x: 1.5, y: 0, w: 0.1, h: 0.1 }, 100, 100, 0.06);
  assert.equal(rect.w, 0);
});

test('fitScale fits width, height or keeps original size', () => {
  assert.equal(fitScale('width', 800, 1200, 400, 600), 0.5);
  assert.equal(fitScale('height', 800, 1200, 400, 300), 0.25);
  assert.equal(fitScale('original', 800, 1200, 400, 300), 1);
});

test('fitScale falls back to 1 for an empty image dimension', () => {
  assert.equal(fitScale('width', 0, 10, 100, 100), 1);
  assert.equal(fitScale('height', 10, 0, 100, 100), 1);
});

test('fitViewport subtracts padding and inter-page gaps before dividing by page count', () => {
  assert.deepEqual(fitViewport({ width: 812, height: 600, padX: 24, padY: 24, gap: 4, count: 2 }), {
    perW: 392,
    viewH: 576,
  });
  assert.deepEqual(fitViewport({ width: 812, height: 600, padX: 24, padY: 24, gap: 4, count: 1 }), {
    perW: 788,
    viewH: 576,
  });
});

test('fitViewport never returns a zero or negative box', () => {
  assert.deepEqual(fitViewport({ width: 10, height: 10, padX: 24, padY: 24, gap: 4, count: 3 }), {
    perW: 1,
    viewH: 1,
  });
  assert.deepEqual(fitViewport({ width: 100, height: 100, padX: 0, padY: 0, gap: 0, count: 0 }), {
    perW: 100,
    viewH: 100,
  });
});

test('clampZoom keeps zoom inside the bounds', () => {
  assert.equal(clampZoom(0.2, 0.5, 4), 0.5);
  assert.equal(clampZoom(9, 0.5, 4), 4);
  assert.equal(clampZoom(1.5, 0.5, 4), 1.5);
});

test('zoomStep scales exponentially with wheel delta and clamps', () => {
  assert.equal(zoomStep(1, 0, 0.5, 4), 1);
  assert.ok(Math.abs(zoomStep(1, 50, 0.5, 4) - Math.exp(-0.5)) < 1e-12);
  assert.ok(Math.abs(zoomStep(1, -50, 0.5, 4) - Math.exp(0.5)) < 1e-12);
  assert.equal(zoomStep(1, 1000, 0.5, 4), 0.5);
  assert.equal(zoomStep(1, -1000, 0.5, 4), 4);
});

test('zoomStep is symmetric: zooming out then in returns to the start', () => {
  const out = zoomStep(1.3, 7, 0.5, 4);
  assert.ok(Math.abs(zoomStep(out, -7, 0.5, 4) - 1.3) < 1e-12);
});

test('zoomScroll keeps the point under the pointer fixed when zooming in', () => {
  // Page top-left at 100 before, pointer at 300 (page-local 200px). Zoom x2 with the page origin still at 100.
  assert.equal(zoomScroll(0, 300, 100, 100, 2), 200);
  // Origin moves to 12 once the page overflows and auto margins collapse; content point at 412 must sit at 300.
  assert.equal(zoomScroll(0, 300, 100, 12, 2), 112);
});

test('zoomScroll is a no-op at ratio 1 when the layout does not move', () => {
  assert.equal(zoomScroll(57, 210, 12, 12, 1), 57);
});

test('zoomScroll leaves the content point under the pointer where it was', () => {
  const scroll = 40;
  const pointer = 150;
  const originBefore = 12;
  const originLaid = -30;
  const ratio = 2.5;
  const next = zoomScroll(scroll, pointer, originBefore, originLaid, ratio);
  const originNow = originLaid - (next - scroll);
  assert.equal(originNow + (pointer - originBefore) * ratio, pointer);
});

test('shouldSuppressClick ignores small jitter and suppresses real drags', () => {
  assert.equal(shouldSuppressClick(0, 0), false);
  assert.equal(shouldSuppressClick(2, 2), false);
  assert.equal(shouldSuppressClick(4, 0), false);
  assert.equal(shouldSuppressClick(3, 3), true);
  assert.equal(shouldSuppressClick(0, -5), true);
});

test('spaceStep scrolls by 90% of the view until the bottom is reached', () => {
  assert.deepEqual(spaceStep({ scrollTop: 0, viewHeight: 500, contentHeight: 2000, backward: false }), { scrollBy: 450 });
  assert.deepEqual(spaceStep({ scrollTop: 1400, viewHeight: 500, contentHeight: 2000, backward: false }), { scrollBy: 450 });
  assert.deepEqual(spaceStep({ scrollTop: 1499, viewHeight: 500, contentHeight: 2000, backward: false }), { turn: 'next' });
});

test('spaceStep turns the page when a short page has nothing to scroll', () => {
  assert.deepEqual(spaceStep({ scrollTop: 0, viewHeight: 500, contentHeight: 300, backward: false }), { turn: 'next' });
});

test('spaceStep scrolls up with Shift until the top, then turns back', () => {
  assert.deepEqual(spaceStep({ scrollTop: 900, viewHeight: 500, contentHeight: 2000, backward: true }), { scrollBy: -450 });
  assert.deepEqual(spaceStep({ scrollTop: 0, viewHeight: 500, contentHeight: 2000, backward: true }), { turn: 'prev' });
});

test('progressLabel shows one page or a spread range', () => {
  assert.equal(progressLabel([0], 120), '1 / 120');
  assert.equal(progressLabel([3, 2], 120), '3–4 / 120');
  assert.equal(progressLabel([9], 10), '10 / 10');
  assert.equal(progressLabel([], 0), '0 / 0');
});

const series = { volumes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

test('nextVolume returns the following volume or null at the end', () => {
  assert.deepEqual(nextVolume(series, 'a'), { id: 'b' });
  assert.equal(nextVolume(series, 'c'), null);
  assert.equal(nextVolume(series, 'missing'), null);
  assert.equal(nextVolume({ volumes: [] }, 'a'), null);
  assert.equal(nextVolume(undefined, 'a'), null);
});

test('previousVolume returns the preceding volume or null at the start', () => {
  assert.deepEqual(previousVolume(series, 'c'), { id: 'b' });
  assert.equal(previousVolume(series, 'a'), null);
  assert.equal(previousVolume(series, 'missing'), null);
});
