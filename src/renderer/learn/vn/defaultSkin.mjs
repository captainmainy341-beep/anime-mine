// Built-in art, drawn in code (SVG + CSS gradients) so the default pack has no third-party assets
// and nothing to attribute. Everything here is original and CC0.

const HEX = /^#[0-9a-fA-F]{6}$/;

export const EXPRESSIONS = ['neutral', 'smile', 'tired', 'surprised', 'sad'];

const LOOKS = {
  mio: { hair: '#c9577a', outfit: '#f3a0b6', skin: '#ffe0cc', style: 'bob' },
  sora: { hair: '#2d3c66', outfit: '#6f8fd8', skin: '#f6d6bd', style: 'short' },
  tanaka: { hair: '#2b2b33', outfit: '#4f8f78', skin: '#efcfb3', style: 'short' },
  line: { hair: '#3a3a4a', outfit: '#a2befa', skin: '#f5d9c4', style: 'short' },
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
  return { hair: `hsl(${(hue + 40) % 360} 35% 28%)`, outfit, skin: '#f3d5c0', style: hue % 2 ? 'bob' : 'short' };
}

function eyes(expr) {
  if (expr === 'smile') {
    return '<path d="M108 150q12-14 24 0M168 150q12-14 24 0" fill="none" stroke="#3b2a2a" stroke-width="4" stroke-linecap="round"/>';
  }
  if (expr === 'tired') {
    return '<path d="M106 150h26M168 150h26" stroke="#3b2a2a" stroke-width="4" stroke-linecap="round"/><path d="M110 160q10 5 20 0M170 160q10 5 20 0" fill="none" stroke="#9a7c8c" stroke-width="2"/>';
  }
  if (expr === 'surprised') {
    return '<ellipse cx="120" cy="150" rx="9" ry="12" fill="#fff" stroke="#3b2a2a" stroke-width="3"/><ellipse cx="180" cy="150" rx="9" ry="12" fill="#fff" stroke="#3b2a2a" stroke-width="3"/><circle cx="120" cy="151" r="4" fill="#3b2a2a"/><circle cx="180" cy="151" r="4" fill="#3b2a2a"/>';
  }
  if (expr === 'sad') {
    return '<ellipse cx="120" cy="152" rx="7" ry="10" fill="#3b2a2a"/><ellipse cx="180" cy="152" rx="7" ry="10" fill="#3b2a2a"/><path d="M104 136l26 6M196 136l-26 6" stroke="#3b2a2a" stroke-width="3" stroke-linecap="round"/>';
  }
  return '<ellipse cx="120" cy="150" rx="7" ry="10" fill="#3b2a2a"/><ellipse cx="180" cy="150" rx="7" ry="10" fill="#3b2a2a"/><circle cx="122" cy="146" r="2.5" fill="#fff"/><circle cx="182" cy="146" r="2.5" fill="#fff"/>';
}

function mouth(expr) {
  if (expr === 'smile') return '<path d="M132 190q18 18 36 0" fill="#c4505f" stroke="#7b2d3a" stroke-width="3" stroke-linejoin="round"/>';
  if (expr === 'surprised') return '<ellipse cx="150" cy="193" rx="8" ry="11" fill="#7b2d3a"/>';
  if (expr === 'sad' || expr === 'tired') return '<path d="M134 196q16-12 32 0" fill="none" stroke="#7b2d3a" stroke-width="3" stroke-linecap="round"/>';
  return '<path d="M138 192q12 8 24 0" fill="none" stroke="#7b2d3a" stroke-width="3" stroke-linecap="round"/>';
}

function hair(style, color) {
  const back = style === 'bob'
    ? `<path d="M76 140c0-70 40-100 74-100s74 30 74 100v70c0 14-14 20-26 8l-4-60H106l-4 60c-12 12-26 6-26-8z" fill="${color}"/>`
    : `<path d="M82 140c0-64 34-96 68-96s68 32 68 96v10H82z" fill="${color}"/>`;
  const fringe = `<path d="M84 128c20-40 52-52 66-52s46 12 66 52c-26-18-50-22-66-22s-40 4-66 22z" fill="${color}"/>`;
  return { back, fringe };
}

