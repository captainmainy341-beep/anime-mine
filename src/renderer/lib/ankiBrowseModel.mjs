// Pure state and rules for the Anki Browse screen. No DOM access, so they run under node --test.

export const PAGE_SIZE = 100;
export const ACTION_CARD_LIMIT = 500;
export const SEARCH_HISTORY_KEY = 'animeMine.anki.searches';
export const COLUMNS_KEY = 'animeMine.anki.columns';
const HISTORY_MAX = 8;

// Must match EDITABLE_NOTE_FIELDS in src/main/services.js; other fields are shown read-only.
export const EDITABLE_FIELDS = ['Meaning', 'SentenceTranslation', 'Notes'];

export const COLUMNS = [
  { id: 'word', label: 'Word', sort: 'word' },
  { id: 'reading', label: 'Reading' },
  { id: 'meaning', label: 'Meaning' },
  { id: 'deck', label: 'Deck', sort: 'deck' },
  { id: 'state', label: 'State' },
  { id: 'due', label: 'Due', sort: 'due' },
  { id: 'interval', label: 'Interval', sort: 'interval' },
  { id: 'lapses', label: 'Lapses', sort: 'lapses' },
  { id: 'sentence', label: 'Sentence' },
  { id: 'tags', label: 'Tags' },
  { id: 'ease', label: 'Ease', sort: 'ease' },
  { id: 'reviews', label: 'Reviews', sort: 'reps' },
  { id: 'created', label: 'Created', sort: 'created' },
  { id: 'modified', label: 'Modified', sort: 'modified' },
  { id: 'source', label: 'Source' },
  { id: 'noteType', label: 'Note type' },
];
export const DEFAULT_COLUMNS = ['word', 'reading', 'meaning', 'deck', 'state', 'due', 'interval', 'lapses'];

export const DEFAULT_SORT = { sort: 'created', desc: true };

export const FLAG_NAMES = ['none', 'red', 'orange', 'green', 'blue', 'pink', 'turquoise', 'purple'];

export const SYNTAX_HELP = [
  { syntax: 'deck:"Name"', insert: 'deck:', text: 'Cards in a deck, including its subdecks' },
  { syntax: 'tag:leech', text: 'Notes with this tag' },
  { syntax: 'is:due', text: 'Due now' },
  { syntax: 'is:new', text: 'New cards' },
  { syntax: 'is:suspended', text: 'Suspended cards' },
  { syntax: 'flag:1', text: 'Flag 1 (red); 0 means no flag' },
  { syntax: 'added:7', text: 'Added in the last 7 days' },
  { syntax: 'rated:1:1', text: 'Answered Again in the last day (rated:days:button)' },
  { syntax: 'prop:ivl>=21', text: 'Interval of 21 days or more' },
  { syntax: 'prop:ease<2.0', text: 'Ease below 200%' },
  { syntax: 'prop:lapses>3', text: 'More than 3 lapses' },
  { syntax: '-tag:leech', text: 'Exclude matches: put - in front of any term' },
  { syntax: 'field:*text*', text: 'Text inside a named field, e.g. Meaning:*good*' },
  { syntax: '"exact phrase"', insert: '"phrase"', text: 'Exact phrase, with quotes' },
];

export const isEditableField = (name) => EDITABLE_FIELDS.includes(name);

export function columnById(id) {
  return COLUMNS.find((column) => column.id === id);
}

export function orderedColumns(ids) {
  return COLUMNS.map((column) => column.id).filter((id) => ids.includes(id));
}

