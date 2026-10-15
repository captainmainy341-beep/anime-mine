import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLUMNS,
  draftDirty,
  isFieldEditable,
  selectionDropsDraft,
  addChip,
  appendTerm,
  buildDeckTree,
  buryAction,
  changedFields,
  composeQuery,
  deckSubtree,
  flagTarget,
  flattenTree,
  hasMore,
  markAction,
  neighbourId,
  noteTypeChip,
  pageLabel,
  parseColumns,
  parseHistory,
  pruneSelection,
  pushHistory,
  removeChip,
  rowStatus,
  savedChip,
  selectAll,
  selectOnly,
  selectRange,
  serializeColumns,
  suspendAction,
  SYNTAX_HELP,
  tagChip,
  toggleColumn,
  toggleSelected,
  validateDueDate,
  nextSort,
} from '../src/renderer/lib/ankiBrowseModel.mjs';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

test('single click selects one row and anchors on it', () => {
  assert.deepEqual(selectOnly('c'), { ids: ['c'], anchor: 'c' });
});

test('ctrl-click toggles a row in and out of the selection', () => {
  const on = toggleSelected(selectOnly('a'), 'c');
  assert.deepEqual(on.ids, ['a', 'c']);
  assert.deepEqual(toggleSelected(on, 'a').ids, ['c']);
});

test('shift-click selects the inclusive range from the anchor, in either direction', () => {
  const down = selectRange({ ids: ['b'], anchor: 'b' }, ORDER, 'd');
  assert.deepEqual(down.ids, ['b', 'c', 'd']);
  assert.equal(down.anchor, 'b');
  const up = selectRange({ ids: ['d'], anchor: 'd' }, ORDER, 'b');
  assert.deepEqual(up.ids, ['b', 'c', 'd']);
});

test('repeated shift selection keeps the original anchor', () => {
  const first = selectRange({ ids: ['b'], anchor: 'b' }, ORDER, 'c');
  const second = selectRange(first, ORDER, 'e');
  assert.deepEqual(second.ids, ['b', 'c', 'd', 'e']);
});

test('shift-click without a usable anchor falls back to the clicked row', () => {
  assert.deepEqual(selectRange({ ids: [], anchor: null }, ORDER, 'e').ids, ['e']);
  assert.deepEqual(selectRange({ ids: [], anchor: 'zzz' }, ORDER, 'e').ids, ['e']);
});

test('select all keeps loaded order and anchors on the first row', () => {
  assert.deepEqual(selectAll(ORDER), { ids: ORDER, anchor: 'a' });
  assert.deepEqual(selectAll([]), { ids: [], anchor: null });
});

test('pruneSelection keeps only ids still present after a reload', () => {
  const pruned = pruneSelection({ ids: ['a', 'x', 'c'], anchor: 'x' }, ORDER);
  assert.deepEqual(pruned, { ids: ['a', 'c'], anchor: 'a' });
});

test('neighbourId walks the order and clamps at both ends', () => {
  assert.equal(neighbourId(ORDER, 'b', 1), 'c');
  assert.equal(neighbourId(ORDER, 'a', -1), 'a');
  assert.equal(neighbourId(ORDER, 'e', 1), 'e');
  assert.equal(neighbourId(ORDER, 'c', 'start'), 'a');
  assert.equal(neighbourId(ORDER, 'c', 'end'), 'e');
  assert.equal(neighbourId([], 'c', 1), null);
});

test('column defaults apply to missing, corrupt or empty storage', () => {
  assert.deepEqual(parseColumns(null), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns('not json'), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns('{"a":1}'), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns('["nope"]'), DEFAULT_COLUMNS);
  assert.deepEqual(parseColumns('[]'), DEFAULT_COLUMNS);
});

test('column choice round-trips in canonical order and drops unknown ids', () => {
  const raw = serializeColumns(['lapses', 'word', 'tags']);
  assert.equal(raw, JSON.stringify(['word', 'lapses', 'tags']));
  assert.deepEqual(parseColumns(JSON.stringify(['tags', 'bogus', 'word'])), ['word', 'tags']);
});

test('toggleColumn adds and removes, and never empties the table', () => {
  assert.deepEqual(toggleColumn(['word'], 'tags'), ['word', 'tags']);
  assert.deepEqual(toggleColumn(['word', 'tags'], 'word'), ['tags']);
  assert.deepEqual(toggleColumn(['word'], 'word'), ['word']);
});

