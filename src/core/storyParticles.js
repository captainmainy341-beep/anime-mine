const PARTICLES = require('./data/particles.json');

// The particle guide for the Story tab: the shared particle data (data/particles.json, also used by the
// sentence grammar panel) plus pairs learners mix up, written for this app.

const GUIDE_LEVELS = new Set(['N5', 'N4']);

// One line per particle, used to explain a wrong pick in a fill-in-the-particle challenge.
const SHORT = {
  は: 'marks the topic: what the sentence is about ("as for ...").',
  が: 'marks the subject, new information, or the thing liked/had/wanted (with 好き, ある, ほしい).',
  を: 'marks the object: the thing an action is done to.',
  に: 'marks a destination, a point in time, where something exists, or who receives something.',
  で: 'marks where an action happens, or the means used (by bus, in Japanese).',
  へ: 'marks a direction someone heads toward.',
  と: 'means "and" for a complete list, or "with" someone.',
  や: 'means "and" for examples from a longer list ("A, B and so on").',
  の: 'links two nouns: "A\'s B" or "B of A".',
  も: 'means "also / too" and replaces は, が or を.',
  か: 'turns a sentence into a question, or means "or".',
  から: 'means "from" (a place or time), or "because" after a reason.',
  まで: 'means "until" or "as far as".',
  より: 'means "than" in a comparison.',
  ね: 'asks for agreement ("..., right?").',
  よ: 'tells the listener something new.',
};

const CONFUSIONS = [
  {
    id: 'wa-ga',
    pair: ['は', 'が'],
    title: 'は or が?',
    points: [
      'は sets the topic: what you are talking about. It often carries old or shared information.',
      'が points at the subject when it is new information, and after question words: だれが, なにが.',
      'Likes, skills, having and wanting take が: ねこが好きです, 車があります.',
      'A question asked with は is answered with は; one asked with が (だれが...) is answered with が.',
    ],
    examples: [
      { ja: 'わたしは学生です。', en: 'I am a student. (topic: me)' },
      { ja: 'だれが来ましたか。…ハナさんが来ました。', en: 'Who came? ...Hana came. (new information)' },
      { ja: 'わたしはねこが好きです。', en: 'As for me, I like cats.' },
    ],
  },
  {
    id: 'ni-de',
    pair: ['に', 'で'],
    title: 'に or で for places?',
    points: [
      'に: where something or someone is (ある, いる, すむ) and where you go (行く, 来る, 帰る).',
      'で: where an action takes place (食べる, 勉強する, 買う, 会う).',
      'Ask yourself: is something happening there (で), or is something just there / going there (に)?',
    ],
    examples: [
      { ja: 'としょかんにいます。', en: "I'm at the library. (existence → に)" },
      { ja: 'としょかんで勉強します。', en: 'I study at the library. (action → で)' },
      { ja: 'カフェに行って、カフェでコーヒーを飲みます。', en: 'I go to the café and drink coffee at the café.' },
    ],
  },
  {
    id: 'ni-e',
    pair: ['に', 'へ'],
    title: 'に or へ for destinations?',
    points: [
      'With 行く, 来る and 帰る both work: 日本に行きます = 日本へ行きます.',
      'へ (read "e") stresses the direction; に stresses the arrival point.',
      'Only に works for time (三時に), for existence (へやにいる) and for the person you give to (友だちにあげる).',
    ],
    examples: [
      { ja: 'あした、京都へ行きます。', en: "I'm heading to Kyoto tomorrow." },
      { ja: '七時に家に帰ります。', en: 'I go home at seven.' },
    ],
  },
  {
    id: 'wo-ga',
    pair: ['を', 'が'],
    title: 'を or が for the object?',
    points: [
      'Action verbs take を: コーヒーを飲む, 本を読む.',
      'Some words describe a state, not an action, and take が: 好き, きらい, 上手, わかる, ほしい, できる.',
      'So: 日本語を勉強します but 日本語がわかります.',
    ],
    examples: [
      { ja: 'すしを食べます。', en: 'I eat sushi.' },
      { ja: 'すしが好きです。', en: 'I like sushi.' },
    ],
  },
  {
    id: 'to-ya',
    pair: ['と', 'や'],
    title: 'と or や for "and"?',
    points: [
      'と lists everything: パンとたまごを買いました means bread and eggs, nothing else.',
      'や gives examples from a longer list, often with など: パンやたまご(など) = bread, eggs and so on.',
      'と also means "with" a person: 友だちと行きます.',
    ],
    examples: [
      { ja: 'りんごとみかんを買いました。', en: 'I bought apples and oranges.' },
      { ja: 'りんごやみかんなどを買いました。', en: 'I bought apples, oranges and other things.' },
    ],
  },
  {
    id: 'ni-time',
    pair: ['に', '(none)'],
    title: 'に with times, or no particle?',
    points: [
      'Clock times, days and dates take に: 三時に, 日曜日に, 五月に.',
      'Relative times take nothing: 今日, あした, 毎日, 今, 来週, きのう.',
    ],
    examples: [
      { ja: '日曜日に会いましょう。', en: "Let's meet on Sunday." },
      { ja: 'あした会いましょう。', en: "Let's meet tomorrow. (no に)" },
    ],
  },
  {
    id: 'mo-replace',
    pair: ['も', 'は / が / を'],
    title: 'も replaces は, が and を',
    points: [
      'も takes the place of は, が or を: わたしも学生です (not わたしはも).',
      'With other particles it is added after them: 京都にも行きました, 友だちとも話しました.',
    ],
    examples: [
      { ja: 'レオさんも学生です。', en: 'Leo is a student too.' },
      { ja: 'コーヒーも飲みます。', en: 'I drink coffee too.' },
    ],
  },
  {
    id: 'ni-meet-ride',
    pair: ['に', 'を'],
    title: 'Verbs that take に, not を',
    points: [
      'Meeting a person: 友だちに会います.',
      'Getting on a vehicle: 電車に乗ります.',
      'Entering: へやに入ります.',
      'English uses an object here, Japanese marks a target with に.',
    ],
    examples: [
      { ja: 'えきで先生に会いました。', en: 'I met my teacher at the station.' },
      { ja: 'バスに乗りましょう。', en: "Let's take the bus." },
    ],
  },
  {
    id: 'de-means',
    pair: ['で', 'に'],
    title: 'で for "by / with / in"',
    points: [
      'で marks how you do something: バスで行く (by bus), はしで食べる (with chopsticks), 日本語で話す (in Japanese).',
      'Do not confuse it with に + 乗る: バスに乗る (get on the bus) but バスで行く (go by bus).',
    ],
    examples: [
      { ja: 'じてんしゃで学校に行きます。', en: 'I go to school by bike.' },
      { ja: '日本語で話しましょう。', en: "Let's talk in Japanese." },
    ],
  },
];