function parseJsonList(raw) {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function parseColumns(raw) {
  const picked = orderedColumns(parseJsonList(raw));
  return picked.length ? picked : [...DEFAULT_COLUMNS];
}

export function toggleColumn(ids, id) {
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return next.length ? orderedColumns(next) : [...ids];
}

export function serializeColumns(ids) {
  return JSON.stringify(orderedColumns(ids));
}

export function nextSort(current, sort) {
  return current.sort === sort ? { sort, desc: !current.desc } : { sort, desc: false };
}

export const emptySelection = () => ({ ids: [], anchor: null });

export function selectOnly(id) {
  return { ids: [id], anchor: id };
}

export function toggleSelected(selection, id) {
  const ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
  return { ids, anchor: id };
}

// Replaces the selection with the rows between the anchor and id; the anchor stays put for repeated shift+arrow.
export function selectRange(selection, order, id) {
  const anchor = order.includes(selection.anchor) ? selection.anchor : id;
  const from = order.indexOf(anchor);
  const to = order.indexOf(id);
  if (to < 0) return selection;
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { ids: order.slice(start, end + 1), anchor };
}

export function selectAll(order) {
  return { ids: [...order], anchor: order[0] ?? null };
}

export function pruneSelection(selection, order) {
  const alive = new Set(order);
  const ids = selection.ids.filter((id) => alive.has(id));
  return { ids, anchor: alive.has(selection.anchor) ? selection.anchor : (ids[0] ?? null) };
}

// step is +1/-1, or 'start' / 'end' for Home / End.
export function neighbourId(order, currentId, step) {
  if (!order.length) return null;
  if (step === 'start') return order[0];
  if (step === 'end') return order.at(-1);
  const at = order.indexOf(currentId);
  if (at < 0) return order[0];
  return order[Math.min(order.length - 1, Math.max(0, at + step))];
}

const escapeTerm = (text) => String(text).replace(/[\\"*_:]/g, '\\$&');
const quoteTerm = (text) => `"${escapeTerm(text)}"`;

export function makeChip(kind, label, query) {
  return { id: `${kind}:${query}`, kind, label, query };
}

export const tagChip = (tag) => makeChip('tag', `#${tag}`, `tag:${escapeTerm(tag)}`);
export const noteTypeChip = (name) => makeChip('noteType', name, `note:${quoteTerm(name)}`);
export const savedChip = (saved) => makeChip('saved', saved.label, saved.query);

export function addChip(chips, chip) {
  return chips.some((c) => c.id === chip.id) ? chips : [...chips, chip];
}

export const removeChip = (chips, id) => chips.filter((c) => c.id !== id);

export function composeQuery(text, chips) {
  const parts = [text.trim(), ...chips.map((chip) => chip.query)].filter(Boolean);
  return parts.length > 1 ? parts.map((part) => `(${part})`).join(' ') : (parts[0] ?? '');
}

export function appendTerm(text, term) {
  const base = text.trimEnd();
  return base ? `${base} ${term}` : term;
}

export function parseHistory(raw) {
  const list = parseJsonList(raw).filter((q) => typeof q === 'string' && q.trim() !== '');
  return [...new Set(list.map((q) => q.trim()))].slice(0, HISTORY_MAX);
}

export function pushHistory(list, query) {
  const q = query.trim();
  if (!q) return list;
  return [q, ...list.filter((item) => item !== q)].slice(0, HISTORY_MAX);
}

const DUE_FORMAT = /^\d+(-\d+)?!?$/;

export function validateDueDate(text) {
  const value = String(text ?? '').trim();
  if (!DUE_FORMAT.test(value)) {
    return { ok: false, error: 'Use a day like 0 or 3, a range like 3-7, and add ! to reset the interval.' };
  }
  const [from, to] = value.replace('!', '').split('-').map(Number);
  if (to !== undefined && from > to) return { ok: false, error: 'The start of a range must not be above its end.' };
  return { ok: true, value };
}

export const flagTarget = (currentFlag, flag) => (currentFlag === flag ? 0 : flag);

const mostly = (cards, predicate) => cards.filter(predicate).length * 2 > cards.length;
export const suspendAction = (cards) => (mostly(cards, (c) => c.suspended) ? 'unsuspend' : 'suspend');
export const buryAction = (cards) => (mostly(cards, (c) => c.buried) ? 'unbury' : 'bury');
export const markAction = (cards) => (mostly(cards, (c) => c.marked) ? 'unmark' : 'mark');

export function rowStatus(card) {
  return {
    flag: FLAG_NAMES[card.flag] ?? 'none',
    suspended: !!card.suspended,
    buried: !!card.buried,
    marked: !!card.marked,
  };
}

export function changedFields(original, values) {
  return Object.fromEntries(
    Object.keys(values)
      .filter((name) => isEditableField(name) && values[name] !== original[name])
      .map((name) => [name, values[name]]),
  );
}

export const draftDirty = (draft) => !!draft && Object.keys(changedFields(draft.original, draft.values)).length > 0;

export const selectionDropsDraft = (draft, selection) => draftDirty(draft) && !selection.ids.includes(draft.id);

export const isFieldEditable = (name, { readOnly = false, truncated = [] } = {}) =>
  isEditableField(name) && !readOnly && !truncated.includes(name);

export const deckSubtree = (names, path) => names.filter((name) => name === path || name.startsWith(`${path}::`));

// Parent nodes without their own deck still get summed counts from their subdecks.
export function buildDeckTree(decks) {
  const top = new Map();
  for (const deck of decks) {
    let level = top;
    let path = '';
    let node = null;
    for (const segment of deck.name.split('::')) {
      path = path ? `${path}::${segment}` : segment;
      if (!level.has(segment)) level.set(segment, { name: segment, path, deck: null, children: new Map() });
      node = level.get(segment);
      level = node.children;
    }
    if (node) node.deck = deck;
  }
  return finishTree(top);
}

function finishTree(level) {
  return [...level.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => {
      const children = finishTree(node.children);
      const sum = (key) => (node.deck?.[key] ?? 0) + children.reduce((n, child) => n + child[key], 0);
      return { name: node.name, path: node.path, hasDeck: !!node.deck, due: sum('due'), new: sum('new'), total: sum('total'), children };
    });
}

export function flattenTree(nodes, collapsed = new Set(), depth = 0) {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(collapsed.has(node.path) ? [] : flattenTree(node.children, collapsed, depth + 1)),
  ]);
}

export const pageLabel = (shown, total) => `${shown} of ${total}`;
export const hasMore = (shown, total) => shown < total;
