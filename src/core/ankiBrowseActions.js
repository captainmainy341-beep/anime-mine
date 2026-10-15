const { BRIDGE_MESSAGE } = require('./ankiDeckOptions');
const { cardInfos, collectionToday, plainFields, scopeOf, toBrowseCard } = require('./ankiBrowse');

const MAX_CARD_IDS = 500;
const TAG_MAX = 20;
const TAG_LENGTH = 100;
const FLAGS = [0, 1, 2, 3, 4, 5, 6, 7];
const DAYS = /^\d+(-\d+)?!?$/;
const SAVED = [
  { id: 'today', label: 'Today', query: 'added:1' },
  { id: 'week', label: 'Added this week', query: 'added:7' },
  { id: 'due', label: 'Due today', query: 'is:due' },
  { id: 'flagged', label: 'Flagged', query: '-flag:0' },
  { id: 'marked', label: 'Marked', query: 'tag:marked' },
  { id: 'suspended', label: 'Suspended', query: 'is:suspended' },
  { id: 'buried', label: 'Buried', query: 'is:buried' },
  { id: 'leeches', label: 'Leeches', query: 'tag:leech' },
  { id: 'failed', label: 'Failed today', query: 'rated:1:1' },
];
const BRIDGE_ACTIONS = new Set(['flag', 'bury', 'unbury']);
const NATIVE_ACTIONS = new Set(['suspend', 'unsuspend', 'mark', 'unmark', 'addTags', 'removeTags', 'changeDeck', 'forget', 'setDueDate', 'deleteNotes']);
const NOTE_ACTIONS = new Set(['mark', 'unmark', 'addTags', 'removeTags', 'deleteNotes']);
const NOTE_QUERY_CHUNK = 100;

const uniqueNames = (names) => [...new Set((names ?? []).filter((name) => typeof name === 'string' && name !== ''))];

const visibleOnly = (decks, name) => {
  if (!decks.includes(name)) throw new Error('Card is not in a visible deck');
};

// Note-level writes touch every card of the note, so sibling cards in hidden decks must be checked too.
async function assertNotesVisible(client, notes, allowed) {
  for (let i = 0; i < notes.length; i += NOTE_QUERY_CHUNK) {
    const query = notes.slice(i, i + NOTE_QUERY_CHUNK).map((id) => `nid:${id}`).join(' or ');
    const cardIds = (await client.invoke('findCards', { query })) ?? [];
    const infos = await cardInfos(client, cardIds);
    if (infos.some((info) => !allowed.includes(info.deckName))) throw new Error('Deck is hidden');
  }
}

async function resolveCards(client, cardIds, decks) {
  if (!Array.isArray(cardIds) || !cardIds.length) throw new Error('Choose at least one card');
  if (cardIds.length > MAX_CARD_IDS) throw new Error(`Choose at most ${MAX_CARD_IDS} cards`);
  if (!cardIds.every((id) => Number.isInteger(id) && id > 0)) throw new Error('cardIds must be positive integers');
  const infos = (await client.invoke('cardsInfo', { cards: cardIds })) ?? [];
  if (infos.length !== cardIds.length) throw new Error('Card not found');
  for (const info of infos) visibleOnly(decks, info.deckName);
  return infos;
}

function cleanTags(tags) {
  if (!Array.isArray(tags) || !tags.length) throw new Error('tags must be a non-empty array');
  if (tags.length > TAG_MAX) throw new Error(`Choose at most ${TAG_MAX} tags`);
  return tags.map((tag) => {
    const clean = typeof tag === 'string' ? tag.trim() : '';
    if (!clean || /\s/.test(clean) || clean.length > TAG_LENGTH) throw new Error('Tags must be single words up to 100 characters');
    return clean;
  });
}

async function bridgeAction(client, action, cardIds, args) {
  try {
    return await client.invoke('animeMineCardAction', { action, cardIds, args });
  } catch (err) {
    if (/unsupported action|unknown action/i.test(err.message)) throw new Error(BRIDGE_MESSAGE);
    throw err;
  }
}