const bySurface = new Map(PARTICLES.map((p) => [p.surface, p]));
const byId = new Map(PARTICLES.map((p) => [p.id, p]));

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

function guide() {
  return {
    particles: PARTICLES.filter((p) => GUIDE_LEVELS.has(p.level)).map((p) => ({
      id: p.id,
      surface: p.surface,
      name: p.name,
      level: p.level,
      roles: p.roles.map((r) => ({ id: r.id, explanation: r.explanation, example: r.example ?? null })),
      confusions: CONFUSIONS.filter((c) => c.pair.includes(p.surface)).map((c) => c.id),
    })),
    confusions: CONFUSIONS,
  };
}

// The role a particle beat is about, e.g. "p:ni/destination", as a one-line explanation.
function roleExplanation(role) {
  if (typeof role !== 'string') return null;
  const [id, roleId] = role.split('/');
  const entry = byId.get(id)?.roles.find((r) => r.id === roleId);
  return entry ? lowerFirst(entry.explanation) : null;
}

function noteFor(surface) {
  if (SHORT[surface]) return SHORT[surface];
  const first = bySurface.get(surface)?.roles[0]?.explanation;
  return first ? lowerFirst(first) : null;
}

// Adds `notes` (option -> what that particle does) and `why` (what the gap needs) to particle beats, so a
// wrong pick can be explained in the player without shipping the guide data with every scene.
function annotateScene(scene) {
  if (!scene.beats.some((b) => b.type === 'particle')) return scene;
  return {
    ...scene,
    beats: scene.beats.map((beat) => {
      if (beat.type !== 'particle') return beat;
      const notes = Object.fromEntries(beat.options.map((o) => [o, noteFor(o)]).filter(([, note]) => note));
      const why = roleExplanation(beat.role) ?? noteFor(beat.answers[0]);
      return { ...beat, notes, ...(why ? { why } : {}) };
    }),
  };
}

module.exports = { guide, annotateScene, roleExplanation, noteFor, CONFUSIONS };
