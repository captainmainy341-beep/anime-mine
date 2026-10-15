// Picks the image for a sprite or background. Pure: the mount module fetches whatever this names.
// Order: the learner's skin pack, then the built-in code-drawn default. A missing pack, character,
// expression or background never throws; it just falls through.

export function resolveSprite(manifest, char, expr = 'neutral') {
  const sheet = manifest?.characters?.[char];
  const path = sheet?.[expr] ?? sheet?.neutral ?? null;
  if (path) return { source: 'pack', pack: manifest.pack, path, expr: sheet?.[expr] ? expr : 'neutral' };
  return { source: 'default', expr };
}

export function resolveBackground(manifest, bg, bgImage = null) {
  if (bgImage) return { source: 'frame', src: bgImage };
  const path = bg ? manifest?.backgrounds?.[bg] : null;
  if (path) return { source: 'pack', pack: manifest.pack, path };
  return { source: 'default', bg: bg ?? 'default' };
}
