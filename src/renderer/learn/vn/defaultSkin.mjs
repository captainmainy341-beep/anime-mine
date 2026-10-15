// Built-in art, drawn in code (SVG + CSS gradients) so the default pack has no third-party assets
// and nothing to attribute. Everything here is original and CC0.
//
// Shapes carry a few class names (story-breathe, story-blink, story-drift, story-sway, story-shimmer)
// that css/story.css animates; the animations are switched off under prefers-reduced-motion.

const HEX = /^#[0-9a-fA-F]{6}$/;

export const EXPRESSIONS = ['neutral', 'smile', 'tired', 'surprised', 'sad'];

const LOOKS = {
  mio: { hair: '#c9577a', outfit: '#f3a0b6', skin: '#ffe0cc', eyes: '#b34a6e', style: 'bob', clothes: 'sailor', extra: 'clip' },
  sora: { hair: '#2d3c66', outfit: '#6f8fd8', skin: '#f6d6bd', eyes: '#3d6bb3', style: 'short', clothes: 'blazer', extra: 'cowlick' },
  tanaka: { hair: '#2b2b33', outfit: '#4f8f78', skin: '#efcfb3', eyes: '#4a3b30', style: 'neat', clothes: 'suit', extra: 'glasses' },
  line: { hair: '#3a3a4a', outfit: '#a2befa', skin: '#f5d9c4', eyes: '#5a4a6a', style: 'short', clothes: 'casual', extra: '' },
  hana: { hair: '#5a3a2e', outfit: '#7cc6b4', skin: '#fbe0cc', eyes: '#6b4a32', style: 'ponytail', clothes: 'casual', extra: 'band' },
  leo: { hair: '#3b2418', outfit: '#f0a35e', skin: '#d6a17c', eyes: '#4a2e1c', style: 'curly', clothes: 'casual', extra: '' },
  mori: { hair: '#4a4048', outfit: '#8e7cc3', skin: '#f2d4bd', eyes: '#3d3340', style: 'bun', clothes: 'suit', extra: 'earrings' },
  tomi: { hair: '#d2d0d8', outfit: '#c97b5a', skin: '#f0d2bc', eyes: '#4a3b30', style: 'bun', clothes: 'casual', extra: 'glasses' },
};

