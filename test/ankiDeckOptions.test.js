const test = require('node:test');
const assert = require('node:assert/strict');
const { AnkiDeckOptions, validatePatch } = require('../src/core/ankiDeckOptions');

test('deck option patch rejects unknown keys, invalid scopes and out-of-range values', () => {
  for (const patch of [{scope:'session'}, {scope:'permanent',newPerDay:-1}, {scope:'permanent',reviewsPerDay:1.2}, {scope:'permanent',newPerDay:'20'}, {scope:'permanent',newPerDay:10000}, {scope:'permanent',fsrs:'yes'}, {scope:'today',newMix:1}, {scope:'permanent',buryNew:'yes'}]) {
    assert.throws(() => validatePatch(patch));
  }
  assert.deepEqual(validatePatch({scope:'permanent',newPerDay:0,reviewsPerDay:9999,newMix:1,buryNew:true,buryReviews:false,buryLearning:true}), {scope:'permanent',newPerDay:0,reviewsPerDay:9999,newMix:1,buryNew:true,buryReviews:false,buryLearning:true});
  assert.deepEqual(validatePatch({scope:'today',clearToday:true}), {scope:'today',clearToday:true});
});

test('deck option patch accepts each new key at its limits and rejects one step beyond', () => {
  const ok = [{learnSteps:[1,10,0.5,1440*365]},{relearnSteps:[]},{graduatingInterval:1},{graduatingInterval:365},{easyInterval:365},{startingEase:130},{startingEase:999},{maxInterval:36500},{easyBonus:1000},{intervalModifier:50},{hardInterval:200},{lapseNewInterval:0},{lapseMinInterval:1},{leechThreshold:9999},{leechAction:1},{maxAnswerSecs:0},{newGatherOrder:5},{newSortOrder:4},{reviewOrder:11},{interdayLearningMix:2},{desiredRetention:0.7},{desiredRetention:0.99},{fsrs:true},{disableAutoplay:true},{showTimer:false},{stopTimerOnAnswer:true},{skipQuestionWhenReplayingAnswer:true},{applyToChildren:true},{presetId:1},{newPreset:{name:'Kanji',cloneCurrent:true}},{renamePreset:{id:2,name:'Kanji 2'}},{removePreset:2}];
  for (const extra of ok) assert.doesNotThrow(() => validatePatch({scope:'permanent', ...extra}), JSON.stringify(extra));
  const bad = [{learnSteps:[0]},{learnSteps:Array(11).fill(1)},{learnSteps:['1']},{learnSteps:[1440*365+1]},{graduatingInterval:0},{easyInterval:366},{startingEase:129},{easyBonus:99},{intervalModifier:201},{hardInterval:99},{lapseNewInterval:101},{lapseMinInterval:0},{leechThreshold:10000},{leechAction:2},{newGatherOrder:6},{newSortOrder:5},{reviewOrder:12},{maxInterval:36501},{maxAnswerSecs:3601},{desiredRetention:0.69},{desiredRetention:1},{showTimer:1},{presetId:0},{removePreset:1},{presetId:1,newPreset:{name:'x',cloneCurrent:false}},{newPreset:{name:'   ',cloneCurrent:false}},{renamePreset:{id:1,name:'x'},newMix:1},{removePreset:2,applyToChildren:true}];
  for (const extra of bad) assert.throws(() => validatePatch({scope:'permanent', ...extra}), undefined, JSON.stringify(extra));
  assert.throws(() => validatePatch({scope:'today', learnSteps:[1]}));
});

test('save requires a read revision and rechecks authorization before posting', async () => {
  const calls=[];
  const client={invoke:async (action, params)=>{calls.push({action,params});return {revision:'next'};}};
  const options=new AnkiDeckOptions(client);
  await assert.rejects(options.save({deck:'Anime',patch:{scope:'permanent',newPerDay:20}}), /Reload/);
  await assert.rejects(options.save({deck:'Anime',revision:'r',patch:{scope:'today',newPerDay:30},authorize:async()=>{throw Error('Deck is hidden');}}), /hidden/);
  assert.deepEqual(calls,[]);
  await options.save({deck:'Anime',revision:'r',patch:{scope:'today',newPerDay:30},authorize:async()=>{}});
  assert.equal(calls[0].action,'animeMineSetDeckOptions');
  assert.equal(calls[0].params.expectedRevision,'r');
});

test('missing native bridge gives actionable guidance without hiding network errors', async () => {
  const options=new AnkiDeckOptions({invoke:async()=>{throw Error('unsupported action');}});
  await assert.rejects(options.get('Anime'), /Anime Mine bridge/);
  const offline=new AnkiDeckOptions({invoke:async()=>{throw Error('fetch failed');}});
  await assert.rejects(offline.get('Anime'), /fetch failed/);
});

test('get and save forward the visible decks so the add-on can refuse hidden subdecks and presets', async () => {
  const calls = [];
  const options = new AnkiDeckOptions({invoke: async (action, params) => { calls.push({action, params}); return {revision: 'next'} }});
  await options.get('Anime', ['Anime']);
  await options.save({deck: 'Anime', revision: 'r', visibleDecks: ['Anime'], patch: {scope: 'permanent', applyToChildren: true}});
  assert.deepEqual(calls, [
    {action: 'animeMineDeckOptions', params: {deck: 'Anime', visibleDecks: ['Anime']}},
    {action: 'animeMineSetDeckOptions', params: {deck: 'Anime', patch: {scope: 'permanent', applyToChildren: true}, expectedRevision: 'r', visibleDecks: ['Anime']}},
  ]);
});

test('study queue forwards the explicit visible-deck scope', async () => {
  const calls = [];
  const options = new AnkiDeckOptions({invoke: async (action, params) => { calls.push({action, params}); return {cardIds: []}; }});
  await options.queue('Anime', ['Anime']);
  assert.deepEqual(calls, [{action: 'animeMineStudyQueue', params: {deck: 'Anime', visibleDecks: ['Anime']}}]);
});
