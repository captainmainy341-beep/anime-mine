const { AnkiBrowser, assertMediaName, plainText } = require('./ankiBrowse');

const MAX_QUEUE = 50;
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const MEDIA_TAG = /\[(?:sound|anki:play):[^\]]*\]/g;
const SOUND = /\[sound:([^\]]+)\]/;
const IMG = /<img\b[^>]*>/gi;
const SRC = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const srcOf = (tag) => {
  const match = SRC.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
};

const validMediaName = (name) => {
  try {
    assertMediaName(name);
    return true;
  } catch {
    return false;
  }
};

const inDeck = (name, deck) => typeof name === 'string' && (name === deck || name.startsWith(`${deck}::`));

function audioName(fields) {
  const ordered = Object.values(fields ?? {}).sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
  for (const field of ordered) {
    const match = SOUND.exec(field?.value ?? '');
    if (match) return validMediaName(match[1]) ? match[1] : null;
  }
  return null;
}

const intervalsOf = (nextReviews) =>
  Array.isArray(nextReviews) && nextReviews.length === 4 && nextReviews.every((s) => typeof s === 'string')
    ? nextReviews.map((s) => s.replace(/[\u2066-\u2069]/g, ''))
    : [];

async function sanitize(html, inline) {
  const text = String(html ?? '').replace(SCRIPT, '').replace(MEDIA_TAG, '');
  const names = [...new Set([...text.matchAll(IMG)].map(([tag]) => srcOf(tag)).filter(Boolean))];
  const uris = new Map(await Promise.all(names.map(async (name) => [name, await inline(name)])));
  return text.replace(IMG, (tag) => {
    const uri = uris.get(srcOf(tag));
    return tag.replace(SRC, () => (uri ? ` src="${uri}"` : ''));
  });
}

class AnkiStudy {
  constructor(client) {
    this.client = client;
    this.browser = new AnkiBrowser(client);
  }

  async queue({ deck, allowedDecks, newLimit = 20, native }) {
    if (native) return this.renderCards(deck, allowedDecks, native.cardIds ?? [], native.intervals);
    const scope = `deck:"${deck.replace(/[\\"]/g, '\\$&')}"`;
    const [learn, review, fresh] = await this.browser.run([
      ['findCards', { query: `${scope} is:learn is:due` }],
      ['findCards', { query: `${scope} is:review is:due -is:suspended -is:buried` }],
      ['findCards', { query: `${scope} is:new -is:suspended -is:buried` }],
    ]);
    const ids = [...new Set([...(learn ?? []), ...(review ?? []), ...(fresh ?? []).slice(0, newLimit)])].slice(0, MAX_QUEUE);
    return this.renderCards(deck, allowedDecks, ids);
  }

  async renderCards(deck, allowedDecks, ids, nativeIntervals) {
    if (!ids.length) return { cards: [] };

    const infos = (await this.client.invoke('cardsInfo', { cards: ids })) ?? [];
    const byId = new Map(infos.map((info) => [info.cardId, info]));
    const kept = ids.map((id) => byId.get(id)).filter((info) => info && allowedDecks.includes(info.deckName) && inDeck(info.deckName, deck));

    // AnkiConnect serves one request at a time; unbounded parallel media fetches overflow its listen backlog and time out.
    const media = new Map();
    let tail = Promise.resolve();
    const fetchMedia = (name) => {
      const run = tail.then(() => this.browser.media(name)).catch(() => null);
      tail = run;
      return run;
    };
    const inline = (name) => {
      if (!media.has(name)) media.set(name, validMediaName(name) ? fetchMedia(name) : Promise.resolve(null));
      return media.get(name);
    };

    const cards = await Promise.all(
      kept.map(async (info) => ({
        id: info.cardId,
        deck: info.deckName,
        question: await sanitize(info.question, inline),
        answer: await sanitize(info.answer, inline),
        css: typeof info.css === 'string' ? info.css : '',
        audio: audioName(info.fields),
        sentence: plainText(info.fields?.Sentence?.value),
        intervals: intervalsOf(nativeIntervals ?? info.nextReviews),
      })),
    );
    return { cards };
  }

  async answer({ cardId, ease, allowedDecks, deck, token }) {
    if (!Number.isInteger(ease) || ease < 1 || ease > 4) throw new Error('ease must be 1-4');
    if (!Number.isInteger(cardId) || cardId < 1) throw new Error('cardId must be a positive integer');

    const [info] = (await this.client.invoke('cardsInfo', { cards: [cardId] })) ?? [];
    if (!info?.deckName) throw new Error('Card not found');
    const allowed = typeof allowedDecks === 'function' ? await allowedDecks() : allowedDecks;
    if (!allowed.includes(info.deckName)) throw new Error('Deck is hidden');

    if (token) {
      if (!inDeck(info.deckName, deck) || !allowed.includes(deck)) throw new Error('Deck is hidden');
      const result = await this.client.invoke('animeMineStudyAnswer', { deck, cardId, ease, token, visibleDecks: allowed });
      if (result?.ok !== true) throw new Error('Anki did not accept the answer');
      return { ok: true };
    }
    const result = await this.client.invoke('answerCards', { answers: [{ cardId, ease }] });
    if (result?.length !== 1 || result[0] !== true) throw new Error('Anki did not accept the answer');
    return { ok: true };
  }
}

module.exports = { AnkiStudy };