// Returns an SVG document string for one character bust. Pure; the mount wraps it in an element.
export function characterSvg(char, expr = 'neutral', color) {
  const look = lookFor(char, color);
  const face = EXPRESSIONS.includes(expr) ? expr : 'neutral';
  const { back, fringe } = hair(look.style, look.hair);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 520" role="img" aria-hidden="true">',
    back,
    `<path d="M40 520c0-96 44-150 110-150s110 54 110 150z" fill="${look.outfit}"/>`,
    `<path d="M120 370l30 34 30-34" fill="#fff" opacity=".9"/>`,
    `<rect x="132" y="206" width="36" height="42" rx="12" fill="${look.skin}"/>`,
    `<ellipse cx="150" cy="150" rx="70" ry="82" fill="${look.skin}"/>`,
    fringe,
    '<ellipse cx="100" cy="174" rx="12" ry="7" fill="#f2988f" opacity=".35"/><ellipse cx="200" cy="174" rx="12" ry="7" fill="#f2988f" opacity=".35"/>',
    eyes(face),
    mouth(face),
    '</svg>',
  ].join('');
}

const BACKGROUNDS = {
  'classroom-morning': { css: 'linear-gradient(#cfe4f7 0%, #f6efe0 58%, #b79a78 58%, #8d6f52 100%)', shapes: '<rect x="90" y="60" width="260" height="170" rx="6" fill="#e9f5ff" stroke="#8aa4bb" stroke-width="6"/><path d="M220 60v170M90 145h260" stroke="#8aa4bb" stroke-width="4"/><rect x="560" y="80" width="300" height="140" rx="4" fill="#2f5a4a" stroke="#c9a56a" stroke-width="8"/>' },
  'school-gate-evening': { css: 'linear-gradient(#f7b38a 0%, #f2d3a7 45%, #6b6a80 45%, #4a4a5e 100%)', shapes: '<circle cx="780" cy="130" r="54" fill="#fff0c4" opacity=".9"/><rect x="180" y="150" width="14" height="200" fill="#3b3b4a"/><rect x="520" y="150" width="14" height="200" fill="#3b3b4a"/><path d="M194 170h326" stroke="#3b3b4a" stroke-width="10"/>' },
  'riverside-evening': { css: 'linear-gradient(#f4a6a0 0%, #fbd8a5 40%, #5d8bb5 40%, #2e4e78 100%)', shapes: '<circle cx="200" cy="140" r="60" fill="#fff0c4" opacity=".85"/><path d="M0 200q200-40 400 0t400 0 400 0" fill="none" stroke="#9ec4e3" stroke-width="4" opacity=".6"/>' },
  'park-day': { css: 'linear-gradient(#a9dcf5 0%, #e4f6d8 50%, #79b66a 50%, #4f8d4a 100%)', shapes: '<circle cx="820" cy="90" r="46" fill="#fff6b8"/><rect x="250" y="130" width="22" height="130" fill="#7a5638"/><circle cx="261" cy="110" r="72" fill="#4d9a52"/>' },
  'festival-hall': { css: 'linear-gradient(#3a2d5c 0%, #6a4a86 60%, #2a2140 60%, #1d1730 100%)', shapes: '<path d="M0 60q120 40 240 0t240 0 240 0 240 0" fill="none" stroke="#f3a0b6" stroke-width="4"/><circle cx="120" cy="100" r="14" fill="#ffd36e"/><circle cx="360" cy="100" r="14" fill="#9de3c4"/><circle cx="600" cy="100" r="14" fill="#a2befa"/><circle cx="840" cy="100" r="14" fill="#f3a0b6"/>' },
  'anime-default': { css: 'linear-gradient(135deg, #1d2433 0%, #2b3550 55%, #3d3158 100%)', shapes: '<path d="M0 360l300-120 260 90 300-160 260 140v90H0z" fill="#ffffff" opacity=".05"/>' },
  default: { css: 'linear-gradient(160deg, #202838 0%, #34405a 100%)', shapes: '' },
};

export const BACKGROUND_IDS = Object.keys(BACKGROUNDS);

export function backgroundFor(id) {
  return BACKGROUNDS[id] ?? BACKGROUNDS.default;
}

export function backgroundSvg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${backgroundFor(id).shapes}</svg>`;
}