async function cardAction(client, { action, cardIds, args = {}, decks, guard }) {
  if (!NATIVE_ACTIONS.has(action) && !BRIDGE_ACTIONS.has(action)) throw new Error(`Unsupported card action: ${action}`);
  const allowed = uniqueNames(decks);
  const infos = await resolveCards(client, cardIds, allowed);
  await guard?.();
  const ids = infos.map((info) => info.cardId);
  const notes = [...new Set(infos.map((info) => info.note))];
  if (NOTE_ACTIONS.has(action)) await assertNotesVisible(client, notes, allowed);

  switch (action) {
    case 'suspend':
      return client.invoke('suspend', { cards: ids });
    case 'unsuspend':
      return client.invoke('unsuspend', { cards: ids });
    case 'flag':
      if (!Number.isInteger(args.flag) || !FLAGS.includes(args.flag)) throw new Error('flag must be an integer 0-7');
      return bridgeAction(client, 'flag', ids, { flag: args.flag });
    case 'bury':
    case 'unbury':
      return bridgeAction(client, action, ids, {});
    case 'mark':
      return client.invoke('addTags', { notes, tags: 'marked' });
    case 'unmark':
      return client.invoke('removeTags', { notes, tags: 'marked' });
    case 'addTags':
      return client.invoke('addTags', { notes, tags: cleanTags(args.tags).join(' ') });
    case 'removeTags':
      return client.invoke('removeTags', { notes, tags: cleanTags(args.tags).join(' ') });
    case 'changeDeck':
      if (typeof args.deck !== 'string' || !allowed.includes(args.deck)) throw new Error('Deck is hidden');
      return client.invoke('changeDeck', { cards: ids, deck: args.deck });
    case 'forget':
      return client.invoke('forgetCards', { cards: ids });
    case 'setDueDate':
      if (typeof args.days !== 'string' || !DAYS.test(args.days)) throw new Error('days must look like 0, 3-7 or 2!');
      return client.invoke('setDueDate', { cards: ids, days: args.days });
    case 'deleteNotes':
      if (args.confirm !== true) throw new Error('Deleting notes needs confirmation');
      return client.invoke('deleteNotes', { notes });
    default:
      throw new Error(`Unsupported card action: ${action}`);
  }
}

async function cardInfo(client, { cardId, decks }) {
  const allowed = uniqueNames(decks);
  const [info] = (await client.invoke('cardsInfo', { cards: [cardId] })) ?? [];
  if (!info) throw new Error('Card not found');
  visibleOnly(allowed, info.deckName);
  const [reviews, due, [note], today] = await Promise.all([
    client.invoke('getReviewsOfCards', { cards: [cardId] }),
    client.invoke('findCards', { query: `cid:${cardId} is:due` }),
    client.invoke('notesInfo', { notes: [info.note] }),
    collectionToday(client),
  ]);
  const tags = note?.tags ?? [];
  const history = (reviews?.[cardId] ?? []).map((r) => ({
    ts: r.id,
    ease: r.ease,
    interval: r.ivl,
    lastInterval: r.lastIvl,
    type: r.type,
    timeMs: r.time,
  }));
  const times = history.map((r) => r.timeMs);
  const totalTimeMs = times.reduce((sum, t) => sum + t, 0);
  return {
    card: toBrowseCard(info, new Set(due ?? []), tags, today),
    history,
    created: info.note ?? null,
    firstReview: history[0]?.ts ?? null,
    lastReview: history.at(-1)?.ts ?? null,
    averageTimeMs: times.length ? Math.round(totalTimeMs / times.length) : null,
    totalTimeMs,
    note: { id: info.note, fields: plainFields(info.fields ?? {}), tags },
  };
}

async function facets(client, { decks }) {
  const names = uniqueNames(decks);
  if (!names.length) return { decks: [], tags: [], noteTypes: [], saved: [] };
  const scope = scopeOf(names);
  const deckQueries = names.flatMap((name) => {
    const exact = scopeOf([name]);
    return [`${exact}`, `${exact} is:due`, `${exact} is:new`];
  });
  const savedQueries = SAVED.map((s) => `${scope} ${s.query}`);
  const queries = [...deckQueries, ...savedQueries];
  const results = (await client.invoke('multi', { actions: queries.map((query) => ({ action: 'findCards', params: { query } })) })) ?? [];
  const count = (index) => (results[index] ?? []).length;
  const notes = (await client.invoke('findNotes', { query: scope })) ?? [];
  const noteInfos = await noteChunks(client, notes);
  const tagCounts = new Map();
  const typeCounts = new Map();
  for (const note of noteInfos) {
    for (const tag of note.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    typeCounts.set(note.modelName, (typeCounts.get(note.modelName) ?? 0) + 1);
  }
  const byCount = (map) => [...map].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    decks: names.map((name, i) => ({ name, total: count(i * 3), due: count(i * 3 + 1), new: count(i * 3 + 2) })),
    tags: byCount(tagCounts),
    noteTypes: byCount(typeCounts),
    saved: SAVED.map((s, i) => ({ id: s.id, label: s.label, query: s.query, count: count(deckQueries.length + i) })),
  };
}

async function noteChunks(client, ids) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...((await client.invoke('notesInfo', { notes: ids.slice(i, i + 500) })) ?? []));
  return out;
}

module.exports = { cardAction, cardInfo, facets, MAX_CARD_IDS };
