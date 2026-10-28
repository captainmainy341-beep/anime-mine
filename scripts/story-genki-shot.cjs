// Run with npx electron scripts/story-genki-shot.cjs; TAG=before saves baseline evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const out = '/tmp/am-qa/story-genki';
const tag = process.env.TAG || 'after';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-shot-'));
const { buildPack } = require(path.join(root, 'src/core/studyPack'));
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/study', name), 'utf8'));
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(buildPack({ kanjidic: fixture('kanjidic.json'), kradfile: fixture('kradfile.json'), examples: fixture('examples.json') })));
app.setPath('userData', dataDir);
app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await app.whenReady();
  let win;
  for (let i = 0; i < 120 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await delay(50); }
  if (!win) throw new Error('No window');
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  const run = code => win.webContents.executeJavaScript(code);
  await run(`document.querySelector('[data-route="learn"]').click()`);
  await delay(1000);
  await run(`[...document.querySelectorAll('.learn-tabs > button')].find(b => b.textContent.trim() === 'Story').click()`);
  await delay(1200);
  const results = [];
  for (const width of [1440, 1024]) {
    win.setContentSize(width, 900);
    await delay(800);
    // Show the Genki slide, if it is not the initial carousel slide.
    await run(`(() => { const slides = [...document.querySelectorAll('.nf-slide')]; const i = slides.findIndex(s => /Genki path/.test(s.textContent)); if (i < 0) throw Error('Missing Genki hero'); document.querySelectorAll('.nf-dot')[i]?.click(); })()`);
    await delay(1000);
    for (const state of ['hero', 'tile', 'hover']) {
      await run(state === 'hero' ? `document.querySelector('.nf-hero').scrollIntoView({block:'start'})` : `document.querySelector('.nf-row.genki .nf-tile.up').scrollIntoView({block:'center', inline:'nearest'})`);
      await delay(700);
      const tileRect = await run(`(() => {const r=document.querySelector('.nf-row.genki .nf-tile.up').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
      if (state === 'hover') { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(tileRect.x + tileRect.width / 2), y: Math.round(tileRect.y + tileRect.height / 2) }); await delay(600); }
      else { win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 }); await delay(350); }
      fs.writeFileSync(path.join(out, `${tag}-${width}-${state}.png`), (await win.webContents.capturePage()).toPNG());
      const result = await run(`(() => {
        const tile=document.querySelector('.nf-row.genki .nf-tile.up');
        const hero=document.querySelector('.nf-slide.on');
        const rect = el => { const r=el.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const measure = el => ({rect:rect(el), opacity:getComputedStyle(el).opacity, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight, text:el.innerText});
        const names = ${JSON.stringify(state)} === 'hero' ? ['.nf-eyebrow','.nf-hero-title','.nf-hero-sum','.nf-meta','.nf-hero-actions'] : ${JSON.stringify(state)} === 'hover' ? ['.nf-badge','.nf-up','.nf-steps','.nf-tile-hover p','.nf-tile-actions'] : ['.nf-badge','.nf-up','.nf-steps','.nf-tile-info h3','.nf-tile-info p'];
        const root = ${JSON.stringify(state)} === 'hero' ? hero : tile;
        const items=Object.fromEntries(names.map(n => {const el=root.querySelector(n); if(!el) throw Error('Missing '+n); return [n,measure(el)];}));
        const container=rect(${JSON.stringify(state)} === 'hero' ? document.querySelector('.nf-hero') : tile);
        const active=Object.entries(items).filter(([,v])=>+v.opacity > 0.01);
        const overlaps=[]; for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) {const [a,x]=active[i], [b,y]=active[j]; if(x.rect.left < y.rect.right-0.5 && x.rect.right > y.rect.left+0.5 && x.rect.top < y.rect.bottom-0.5 && x.rect.bottom > y.rect.top+0.5) overlaps.push([a,b]);}
        const clipped=active.filter(([,v])=>v.rect.left < container.left-1 || v.rect.right > container.right+1 || v.rect.top < container.top-1 || v.rect.bottom > container.bottom+1 || v.scrollWidth > v.clientWidth+2 || v.scrollHeight > v.clientHeight+2).map(([n])=>n);
        return {container,items,overlaps,clipped};
      })()`);
      results.push({width,state,...result});
    }
  }
  fs.writeFileSync(path.join(out, `${tag}-report.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({width,state,overlaps,clipped}) => ({width,state,overlaps,clipped})), null, 2));
  app.exit(results.some(r => r.overlaps.length || r.clipped.length) ? 1 : 0);
})().catch(e => { console.error(e); app.exit(1); });
