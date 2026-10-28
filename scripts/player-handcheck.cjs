// Run: node_modules/.bin/electron scripts/player-handcheck.cjs
// The repository subtitle fixtures are English-only: retain their parsed English
// and add a Japanese line to exercise the real player's bilingual layout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const { parseSubtitleFile } = require('../src/core/subtitles.js');
const root = path.resolve(__dirname, '..');
const out = process.env.ANIME_MINE_HANDCHECK_OUT || '/tmp/am-qa/player-handcheck';
const url = (p) => pathToFileURL(p).href;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'am-player-check-')));
app.disableHardwareAcceleration();
const errors = [];
app.on('web-contents-created', (_, wc) => {
  wc.on('console-message', (_e, level, message) => { if (level >= 2 && !message.includes('Electron Security Warning')) errors.push(message); });
  wc.on('render-process-gone', (_e, details) => errors.push(`renderer gone: ${JSON.stringify(details)}`));
});
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const ass = await parseSubtitleFile(path.join(root, 'test/fixtures/sample.ass'));
  const srt = await parseSubtitleFile(path.join(root, 'test/fixtures/sample.srt'));
  if (ass[0]?.text !== 'Early' || srt[0]?.text !== 'Hello there') throw Error('Fixture parsing changed');
  const cues = [ass[0], srt[0]].map(c => ({ ...c, text: `食べる\n${c.text}` }));
  const styles = ['styles.css', 'css/player.css', 'css/popup.css', 'css/grammar-guide.css', 'css/ink-theme.css', 'css/ink-kit.css', 'css/player-timeline.css'];
  const html = `<!doctype html><html><head><meta charset="utf-8">${styles.map(s => `<link rel="stylesheet" href="${url(path.join(root, 'src/renderer', s))}">`).join('')}
<style>html,body{height:100%;margin:0}body{display:flex;overflow:hidden;background:var(--paper)}#nav{width:200px;flex:none;background:#0a0a0a}#view{display:flex;flex:1;min-width:0;min-height:0}</style></head><body><div id="nav"></div><main id="view"></main><div id="toasts" class="toasts"></div><script type="module">
let time=1.5;
Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get(){return time},set(v){time=+v||0}});
Object.defineProperty(HTMLMediaElement.prototype,'duration',{configurable:true,get(){return 100}});
Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,get(){return ''},set(){}});
Object.defineProperty(HTMLMediaElement.prototype,'readyState',{configurable:true,get(){return 4}});
Object.defineProperty(HTMLMediaElement.prototype,'videoWidth',{configurable:true,get(){return 1280}});
Object.defineProperty(HTMLMediaElement.prototype,'videoHeight',{configurable:true,get(){return 720}});
HTMLMediaElement.prototype.load=()=>{}; HTMLMediaElement.prototype.pause=()=>{}; HTMLMediaElement.prototype.play=()=>Promise.resolve();
const ep={path:'/videos/fake.mkv',name:'An Exceptionally Long Episode Title With Several Complete Words For Testing.mkv',episode:1,subtitlePath:'/subs/sample.ass'};
window.fixtureCues=${JSON.stringify(cues)}; let fixture=0;
window.api={settings:{get:async()=>({highlightUnknown:true,showFurigana:true}),set:async()=>({})},media:{onProgress:()=>()=>{},probe:async()=>({duration:100,streams:[],plan:{mode:'direct'},defaults:{},saved:{position:1.5,subtitle:'external'}}),prepare:async()=>({path:'/videos/fake.mkv',cleaned:false}),cancel:async()=>{}},player:{loadCues:async()=>({cues:[window.fixtureCues[fixture]],source:'external',synced:false})},nlp:{tokenize:async(text)=>[{surface:'食べる',start:0,end:3,isWord:true,reading:'たべる',base:'食べる'}]},known:{classify:async()=>({statuses:['new'],info:{}})},library:{getShows:async()=>[{title:'An Exceptionally Long Episode Title With Several Complete Words For Testing',episodes:[ep]}]},progress:{update:async()=>({}),next:async()=>null},anki:{status:async()=>({connected:false})},dict:{onProgress:()=>{}}};
const {mountPlayer}=await import('${url(path.join(root,'src/renderer/player.mjs'))}');
const {furiganaSegments}=await import('${url(path.join(root,'src/renderer/lib/furigana.mjs'))}');
window.segments=furiganaSegments({surface:'食べる',reading:'たべる'});
window.mountFixture=async(i)=>{fixture=i; mountPlayer(document.querySelector('#view'),ep,{onBack(){},onOpenSettings(){},onPlayEpisode(){}}); await new Promise(r=>setTimeout(r,500)); const v=document.querySelector('video');v.dispatchEvent(new Event('loadedmetadata'));v.dispatchEvent(new Event('timeupdate'));await new Promise(r=>setTimeout(r,500));window.ready=true};
await window.mountFixture(Number(new URL(location.href).searchParams.get('fixture')) || 0);
</script></body></html>`;
  fs.writeFileSync(path.join(out, 'harness.html'), html);
  await app.whenReady();
  const win = new BrowserWindow({show:false,width:1440,height:1000,useContentSize:true,webPreferences:{sandbox:false}});
  await win.loadFile(path.join(out, 'harness.html'));
  for (let i=0;i<120 && !(await win.webContents.executeJavaScript('window.ready === true'));i++) await sleep(100);
  if (!(await win.webContents.executeJavaScript('window.ready === true'))) throw Error('Player did not become ready');
  const report = { fixtures: {ass, srt}, cases: [], errors };
  for (let i=0;i<2;i++) {
    if (i) { await win.loadFile(path.join(out, 'harness.html'), {query:{fixture:'1'}}); for (let n=0;n<120 && !(await win.webContents.executeJavaScript('window.ready === true'));n++) await sleep(100); if (!(await win.webContents.executeJavaScript('window.ready === true'))) throw Error('SRT player did not become ready'); }
    await sleep(300);
    const result = await win.webContents.executeJavaScript(`(() => {
      const lines=[...document.querySelectorAll('.subtitle-overlay .subtitle-line')];
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      const overlay=document.querySelector('.subtitle-overlay'), plate=document.querySelector('.stage-plate'), ruby=lines[0]?.querySelector('ruby');
      const word=lines[0]?.querySelector('.word'); const rs=lines.map(rect); const pr=rect(plate), or=rect(overlay);
      return {text:lines.map(e=>e.innerText),rects:rs,overlay:or,ruby:ruby?.textContent,wordHtml:word?.innerHTML,segments:window.segments,title:plate.textContent,titleTooltip:plate.title,titleRect:pr,titleScrollWidth:plate.scrollWidth,titleClientWidth:plate.clientWidth,titleStyle:{overflow:getComputedStyle(plate).overflow,textOverflow:getComputedStyle(plate).textOverflow,whiteSpace:getComputedStyle(plate).whiteSpace}};
    })()`);
    const checks = {
      twoLines: result.text.length === 2 && result.text[1] === (i ? 'Hello there' : 'Early'),
      verticalGap: result.rects.length === 2 && result.rects[1].top > result.rects[0].bottom,
      insideBlot: result.rects.every(r => r.left >= result.overlay.left-1 && r.right <= result.overlay.right+1 && r.top >= result.overlay.top-1 && r.bottom <= result.overlay.bottom+1),
      rubyKanjiOnly: JSON.stringify(result.segments) === JSON.stringify([{text:'食',ruby:'た'},{text:'べる'}]) && /<ruby>食<rt>た<\/rt><\/ruby>べる/.test(result.wordHtml || ''),
      titleNotClipped: result.titleScrollWidth <= result.titleClientWidth + 1 && result.titleTooltip === result.title,
    };
    const shot=path.join(out, `${i ? 'srt' : 'ass'}-dual.png`);
    fs.writeFileSync(shot,(await win.webContents.capturePage()).toPNG());
    report.cases.push({fixture:i?'sample.srt':'sample.ass',shot,checks,result});
  }
  report.passed = !errors.length && report.cases.every(c=>Object.values(c.checks).every(Boolean));
  fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  win.destroy(); app.exit(report.passed ? 0 : 1);
})().catch(err=>{console.error(err);app.exit(1)});