test('clicking a sort header toggles direction on the same column and starts ascending on a new one', () => {
  const first = nextSort({ sort: 'created', desc: true }, 'word');
  assert.deepEqual(first, { sort: 'word', desc: false });
  assert.deepEqual(nextSort(first, 'word'), { sort: 'word', desc: true });
});

test('chips compose with AND and remove cleanly', () => {
  const leech = tagChip('leech');
  const type = noteTypeChip('Japanese "core"');
  assert.equal(composeQuery('', []), '');
  assert.equal(composeQuery('  is:due ', []), 'is:due');
  assert.equal(composeQuery('', [leech]), 'tag:leech');
  assert.equal(composeQuery('is:due', [leech, type]), '(is:due) (tag:leech) (note:"Japanese \\"core\\"")');
  const chips = addChip(addChip([], leech), leech);
  assert.equal(chips.length, 1);
  assert.deepEqual(removeChip(chips, leech.id), []);
});

test('saved filter chips use the saved query verbatim', () => {
  assert.equal(savedChip({ label: 'Flagged', query: '-flag:0' }).query, '-flag:0');
});

test('tag chips escape Anki metacharacters', () => {
  assert.equal(tagChip('a_b').query, 'tag:a\\_b');
});

test('appendTerm adds a term after existing text with one space', () => {
  assert.equal(appendTerm('', 'is:due'), 'is:due');
  assert.equal(appendTerm('tag:x   ', 'is:due'), 'tag:x is:due');
});

test('search history is most-recent-first, de-duplicated and capped at eight', () => {
  let list = [];
  for (const q of ['a', 'b', 'a', '  ', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) list = pushHistory(list, q);
  assert.deepEqual(list, ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'a']);
});

test('search history parsing ignores garbage and duplicates', () => {
  assert.deepEqual(parseHistory('nope'), []);
  assert.deepEqual(parseHistory(JSON.stringify(['x', 'x', 3, '', 'y'])), ['x', 'y']);
});

test('due date accepts day, range and reset forms', () => {
  for (const ok of ['0', '3', '3-7', '2!', '0-0', '14-14!']) assert.equal(validateDueDate(ok).ok, true, ok);
  assert.equal(validateDueDate(' 5 ').value, '5');
});

test('due date rejects malformed input and reversed ranges', () => {
  for (const bad of ['', 'x', '-3', '3-', '1.5', '3--7', '3!!', '7-3']) assert.equal(validateDueDate(bad).ok, false, bad);
  assert.match(validateDueDate('7-3').error, /above/);
});

test('flag toggle clears the flag when it is already set and sets it otherwise', () => {
  assert.equal(flagTarget(1, 1), 0);
  assert.equal(flagTarget(0, 1), 1);
  assert.equal(flagTarget(2, 1), 1);
});

test('suspend decision follows the majority, ties suspend', () => {
  const card = (suspended) => ({ suspended });
  assert.equal(suspendAction([card(true), card(true), card(false)]), 'unsuspend');
  assert.equal(suspendAction([card(true), card(false)]), 'suspend');
  assert.equal(suspendAction([card(false)]), 'suspend');
});

test('bury and mark decisions also follow the majority', () => {
  assert.equal(buryAction([{ buried: true }, { buried: false }, { buried: true }]), 'unbury');
  assert.equal(buryAction([{ buried: false }]), 'bury');
  assert.equal(markAction([{ marked: true }]), 'unmark');
  assert.equal(markAction([{ marked: false }, { marked: true }]), 'mark');
});

test('row status maps flags to colour names and keeps the other markers', () => {
  assert.deepEqual(rowStatus({ flag: 5, suspended: true, buried: false, marked: true }), {
    flag: 'pink',
    suspended: true,
    buried: false,
    marked: true,
  });
  assert.equal(rowStatus({ flag: 0 }).flag, 'none');
  assert.equal(rowStatus({ flag: 9 }).flag, 'none');
});

test('changedFields sends only edited, editable fields', () => {
  const original = { Meaning: 'a', SentenceTranslation: 'b', Word: 'x', Notes: '' };
  const values = { Meaning: 'changed', SentenceTranslation: 'b', Word: 'edited', Notes: 'n' };
  assert.deepEqual(changedFields(original, values), { Meaning: 'changed', Notes: 'n' });
  assert.deepEqual(changedFields(original, original), {});
});