function hueFromId(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

export function lookFor(char, color) {
  if (LOOKS[char]) return LOOKS[char];
  const hue = hueFromId(char);
  const outfit = HEX.test(color ?? '') ? color : `hsl(${hue} 55% 62%)`;
  return {
    hair: `hsl(${(hue + 40) % 360} 35% 28%)`,
    outfit,
    skin: '#f3d5c0',
    eyes: `hsl(${(hue + 180) % 360} 40% 38%)`,
    style: ['bob', 'short', 'long'][hue % 3],
    clothes: 'casual',
    extra: '',
  };
}

const INK = '#3b2a2a';
const MOUTH = '#7b2d3a';

// One open eye at (x, y): white, iris, pupil and two highlights, with an upper lash line.
function openEye(x, y, p, { rx = 15, ry = 17, iris = 11, pupil = 5 } = {}) {
  return [
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff"/>`,
    `<ellipse cx="${x}" cy="${y + 2}" rx="${iris}" ry="${iris + 3}" fill="url(#${p}-iris)"/>`,
    `<ellipse cx="${x}" cy="${y + 3}" rx="${pupil}" ry="${pupil + 2}" fill="#1f1622"/>`,
    `<circle cx="${x - 4}" cy="${y - 4}" r="3.6" fill="#fff"/><circle cx="${x + 5}" cy="${y + 7}" r="1.8" fill="#fff" opacity=".8"/>`,
    `<path d="M${x - rx - 3} ${y - ry + 6}q${rx + 3} -${ry - 2} ${rx * 2 + 6} 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
  ].join('');
}

function eyes(expr, p) {
  const L = 122;
  const R = 178;
  const Y = 162;
  if (expr === 'smile') {
    return `<path d="M${L - 15} ${Y + 2}q15 -17 30 0M${R - 15} ${Y + 2}q15 -17 30 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
  if (expr === 'tired') {
    const lid = (x) => `<path d="M${x - 16} ${Y - 1}h32" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    const half = (x) => `<path d="M${x - 14} ${Y}a14 11 0 0 0 28 0z" fill="#fff"/><path d="M${x - 9} ${Y}a9 9 0 0 0 18 0z" fill="url(#${p}-iris)"/><path d="M${x - 4} ${Y}a4 5 0 0 0 8 0z" fill="#1f1622"/>`;
    return `<g class="story-blink">${half(L)}${half(R)}</g>${lid(L)}${lid(R)}<path d="M${L - 10} ${Y + 16}q10 4 20 0M${R - 10} ${Y + 16}q10 4 20 0" fill="none" stroke="#9a7c8c" stroke-width="2" opacity=".7"/>`;
  }
  if (expr === 'surprised') {
    return `<g class="story-blink">${openEye(L, Y, p, { rx: 16, ry: 19, iris: 8, pupil: 3 })}${openEye(R, Y, p, { rx: 16, ry: 19, iris: 8, pupil: 3 })}</g>`;
  }
  if (expr === 'sad') {
    return `<g class="story-blink">${openEye(L, Y + 2, p, { ry: 15 })}${openEye(R, Y + 2, p, { ry: 15 })}</g><path d="M${L + 2} ${Y + 18}q3 9 0 13" fill="none" stroke="#9fd2ff" stroke-width="3" stroke-linecap="round" opacity=".85"/>`;
  }
  return `<g class="story-blink">${openEye(L, Y, p)}${openEye(R, Y, p)}</g>`;
}

function brows(expr, color) {
  const shapes = {
    neutral: 'M106 134q16 -7 32 -1M162 133q16 -6 32 1',
    smile: 'M106 132q16 -9 32 -2M162 130q16 -7 32 2',
    tired: 'M106 138q16 -3 32 0M162 138q16 -3 32 0',
    surprised: 'M106 124q16 -10 32 -3M162 121q16 -7 32 3',
    sad: 'M106 136q18 -2 32 -10M162 126q14 8 32 10',
  };
  return `<path d="${shapes[expr]}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity=".9"/>`;
}

function mouth(expr) {
  if (expr === 'smile') {
    return `<path d="M134 202q16 20 32 0z" fill="#c4505f" stroke="${MOUTH}" stroke-width="2.5" stroke-linejoin="round"/><path d="M142 210q8 5 16 0" fill="#f08a96"/>`;
  }
  if (expr === 'surprised') return `<ellipse cx="150" cy="208" rx="8" ry="10" fill="${MOUTH}"/><ellipse cx="150" cy="212" rx="5" ry="4" fill="#c4505f"/>`;
  if (expr === 'sad') return `<path d="M138 212q12 -9 24 0" fill="none" stroke="${MOUTH}" stroke-width="3" stroke-linecap="round"/>`;
  if (expr === 'tired') return `<path d="M138 208q6 -3 12 0t12 0" fill="none" stroke="${MOUTH}" stroke-width="3" stroke-linecap="round"/>`;
  return `<path d="M140 205q10 7 20 0" fill="none" stroke="${MOUTH}" stroke-width="3" stroke-linecap="round"/>`;
}

function hairBack(style, color) {
  if (style === 'ponytail') return `<path d="M78 152C74 82 112 54 150 54s76 28 72 98l-6 14H84z" fill="${color}"/><path d="M214 96c40 10 52 70 34 140c-6 22-22 30-30 18c14-46 12-96-12-128z" fill="${color}"/>`;
  if (style === 'bun') return `<circle cx="150" cy="44" r="30" fill="${color}"/><path d="M78 152C74 82 112 56 150 56s76 26 72 96l-6 14H84z" fill="${color}"/>`;
  if (style === 'curly') return `<path d="M76 150C66 70 112 46 150 46s88 24 74 104l-6 16H82z" fill="${color}"/><g fill="${color}"><circle cx="86" cy="96" r="18"/><circle cx="112" cy="66" r="20"/><circle cx="150" cy="56" r="22"/><circle cx="188" cy="66" r="20"/><circle cx="214" cy="96" r="18"/></g>`;
  if (style === 'bob') return `<path d="M70 150C66 80 110 50 150 50s84 30 80 100l6 100c-16 12-36 8-40-10H104c-4 18-24 22-40 10z" fill="${color}"/>`;
  if (style === 'long') return `<path d="M68 150C64 80 110 50 150 50s86 30 82 100l10 210c-30 14-60 6-70-12H128c-10 18-40 26-70 12z" fill="${color}"/>`;
  if (style === 'neat') return `<path d="M80 150C76 84 112 58 150 58s74 26 70 92l-4 14H84z" fill="${color}"/>`;
  return `<path d="M78 152C74 82 112 54 150 54s76 28 72 98l-6 14H84z" fill="${color}"/>`;
}

function hairFront(style, color, p) {
  if (style === 'curly') {
    return `<path d="M82 132c6-44 34-66 68-66s62 22 68 66c-12-14-22-18-30-14c-6-14-20-20-38-20s-32 6-38 20c-8-4-18 0-30 14z" fill="${color}"/><g fill="${color}"><circle cx="104" cy="92" r="14"/><circle cx="132" cy="80" r="14"/><circle cx="168" cy="80" r="14"/><circle cx="196" cy="92" r="14"/></g><path d="M112 82q38-20 76 0" fill="none" stroke="url(#${p}-shine)" stroke-width="6" stroke-linecap="round"/>`;
  }
  const fringe = style === 'neat' || style === 'bun'
    ? `<path d="M80 140C82 88 116 64 152 64c36 0 66 22 68 76c-14-30-38-46-62-50c-10 16-40 30-78 50z" fill="${color}"/>`
    : `<path d="M80 136C84 84 118 60 150 60s66 24 70 76l-14-22-8 20-14-28-14 24-16-30-16 30-14-24-14 28-8-20z" fill="${color}"/>`;
  const locks = style === 'bob' || style === 'long'
    ? `<path d="M82 124c-8 50-4 92 14 122l10-4c-10-34-10-74-4-110zM218 124c8 50 4 92-14 122l-10-4c10-34 10-74 4-110z" fill="${color}"/>`
    : `<path d="M82 128c-4 26-2 44 6 58l8-4c-4-16-4-32 0-50zM218 128c4 26 2 44-6 58l-8-4c4-16 4-32 0-50z" fill="${color}"/>`;
  const shine = `<path d="M104 92q46-26 94 0" fill="none" stroke="url(#${p}-shine)" stroke-width="7" stroke-linecap="round"/><path d="M116 104q34-14 68 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".18"/>`;
  return fringe + locks + shine;
}

function clothes(kind, outfit, p) {
  const body = 'M28 604C32 404 80 354 150 350S268 404 272 604z';
  const shade = `<path d="${body}" fill="url(#${p}-shade)"/>`;
  if (kind === 'sailor') {
    return [
      `<path d="${body}" fill="#f4f4f8"/>`,
      shade,
      `<path d="M76 384c20-24 46-34 74-34s54 10 74 34l-74 92z" fill="${outfit}"/>`,
      '<path d="M92 388c16-16 36-24 58-24s42 8 58 24" fill="none" stroke="#fff" stroke-width="4" opacity=".9"/>',
      '<path d="M150 418l-30 20 6 22 24-30 24 30 6-22z" fill="#d6455d"/><circle cx="150" cy="420" r="9" fill="#b83149"/>',
    ].join('');
  }
  if (kind === 'blazer' || kind === 'suit') {
    const tie = kind === 'suit' ? '#2f3d55' : '#c94a5a';
    return [
      `<path d="${body}" fill="${outfit}"/>`,
      shade,
      '<path d="M116 352l34 96 34-96z" fill="#f6f6fa"/>',
      `<path d="M144 362h12l5 66-11 16-11-16z" fill="${tie}"/>`,
      '<path d="M116 352l-14 44 30 18zM184 352l14 44-30 18z" fill="#000" opacity=".14"/>',
      kind === 'blazer' ? '<rect x="196" y="430" width="30" height="5" rx="2" fill="#fff" opacity=".5"/>' : '',
    ].join('');
  }
  return [
    `<path d="${body}" fill="${outfit}"/>`,
    shade,
    '<path d="M120 354q30 26 60 0" fill="none" stroke="#fff" stroke-width="5" opacity=".35"/>',
    '<path d="M134 400v60M166 400v60" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>',
  ].join('');
}

function extras(extra, look) {
  if (extra === 'clip') return '<path d="M196 96l10-8 6 12-12 4z" fill="#ffd36e" stroke="#c99a2e" stroke-width="2"/>';
  if (extra === 'cowlick') return `<path d="M150 60c-6-26 10-38 24-32c-12 2-18 12-16 32z" fill="${look.hair}"/>`;
  if (extra === 'band') return '<path d="M206 84c8 4 12 10 12 16" stroke="#e8566e" stroke-width="7" stroke-linecap="round" fill="none"/>';
  if (extra === 'earrings') return '<circle cx="82" cy="182" r="4" fill="#f3d27a"/><circle cx="218" cy="182" r="4" fill="#f3d27a"/>';
  if (extra === 'glasses') return '<g fill="none" stroke="#2a2a33" stroke-width="3"><rect x="102" y="146" width="40" height="32" rx="9"/><rect x="158" y="146" width="40" height="32" rx="9"/><path d="M142 158h16M102 156l-18-4M198 156l18-4"/></g><path d="M108 152l10 -4" stroke="#fff" stroke-width="2" opacity=".5"/>';
  return '';
}

const idPrefix = (char, expr) => `vn-${String(char).toLowerCase().replace(/[^a-z0-9]/g, '') || 'x'}-${expr}`;

// Returns an SVG document string for one character bust (head and shoulders, 300x520). Pure; the mount wraps it in an element.
export function characterSvg(char, expr = 'neutral', color) {
  const look = lookFor(char, color);
  const face = EXPRESSIONS.includes(expr) ? expr : 'neutral';
  const p = idPrefix(char, face);
  const blush = face === 'smile' || face === 'surprised' ? '.5' : '.3';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 520" role="img" aria-hidden="true">',
    '<defs>',
    `<linearGradient id="${p}-shade" x1="0" y1="0" x2="1" y2="0"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`,
    `<linearGradient id="${p}-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="${p}-iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f1622"/><stop offset=".45" stop-color="${look.eyes}"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>`,
    `<linearGradient id="${p}-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".1"/><stop offset=".35" stop-color="#000" stop-opacity="0"/></linearGradient>`,
    '</defs>',
    '<g class="story-breathe">',
    hairBack(look.style, look.hair),
    `<g transform="translate(0 -84)">${clothes(look.clothes, look.outfit, p)}</g>`,
    `<path d="M130 220h40v54c-10 12-30 12-40 0z" fill="${look.skin}"/>`,
    '<path d="M130 232q20 24 40 0v18q-20 16-40 0z" fill="#000" opacity=".12"/>',
    `<ellipse cx="82" cy="164" rx="9" ry="14" fill="${look.skin}"/><ellipse cx="218" cy="164" rx="9" ry="14" fill="${look.skin}"/>`,
    `<path d="M82 140c0 66 38 104 68 108c30-4 68-42 68-108c0-50-32-72-68-72s-68 22-68 72z" fill="${look.skin}"/>`,
    `<path d="M82 140c0 66 38 104 68 108c30-4 68-42 68-108c0-50-32-72-68-72s-68 22-68 72z" fill="url(#${p}-face)"/>`,
    `<ellipse cx="108" cy="190" rx="13" ry="7" fill="#f2988f" opacity="${blush}"/><ellipse cx="192" cy="190" rx="13" ry="7" fill="#f2988f" opacity="${blush}"/>`,
    '<path d="M148 184q3 4 6 0" fill="none" stroke="#c99a86" stroke-width="2" stroke-linecap="round"/>',
    eyes(face, p),
    brows(face, look.hair),
    mouth(face),
    hairFront(look.style, look.hair, p),
    extras(look.extra, look),
    '</g>',
    '</svg>',
  ].join('');
}

const cloud = (x, y, s = 1) => `<g class="story-drift" opacity=".85"><ellipse cx="${x}" cy="${y}" rx="${46 * s}" ry="${16 * s}" fill="#fff"/><ellipse cx="${x - 22 * s}" cy="${y - 8 * s}" rx="${24 * s}" ry="${16 * s}" fill="#fff"/><ellipse cx="${x + 18 * s}" cy="${y - 12 * s}" rx="${28 * s}" ry="${20 * s}" fill="#fff"/></g>`;
const tree = (x, y, s, leaf, trunk = '#7a5638') => `<rect x="${x - 8 * s}" y="${y}" width="${16 * s}" height="${110 * s}" fill="${trunk}"/><circle cx="${x}" cy="${y - 10 * s}" r="${62 * s}" fill="${leaf}"/><circle cx="${x - 40 * s}" cy="${y + 18 * s}" r="${40 * s}" fill="${leaf}"/><circle cx="${x + 42 * s}" cy="${y + 14 * s}" r="${44 * s}" fill="${leaf}"/><circle cx="${x - 18 * s}" cy="${y - 34 * s}" r="${24 * s}" fill="#fff" opacity=".12"/>`;
const lantern = (x, color) => `<g class="story-sway"><path d="M${x} 52v18" stroke="#2a2140" stroke-width="2"/><ellipse cx="${x}" cy="88" rx="16" ry="20" fill="${color}"/><ellipse cx="${x}" cy="88" rx="9" ry="13" fill="#fff" opacity=".35"/><rect x="${x - 8}" y="66" width="16" height="4" fill="#2a2140"/><rect x="${x - 8}" y="106" width="16" height="4" fill="#2a2140"/></g>`;

const BACKGROUNDS = {
  'classroom-morning': {
    css: 'linear-gradient(#cfe4f7 0%, #f6efe0 58%, #b79a78 58%, #8d6f52 100%)',
    shapes: [
      '<rect x="60" y="40" width="340" height="200" rx="6" fill="#bfe1fb"/>',
      cloud(170, 110, 0.9),
      cloud(320, 80, 0.6),
      '<rect x="60" y="40" width="340" height="200" rx="6" fill="none" stroke="#8aa4bb" stroke-width="8"/><path d="M230 40v200M60 140h340" stroke="#8aa4bb" stroke-width="5"/>',
      '<path d="M400 40l150 380H280L60 240z" fill="#fff8d8" opacity=".18"/>',
      '<rect x="560" y="70" width="320" height="150" rx="4" fill="#2f5a4a" stroke="#c9a56a" stroke-width="8"/>',
      '<path d="M590 110q20-10 40 0M600 140h80M600 170h50" stroke="#e8f0ea" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>',
      '<rect x="560" y="222" width="320" height="8" fill="#a98a62"/>',
      '<g fill="#a87b52"><rect x="120" y="300" width="160" height="16" rx="3"/><rect x="600" y="300" width="160" height="16" rx="3"/></g>',
      '<g fill="#6d5038"><rect x="132" y="316" width="8" height="70"/><rect x="260" y="316" width="8" height="70"/><rect x="612" y="316" width="8" height="70"/><rect x="740" y="316" width="8" height="70"/></g>',
    ].join(''),
  },
  'school-gate-evening': {
    css: 'linear-gradient(#f59f7a 0%, #f2d3a7 45%, #6b6a80 45%, #4a4a5e 100%)',
    shapes: [
      '<circle cx="780" cy="130" r="58" fill="#fff0c4" opacity=".9"/><circle cx="780" cy="130" r="90" fill="#fff0c4" opacity=".15"/>',
      cloud(300, 70, 0.8),
      '<rect x="0" y="150" width="960" height="40" fill="#8f7e86"/><path d="M0 150h960" stroke="#6e5f68" stroke-width="4"/>',
      tree(80, 110, 0.9, '#f2b8c6'),
      tree(890, 120, 0.8, '#f2b8c6'),
      '<rect x="300" y="110" width="40" height="240" fill="#5a5466"/><rect x="620" y="110" width="40" height="240" fill="#5a5466"/>',
      '<rect x="290" y="100" width="60" height="16" fill="#3f3a4a"/><rect x="610" y="100" width="60" height="16" fill="#3f3a4a"/>',
      '<rect x="604" y="160" width="12" height="60" fill="#e9e1cf"/>',
      '<g fill="#f7c6d2" opacity=".85"><circle cx="200" cy="260" r="4"/><circle cx="450" cy="300" r="3"/><circle cx="720" cy="270" r="4"/><circle cx="540" cy="220" r="3"/></g>',
    ].join(''),
  },
  'riverside-evening': {
    css: 'linear-gradient(#f4a6a0 0%, #fbd8a5 40%, #5d8bb5 40%, #2e4e78 100%)',
    shapes: [
      '<circle cx="200" cy="140" r="62" fill="#fff0c4" opacity=".85"/>',
      cloud(620, 60, 0.9),
      '<path d="M0 168q240-30 480 0t480 0v12H0z" fill="#6b8f5a"/>',
      '<path d="M520 168q120-110 240 0" fill="none" stroke="#4a3f52" stroke-width="10"/><path d="M500 168h300" stroke="#4a3f52" stroke-width="8"/>',
      '<path d="M560 168v-34M600 168v-62M640 168v-74M680 168v-62M720 168v-34" stroke="#4a3f52" stroke-width="3"/>',
      '<g class="story-shimmer" fill="#fff0c4" opacity=".55"><rect x="160" y="200" width="80" height="4" rx="2"/><rect x="150" y="230" width="100" height="4" rx="2"/><rect x="170" y="262" width="60" height="4" rx="2"/></g>',
      '<path d="M0 200q200-24 400 0t400 0 400 0" fill="none" stroke="#9ec4e3" stroke-width="3" opacity=".6"/><path d="M0 290q240-20 480 0t480 0" fill="none" stroke="#9ec4e3" stroke-width="3" opacity=".4"/>',
      '<path d="M0 360q300-40 600-10t360 10v60H0z" fill="#557a49"/>',
    ].join(''),
  },
  'park-day': {
    css: 'linear-gradient(#a9dcf5 0%, #e4f6d8 50%, #79b66a 50%, #4f8d4a 100%)',
    shapes: [
      '<circle cx="820" cy="80" r="46" fill="#fff6b8"/><circle cx="820" cy="80" r="70" fill="#fff6b8" opacity=".25"/>',
      cloud(160, 70),
      cloud(520, 50, 0.7),
      '<path d="M0 210q200-50 420-10t540-20v30H0z" fill="#8cc47a"/>',
      tree(250, 130, 1, '#4d9a52'),
      tree(700, 150, 0.7, '#5aa860'),
      '<path d="M380 420q80-140 200-210h50q-60 80-80 210z" fill="#e6d4a8" opacity=".85"/>',
      '<g fill="#8a5a3c"><rect x="470" y="268" width="130" height="10" rx="3"/><rect x="470" y="252" width="130" height="8" rx="3"/><rect x="480" y="278" width="8" height="30"/><rect x="582" y="278" width="8" height="30"/></g>',
      '<g fill="#fff"><circle cx="120" cy="330" r="4"/><circle cx="160" cy="350" r="4"/><circle cx="820" cy="320" r="4"/></g><g fill="#ffd36e"><circle cx="120" cy="330" r="1.6"/><circle cx="160" cy="350" r="1.6"/><circle cx="820" cy="320" r="1.6"/></g>',
    ].join(''),
  },
  'festival-hall': {
    css: 'linear-gradient(#2a2148 0%, #6a4a86 60%, #2a2140 60%, #1d1730 100%)',
    shapes: [
      '<g fill="#fff" opacity=".7"><circle cx="90" cy="30" r="1.5"/><circle cx="300" cy="20" r="1.2"/><circle cx="520" cy="36" r="1.5"/><circle cx="880" cy="24" r="1.2"/></g>',
      '<g class="story-sway" opacity=".8"><circle cx="760" cy="40" r="3" fill="#ffd36e"/><path d="M760 40l-26-14M760 40l28-12M760 40l-6-30M760 40l20 22M760 40l-24 20" stroke="#ffd36e" stroke-width="2" stroke-linecap="round"/></g>',
      '<path d="M0 52q120 30 240 0t240 0 240 0 240 0" fill="none" stroke="#2a2140" stroke-width="2"/>',
      lantern(120, '#ff8a6b'),
      lantern(300, '#ffd36e'),
      lantern(480, '#f3a0b6'),
      lantern(660, '#9de3c4'),
      lantern(840, '#ff8a6b'),
      '<g><path d="M60 250l90-40 90 40z" fill="#c94a5a"/><rect x="70" y="250" width="160" height="100" fill="#3b2d4f"/><rect x="70" y="250" width="160" height="16" fill="#f3e3c3"/></g>',
      '<g><path d="M720 250l90-40 90 40z" fill="#3d6bb3"/><rect x="730" y="250" width="160" height="100" fill="#3b2d4f"/><rect x="730" y="250" width="160" height="16" fill="#f3e3c3"/></g>',
    ].join(''),
  },
  cafe: {
    css: 'linear-gradient(#5b4033 0%, #7a5a45 55%, #4a3226 55%, #3a271d 100%)',
    shapes: [
      '<rect x="560" y="40" width="300" height="170" rx="8" fill="#f7d9a8" opacity=".85"/><path d="M710 40v170M560 125h300" stroke="#5b4033" stroke-width="6"/>',
      cloud(650, 90, 0.5),
      '<g fill="#9b7356"><rect x="60" y="70" width="220" height="10"/><rect x="60" y="140" width="220" height="10"/></g>',
      '<g><rect x="80" y="40" width="22" height="30" rx="4" fill="#e9e1cf"/><rect x="112" y="46" width="18" height="24" rx="4" fill="#c97b5a"/><rect x="150" y="38" width="26" height="32" rx="5" fill="#7cc6b4"/><rect x="210" y="44" width="30" height="26" rx="5" fill="#f3d27a"/><rect x="90" y="112" width="40" height="28" rx="4" fill="#e9e1cf"/><rect x="160" y="108" width="24" height="32" rx="4" fill="#9de3c4"/></g>',
      '<g class="story-sway"><path d="M420 0v60" stroke="#2a1c14" stroke-width="2"/><path d="M396 60h48l-10 22h-28z" fill="#f3d27a"/><circle cx="420" cy="90" r="30" fill="#ffe7a8" opacity=".25"/></g>',
      '<rect x="0" y="232" width="960" height="26" fill="#8a5f44"/><rect x="0" y="232" width="960" height="6" fill="#b48463"/>',
      '<g fill="#e9e1cf"><path d="M300 222h30l-4 10h-22z"/><path d="M620 222h30l-4 10h-22z"/></g><path d="M330 224q8 2 0 8M650 224q8 2 0 8" fill="none" stroke="#e9e1cf" stroke-width="3"/>',
    ].join(''),
  },
  'station-day': {
    css: 'linear-gradient(#9fd0f0 0%, #e0f1fb 46%, #b9b2a8 46%, #8f877d 100%)',
    shapes: [
      cloud(200, 60),
      cloud(720, 40, 0.7),
      '<path d="M0 120h960v24H0z" fill="#6e6a74"/><g fill="#6e6a74"><rect x="120" y="144" width="14" height="80"/><rect x="460" y="144" width="14" height="80"/><rect x="800" y="144" width="14" height="80"/></g>',
      '<rect x="380" y="150" width="200" height="44" rx="6" fill="#ffffff" stroke="#3d6bb3" stroke-width="4"/><path d="M400 172h160" stroke="#3d6bb3" stroke-width="6" opacity=".5" stroke-linecap="round"/>',
      '<rect x="0" y="194" width="960" height="12" fill="#f3d27a"/><path d="M0 200h960" stroke="#c99a2e" stroke-width="2" stroke-dasharray="12 10"/>',
      '<rect x="0" y="206" width="960" height="40" fill="#5a5560"/><path d="M0 222h960M0 238h960" stroke="#3a363e" stroke-width="3"/>',
    ].join(''),
  },
  'home-evening': {
    css: 'linear-gradient(#e9d6c0 0%, #f2e4d2 60%, #b38b66 60%, #93704f 100%)',
    shapes: [
      '<rect x="620" y="50" width="240" height="160" rx="6" fill="#f4a6a0"/><rect x="620" y="130" width="240" height="80" fill="#fbd8a5" opacity=".7"/><circle cx="700" cy="150" r="26" fill="#fff0c4" opacity=".9"/>',
      '<path d="M620 50h240v160H620z" fill="none" stroke="#8d6f52" stroke-width="8"/><path d="M740 50v160" stroke="#8d6f52" stroke-width="5"/>',
      '<path d="M600 40h40v190h-40zM840 40h40v190h-40z" fill="#c9577a" opacity=".55"/>',
      '<g fill="#8d6f52"><rect x="80" y="80" width="200" height="12"/><rect x="80" y="150" width="200" height="12"/></g><g><rect x="96" y="52" width="16" height="28" fill="#6f8fd8"/><rect x="116" y="56" width="12" height="24" fill="#f3a0b6"/><rect x="132" y="50" width="18" height="30" fill="#7cc6b4"/><circle cx="240" cy="134" r="14" fill="#4d9a52"/><rect x="232" y="140" width="16" height="10" fill="#c97b5a"/></g>',
      '<rect x="360" y="270" width="240" height="18" rx="4" fill="#7a5638"/><rect x="380" y="288" width="12" height="60" fill="#5e412a"/><rect x="568" y="288" width="12" height="60" fill="#5e412a"/>',
      '<g class="story-sway"><path d="M480 0v40" stroke="#5e412a" stroke-width="2"/><ellipse cx="480" cy="52" rx="34" ry="14" fill="#f3e3c3"/><circle cx="480" cy="66" r="40" fill="#ffe7a8" opacity=".2"/></g>',
    ].join(''),
  },
  shop: {
    css: 'linear-gradient(#f4f6f8 0%, #e6ebef 62%, #c9d1d8 62%, #aeb8c1 100%)',
    shapes: [
      '<rect x="0" y="0" width="960" height="34" fill="#4f8f78"/><rect x="0" y="34" width="960" height="8" fill="#f3d27a"/>',
      '<g fill="#d6dde3" stroke="#9aa6b1" stroke-width="3"><rect x="60" y="80" width="260" height="170"/><rect x="640" y="80" width="260" height="170"/></g>',
      '<g stroke="#9aa6b1" stroke-width="3"><path d="M60 136h260M60 192h260M640 136h260M640 192h260"/></g>',
      '<g><rect x="72" y="102" width="30" height="32" fill="#e8566e"/><rect x="108" y="96" width="24" height="38" fill="#f3d27a"/><rect x="140" y="104" width="34" height="30" fill="#6f8fd8"/><rect x="184" y="98" width="26" height="36" fill="#7cc6b4"/><rect x="220" y="106" width="40" height="28" fill="#f0a35e"/><rect x="270" y="100" width="36" height="34" fill="#e9e1cf"/><rect x="74" y="160" width="40" height="30" fill="#7cc6b4"/><rect x="124" y="156" width="30" height="34" fill="#e8566e"/><rect x="166" y="162" width="48" height="28" fill="#f3d27a"/><rect x="226" y="158" width="34" height="32" fill="#6f8fd8"/><rect x="656" y="100" width="56" height="34" fill="#f0a35e"/><rect x="722" y="104" width="40" height="30" fill="#e9e1cf"/><rect x="772" y="96" width="30" height="38" fill="#e8566e"/><rect x="814" y="102" width="70" height="32" fill="#9de3c4"/><rect x="660" y="158" width="50" height="32" fill="#6f8fd8"/><rect x="720" y="162" width="70" height="28" fill="#f3d27a"/><rect x="800" y="156" width="40" height="34" fill="#7cc6b4"/></g>',
      '<rect x="380" y="200" width="200" height="60" rx="4" fill="#4f8f78"/><rect x="380" y="200" width="200" height="10" fill="#f3d27a"/>',
    ].join(''),
  },
  'beach-day': {
    css: 'linear-gradient(#8fd3f4 0%, #d8f1fb 44%, #3fa0c9 44%, #2a7fae 62%, #f2dfb0 62%, #e3c98f 100%)',
    shapes: [
      '<circle cx="780" cy="70" r="40" fill="#fff6b8"/><circle cx="780" cy="70" r="66" fill="#fff6b8" opacity=".25"/>',
      cloud(220, 60),
      cloud(560, 40, 0.6),
      '<g class="story-shimmer" fill="#fff" opacity=".5"><rect x="120" y="200" width="90" height="4" rx="2"/><rect x="420" y="220" width="120" height="4" rx="2"/><rect x="720" y="206" width="80" height="4" rx="2"/></g>',
      '<path d="M0 262q120-14 240 0t240 0 240 0 240 0" fill="none" stroke="#fff" stroke-width="5" opacity=".7"/>',
      '<path d="M120 330l60-120" stroke="#8a5a3c" stroke-width="6"/><path d="M90 220q90-60 180 0z" fill="#e8566e"/><path d="M120 220q60-40 120 0z" fill="#fff" opacity=".6"/>',
      '<g fill="#f3a0b6"><circle cx="760" cy="350" r="6"/><circle cx="800" cy="370" r="4"/></g>',
    ].join(''),
  },
  'anime-default': {
    css: 'linear-gradient(135deg, #1d2433 0%, #2b3550 55%, #3d3158 100%)',
    shapes: '<path d="M0 360l300-120 260 90 300-160 260 140v90H0z" fill="#ffffff" opacity=".05"/><g class="story-drift" fill="#fff" opacity=".08"><circle cx="200" cy="100" r="40"/><circle cx="700" cy="80" r="24"/></g>',
  },
  default: { css: 'linear-gradient(160deg, #202838 0%, #34405a 100%)', shapes: '' },
};

export const BACKGROUND_IDS = Object.keys(BACKGROUNDS);

export function backgroundFor(id) {
  return BACKGROUNDS[id] ?? BACKGROUNDS.default;
}

export function backgroundSvg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${backgroundFor(id).shapes}</svg>`;
}
