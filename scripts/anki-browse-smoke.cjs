// Isolated Electron renderer fixture: mock IPC, no Anki/profile access.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let win;
const run = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`);
const js = src => win.webContents.executeJavaScript(src);
const until = async check => { for(let i=0;i<100;i++){if(await check()) return;await new Promise(r=>setTimeout(r,30));}throw Error('Renderer timeout'); };
const wait = fn => until(() => run(fn));
const count = () => js('fixture.browseRequests.length');
const noteWrites = () => js('fixture.noteWrites.length');
const actions = () => js('fixture.actions.length');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'anki-browse-electron-'));
 app.setPath('userData',dir); await app.whenReady();
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
 const errors=[]; win.webContents.on('console-message',e=>{if(e.message.includes('Uncaught'))errors.push(e.message);});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 await win.loadFile(path.join(__dirname,'../test/fixtures/anki-controls.html'));
 await wait(()=>[...document.querySelectorAll('[role=tab]')].some(b=>b.textContent.trim()==='Browse'));
 await run(()=>{[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Browse').click();});
 await wait(()=>!!document.querySelector('.bw-title')?.textContent.includes('of 120'));
 assert.ok(await run(()=>document.querySelectorAll('tr[data-id]').length>=1));

 const beforeSearch=await count();
 await run(()=>{const i=document.querySelector('input[aria-label="Search cards"]');i.value='tag:leech';i.dispatchEvent(new Event('input',{bubbles:true}));});
 await until(async()=>(await count())>beforeSearch);
 await new Promise(r=>setTimeout(r,500));
 const searchReqs=await js(`fixture.browseRequests.slice(${beforeSearch})`);
 assert.equal(searchReqs.length,1);
 assert.equal(searchReqs[0].query,'tag:leech');

 const prevSort=await js('fixture.browseRequests.at(-1)');
 const beforeSort=await count();
 await run(()=>{[...document.querySelectorAll('button.bw-sort')].find(b=>b.textContent.trim().startsWith('Interval')).click();});
 await until(async()=>(await count())>beforeSort);
 const nextSort=await js('fixture.browseRequests.at(-1)');
 assert.notDeepEqual([nextSort.sort,nextSort.desc],[prevSort.sort,prevSort.desc]);
 await wait(()=>[...document.querySelectorAll('th[aria-sort]')].some(th=>th.textContent.trim().startsWith('Interval')&&th.getAttribute('aria-sort')!=='none'));

 const beforeClear=await count();
 await run(()=>{const i=document.querySelector('input[aria-label="Search cards"]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));});
 await until(async()=>(await count())>beforeClear);
 await wait(()=>document.querySelectorAll('tr[data-id]').length>=4&&!document.querySelector('[aria-busy="true"]'));
 await run(()=>{document.querySelectorAll('tr[data-id]')[0].click();});
 await run(()=>{document.querySelectorAll('tr[data-id]')[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));});
 assert.equal(await run(()=>document.querySelector('.bw-sel-count').textContent),'4 selected');

 const beforeSuspend=await actions();
 await run(()=>{[...document.querySelectorAll('[role=toolbar] button')].find(b=>['Suspend','Unsuspend'].includes(b.textContent.trim())).click();});
 await until(async()=>(await actions())>beforeSuspend);
 const suspend=await js('fixture.actions.at(-1)');
 assert.ok(['suspend','unsuspend'].includes(suspend.action));
 assert.equal(suspend.cardIds.length,4);
 assert.ok(suspend.decks.length>0);

 await wait(()=>!document.querySelector('[aria-busy="true"]'));
 await run(()=>{[...document.querySelectorAll('tr[data-id]')].find(r=>!r.classList.contains('flag-2')).click();});
 const beforeFlag=await actions();
 await run(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'2',metaKey:true,ctrlKey:true,bubbles:true,cancelable:true}));});
 await until(async()=>(await actions())>beforeFlag);
 const flag=await js('fixture.actions.at(-1)');
 assert.equal(flag.action,'flag');
 assert.equal(flag.args.flag,2);

 await wait(()=>!!document.querySelector('#bw-f-Meaning'));
 const noteId=await run(async()=>{const id=Number(document.querySelector('tr[aria-selected="true"]').dataset.id);return (await window.api.anki.cardInfo({cardId:id})).note.id;});
 const beforeNote=await noteWrites();
 const meaning='smoke meaning edit';
 await run(()=>{const t=document.querySelector('#bw-f-Meaning');t.value='smoke meaning edit';t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));});
 await until(async()=>(await noteWrites())>beforeNote);
 const note=await js('fixture.noteWrites.at(-1)');
 assert.equal(note.noteId,noteId);
 assert.equal(note.fields.Meaning,meaning);

 await wait(()=>[...document.querySelectorAll('.bw-btn')].some(b=>b.textContent.trim()==='Load more'));
 const beforeMore=await count();
 await run(()=>{[...document.querySelectorAll('.bw-btn')].find(b=>b.textContent.trim()==='Load more').click();});
 await until(async()=>(await js(`fixture.browseRequests.slice(${beforeMore}).some(r=>r.offset===100)`)));

 await js(`window.__confirms=[];window.__answer=false;window.confirm=m=>{window.__confirms.push(m);return window.__answer;};null`);
 await run(()=>{const t=document.querySelector('#bw-f-Meaning');t.value='dirty edit';t.dispatchEvent(new Event('input',{bubbles:true}));});
 const guardRequests=await count();
 const confirmsBefore=await js('window.__confirms.length');
 await run(()=>{document.querySelector('tr[aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));});
 assert.equal(await js('window.__confirms.length'),confirmsBefore+1);
 assert.equal(await run(()=>document.querySelector('.bw-sel-count').textContent),'1 selected');
 assert.equal(await run(()=>document.querySelector('#bw-f-Meaning').value),'dirty edit');
 await run(()=>{const i=document.querySelector('input[aria-label="Search cards"]');i.value='tag:leech';i.dispatchEvent(new Event('input',{bubbles:true}));});
 await run(()=>{[...document.querySelectorAll('button.bw-sort')].find(b=>b.textContent.trim().startsWith('Word')).click();});
 await new Promise(r=>setTimeout(r,400));
 assert.equal(await count(),guardRequests);
 assert.equal(await run(()=>document.querySelector('input[aria-label="Search cards"]').value),'');

 await run(()=>{[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Overview').click();});
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await run(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Browse').getAttribute('aria-selected')),'true');
 await run(()=>{[...document.querySelectorAll('.anki-head .seg button')].find(b=>b.textContent==='Sample').click();});
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await js('fixture.mode'),'live');
 await run(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Choose decks').click();});
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await run(()=>!!document.querySelector('.picker')),false);
 assert.equal(await run(()=>document.querySelector('#bw-f-Meaning').value),'dirty edit');
 await js('window.__answer=true');
 await run(()=>{[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Overview').click();});
 await wait(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Overview')?.getAttribute('aria-selected')==='true');

 await run(()=>{[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Browse').click();});
 await wait(()=>document.querySelectorAll('tr[data-id]').length>=4&&!document.querySelector('[aria-busy="true"]'));
 await run(()=>{document.querySelectorAll('tr[data-id]')[0].click();});
 await wait(()=>!!document.querySelector('#bw-f-Meaning'));
 await js(`(()=>{const u=window.api.anki.updateNote;window.api.anki.updateNote=async a=>{await new Promise(r=>setTimeout(r,400));return u(a);};})()`);
 await run(()=>{const t=document.querySelector('#bw-f-Meaning');t.value='race edit';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.bw-save-row .primary').click();});
 await wait(()=>document.querySelector('.bw-save-row .primary')?.textContent==='Saving…');
 await run(()=>{document.querySelectorAll('tr[data-id]')[2].click();});
 await until(async()=>(await js('fixture.noteWrites.some(w=>w.fields.Meaning==="race edit")')));
 await wait(()=>document.querySelector('.bw-save-row .primary')?.textContent==='Save'&&!document.querySelector('[aria-busy="true"]'));
 assert.equal(await run(()=>document.querySelector('.bw-save-row .bw-muted').textContent),'');

 await run(()=>{[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Overview').click();});
 await wait(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Overview')?.getAttribute('aria-selected')==='true');
 await js(`(()=>{const u=window.api.anki.browse;window.api.anki.browse=async a=>{const r=await u(a);return {...r,cards:r.cards.map(c=>c.id===1110?{...c,fieldsTruncated:['Meaning']}:c)};};})()`);
 const initialRequests=await count();
 await run(async()=>{const box=document.createElement('div');box.id='initial-browse';document.querySelector('#view').append(box);const {mountBrowse}=await import('../../src/renderer/anki/browse.mjs');window.__disposeInitial=mountBrowse(box,{decks:['Anime Mining','Anime Mining::Expressions'],initial:{cardId:1110}});});
 await wait(()=>document.querySelector('#initial-browse tr[aria-selected="true"]')?.dataset.id==='1110');
 assert.ok((await js(`fixture.browseRequests.slice(${initialRequests})`)).some(r=>r.offset===100));
 assert.equal(await run(()=>document.querySelector('#initial-browse #bw-f-Meaning').tagName),'DIV');
 assert.equal(await run(()=>[...document.querySelectorAll('#initial-browse .bw-field-label')].find(l=>l.textContent.startsWith('Meaning')).textContent.includes('Long field — edit in Anki')),true);

 win.setSize(760,900);
 await run(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await run(()=>document.documentElement.scrollWidth<=innerWidth),true);

 assert.deepEqual(errors,[]);
 console.log('PASS: Electron Browse smoke, initial render and count, debounced search, sort, range select, bulk suspend, flag shortcut, note save, load more, dirty-draft guards on selection/search/sort/tab/mode/choose-decks, save-while-switching, initial card beyond page one and truncated field and narrow layout.');
 win.close();app.quit();
})().catch(err=>{console.error(err);app.exit(1);});