test('deck tree nests by :: and sums counts up through parents without decks', () => {
  const tree = buildDeckTree([
    { name: 'Anime::Expressions', total: 5, due: 2, new: 1 },
    { name: 'Anime::Kanji', total: 3, due: 1, new: 0 },
    { name: 'Anime', total: 10, due: 4, new: 2 },
    { name: 'Books', total: 1, due: 0, new: 1 },
  ]);
  assert.deepEqual(tree.map((n) => n.name), ['Anime', 'Books']);
  const anime = tree[0];
  assert.equal(anime.hasDeck, true);
  assert.deepEqual([anime.total, anime.due, anime.new], [18, 7, 3]);
  assert.deepEqual(anime.children.map((n) => n.path), ['Anime::Expressions', 'Anime::Kanji']);
  const orphan = buildDeckTree([{ name: 'A::B::C', total: 2, due: 1, new: 1 }]);
  assert.equal(orphan[0].hasDeck, false);
  assert.equal(orphan[0].children[0].children[0].path, 'A::B::C');
  assert.equal(orphan[0].due, 1);
});

test('flattenTree respects collapsed branches and reports depth', () => {
  const tree = buildDeckTree([
    { name: 'A::B::C', total: 0, due: 0, new: 0 },
    { name: 'A::D', total: 0, due: 0, new: 0 },
  ]);
  const open = flattenTree(tree).map((row) => [row.node.path, row.depth]);
  assert.deepEqual(open, [
    ['A', 0],
    ['A::B', 1],
    ['A::B::C', 2],
    ['A::D', 1],
  ]);
  const closed = flattenTree(tree, new Set(['A::B'])).map((row) => row.node.path);
  assert.deepEqual(closed, ['A', 'A::B', 'A::D']);
});

test('deckSubtree includes the deck and its subdecks but not look-alike names', () => {
  const names = ['Anime', 'Anime::X', 'Anime Extra', 'Animex'];
  assert.deepEqual(deckSubtree(names, 'Anime'), ['Anime', 'Anime::X']);
  assert.deepEqual(deckSubtree(names, 'Anime::X'), ['Anime::X']);
});

test('syntax cheat sheet lists about fourteen entries that each have an insert and help text', () => {
  assert.ok(SYNTAX_HELP.length >= 13 && SYNTAX_HELP.length <= 16);
  for (const entry of SYNTAX_HELP) {
    assert.ok(entry.syntax && entry.text, entry.syntax);
  }
  assert.ok(SYNTAX_HELP.some((e) => e.syntax === 'is:due'));
  assert.ok(SYNTAX_HELP.some((e) => e.syntax === '"exact phrase"'));
});

test('page label and more-pages flag', () => {
  assert.equal(pageLabel(100, 340), '100 of 340');
  assert.equal(hasMore(100, 340), true);
  assert.equal(hasMore(340, 340), false);
});

test('draftDirty is true only when an editable field differs from the saved value', () => {
  const draft = { id: 1, original: { Meaning: 'a', Word: 'x' }, values: { Meaning: 'a', Word: 'x' } };
  assert.equal(draftDirty(null), false);
  assert.equal(draftDirty(draft), false);
  assert.equal(draftDirty({ ...draft, values: { Meaning: 'b', Word: 'x' } }), true);
  assert.equal(draftDirty({ ...draft, values: { Meaning: 'a', Word: 'changed' } }), false);
});

test('selectionDropsDraft only fires for a dirty draft whose card leaves the selection', () => {
  const clean = { id: 1, original: { Meaning: 'a' }, values: { Meaning: 'a' } };
  const dirty = { id: 1, original: { Meaning: 'a' }, values: { Meaning: 'b' } };
  assert.equal(selectionDropsDraft(clean, { ids: [], anchor: null }), false);
  assert.equal(selectionDropsDraft(dirty, { ids: [1], anchor: 1 }), false);
  assert.equal(selectionDropsDraft(dirty, { ids: [1, 2], anchor: 1 }), false);
  assert.equal(selectionDropsDraft(dirty, { ids: [], anchor: null }), true);
  assert.equal(selectionDropsDraft(dirty, { ids: [2], anchor: 2 }), true);
});

test('isFieldEditable allows only editable fields that are not read-only or truncated', () => {
  assert.equal(isFieldEditable('Meaning'), true);
  assert.equal(isFieldEditable('Sentence'), false);
  assert.equal(isFieldEditable('Meaning', { readOnly: true }), false);
  assert.equal(isFieldEditable('Meaning', { truncated: ['Meaning'] }), false);
  assert.equal(isFieldEditable('Notes', { truncated: ['Meaning'] }), true);
});
