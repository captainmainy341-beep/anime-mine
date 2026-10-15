// Isolated browser fixture for the real cardDocument/CSS. Never contacts Anki.
// Usage: node scripts/study-rendering-fixture.mjs /path/to/fixture.html
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cardDocument } from '../src/renderer/lib/study.mjs';

const root = new URL('../', import.meta.url);
const card = JSON.parse(await fs.readFile(new URL('test/fixtures/study/jp1k-card.json', root), 'utf8'));
const css = await fs.readFile(new URL('src/renderer/styles.css', root), 'utf8');
const docs = ['question', 'answer'].map(side => cardDocument(card, side));
const json = JSON.stringify(docs).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anki study rendering fixture</title><style>${css}</style></head><body><main style="display:flex;flex-direction:column;height:100dvh;padding:24px;box-sizing:border-box"><h1>Anki</h1><p class="anki-sub">Study rendering regression fixture · no live review writes</p><section class="study"><div class="study-head"><span class="study-deck">JAP LEARN::AJT JP1K</span><span class="anki-sub">50 left</span></div><iframe class="study-card" sandbox="" title="Card"></iframe><button class="primary" id="answer" style="align-self:center">Show answer</button></section></main><script>const docs=${json};const frame=document.querySelector('iframe');frame.srcdoc=docs[0];document.querySelector('#answer').onclick=()=>{frame.srcdoc=docs[1];document.querySelector('#answer').textContent='Answer shown'};</script></body></html>`;

if (!process.argv[2]) throw new Error(`Usage: node ${fileURLToPath(import.meta.url)} /path/to/fixture.html`);
await fs.writeFile(process.argv[2], html);
console.log(process.argv[2]);
