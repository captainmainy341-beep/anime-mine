// Helpers for rendering Anki field values (HTML stored by Anki) safely.
// fieldHtml: safe HTML for display. Only <b>, </b> and <br> survive (attributes dropped);
// everything else is escaped. Known entities (&amp; &lt; &gt; &quot; &#39;) are kept as-is.
// fieldText: plain text for edit inputs. <br> becomes a newline, tags are stripped, entities decoded.

const TAG = /<(\/?)b(?:\s[^<>]*)?>|<br(?:\s[^<>]*)?\/?>/gi;
const TEXT_TAG = /<\/?[a-z][^<>]*>/gi;
const BR = /<br(?:\s[^<>]*)?\/?>/gi;
const ENTITY = /&(amp|lt|gt|quot|#39);/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

function escapeText(text) {
  return text
    .replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fieldHtml(raw) {
  const source = String(raw ?? '');
  let out = '';
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    out += escapeText(source.slice(last, match.index));
    if (/^<br/i.test(match[0])) out += '<br>';
    else out += match[1] ? '</b>' : '<b>';
    last = match.index + match[0].length;
  }
  return out + escapeText(source.slice(last));
}

export function fieldText(raw) {
  return String(raw ?? '')
    .replace(BR, '\n')
    .replace(TEXT_TAG, '')
    .replace(ENTITY, (_, name) => ENTITIES[name]);
}
