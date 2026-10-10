export function toSegments(text, tokens) {
  if (tokens.length === 0) return [{ text, token: null }];
  const segments = [];
  let cursor = 0;
  for (const token of tokens) {
    const start = Math.max(token.start, cursor);
    const end = Math.min(token.end, text.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), token: null });
    segments.push({ text: text.slice(start, end), token: token.isWord ? token : null });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), token: null });
  return segments;
}
