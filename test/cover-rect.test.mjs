import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverToPixels, expandCover, pictureRect, rectFromDrag, sourceBand } from '../src/renderer/lib/coverRect.mjs';

function assertClose(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} !== ${expected[key]}`);
  }
}

test('pictureRect letterboxes a wide video in a square box', () => {
  assertClose(pictureRect(800, 800, 1600, 900), { left: 0, top: 175, width: 800, height: 450 });
});

test('pictureRect pillarboxes a 4:3 video in a wide box', () => {
  assertClose(pictureRect(1600, 900, 800, 600), { left: 200, top: 0, width: 1200, height: 900 });
});

test('pictureRect fills the box when the aspect ratio matches', () => {
  assertClose(pictureRect(1600, 900, 1600, 900), { left: 0, top: 0, width: 1600, height: 900 });
});

test('pictureRect returns the full box when video size is unknown', () => {
  assertClose(pictureRect(300, 200, 0, 0), { left: 0, top: 0, width: 300, height: 200 });
  assertClose(pictureRect(300, 200, NaN, 480), { left: 0, top: 0, width: 300, height: 200 });
});

const PIC = { left: 200, top: 0, width: 1200, height: 900 };

test('rectFromDrag normalizes a drag to picture fractions', () => {
  assertClose(rectFromDrag({ x: 320, y: 90 }, { x: 920, y: 450 }, PIC), { x: 0.1, y: 0.1, w: 0.5, h: 0.4 });
});

test('rectFromDrag ignores drag direction', () => {
  assertClose(rectFromDrag({ x: 920, y: 450 }, { x: 320, y: 90 }, PIC), { x: 0.1, y: 0.1, w: 0.5, h: 0.4 });
});

test('rectFromDrag clamps points to the picture, not the letterbox bars', () => {
  assertClose(rectFromDrag({ x: 0, y: -50 }, { x: 1600, y: 1000 }, PIC), { x: 0, y: 0, w: 1, h: 1 });
});

test('rectFromDrag returns null for rectangles under 2% on either side', () => {
  assert.equal(rectFromDrag({ x: 500, y: 100 }, { x: 510, y: 400 }, PIC), null);
  assert.equal(rectFromDrag({ x: 500, y: 100 }, { x: 900, y: 110 }, PIC), null);
  assert.equal(rectFromDrag({ x: 500, y: 100 }, { x: 500, y: 100 }, PIC), null);
});

test('rectFromDrag returns null when the drag lies outside the picture', () => {
  assert.equal(rectFromDrag({ x: 0, y: 100 }, { x: 100, y: 400 }, PIC), null);
});

test('rectFromDrag returns null for a degenerate picture', () => {
  assert.equal(rectFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { left: 0, top: 0, width: 0, height: 0 }), null);
});

test('coverToPixels maps a cover into element pixels', () => {
  const pic = pictureRect(1000, 1000, 1600, 900);
  assertClose(coverToPixels({ x: 0.25, y: 0.1, w: 0.5, h: 0.3 }, pic), {
    left: 250,
    top: 275,
    width: 500,
    height: 168.75,
  });
});

test('cover survives a round trip through pixels and rectFromDrag', () => {
  const pic = pictureRect(1000, 1000, 1600, 900);
  const cover = { x: 0.25, y: 0.1, w: 0.5, h: 0.3 };
  const px = coverToPixels(cover, pic);
  const back = rectFromDrag(
    { x: px.left, y: px.top },
    { x: px.left + px.width, y: px.top + px.height },
    pic,
  );
  assertClose(back, cover);
});

test('expandCover pads the box left, right, and upward but not downward', () => {
  assertClose(expandCover({ x: 0.2, y: 0.5, w: 0.6, h: 0.2 }), { x: 0.16, y: 0.36, w: 0.68, h: 0.34 });
});

test('expandCover clamps padding at the left and top edges', () => {
  assertClose(expandCover({ x: 0.02, y: 0.05, w: 0.5, h: 0.1 }), { x: 0, y: 0, w: 0.56, h: 0.15 });
});

test('expandCover clamps padding at the right and bottom edges', () => {
  assertClose(expandCover({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }), { x: 0.86, y: 0.76, w: 0.14, h: 0.24 });
});

test('sourceBand samples the strip above a box that starts below the top 8%', () => {
  assertClose(sourceBand({ x: 0.2, y: 0.5, w: 0.6, h: 0.2 }, 1000, 500), { sx: 200, sy: 150, sw: 600, sh: 100 });
});

test('sourceBand caps the strip above at the space available', () => {
  assertClose(sourceBand({ x: 0, y: 0.1, w: 1, h: 0.5 }, 1000, 500), { sx: 0, sy: 0, sw: 1000, sh: 50 });
});

test('sourceBand samples the strip below when the box starts within the top 8%', () => {
  assertClose(sourceBand({ x: 0.1, y: 0.02, w: 0.3, h: 0.1 }, 1000, 500), { sx: 100, sy: 60, sw: 300, sh: 50 });
});

test('sourceBand caps the strip below at the space available', () => {
  assertClose(sourceBand({ x: 0, y: 0.05, w: 1, h: 0.9 }, 1000, 500), { sx: 0, sy: 475, sw: 1000, sh: 25 });
});

test('sourceBand falls back to the strip above when nothing lies below the box', () => {
  assertClose(sourceBand({ x: 0, y: 0.05, w: 1, h: 0.95 }, 1000, 500), { sx: 0, sy: 0, sw: 1000, sh: 25 });
});

test('sourceBand keeps at least one video pixel', () => {
  assert.equal(sourceBand({ x: 0, y: 0.5, w: 0.5, h: 0.0001 }, 1000, 500).sh, 1);
  const full = sourceBand({ x: 0, y: 0, w: 1, h: 1 }, 1000, 500);
  assert.equal(full.sh, 1);
  assert.equal(full.sy, 0);
});
