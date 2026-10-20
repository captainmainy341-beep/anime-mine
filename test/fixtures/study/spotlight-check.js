// Run in Playwright's browser_run_code_unsafe with this filename. Mock API only.
async (page) => {
  await page.goto('http://127.0.0.1:5195/test/fixtures/study/reviewer.html');
  const results = await page.evaluate(async () => {
    const { studyDocument } = await import('/src/renderer/lib/studyPresentation.mjs');
    const fixture = await (await fetch('./jp1k-card.json')).json();
    const parse = (card, side = 'answer', theme = 'app') => new DOMParser().parseFromString(studyDocument(card, side, theme), 'text/html');
    const assert = (value, message) => { if (!value) throw Error(message); };
    const back = parse(fixture);
    assert(back.querySelectorAll('.jpsentence').length === 1, 'Repeated front must not duplicate the full sentence on the answer');
    assert(back.querySelector('.am-sentence .am-target')?.textContent === '届いた', 'Target must be marked for visual prominence');
    const scene = back.querySelector('.am-scene');
    const prompt = back.querySelector('.am-prompt');
    const definition = back.querySelector('.am-answer-grid');
    assert(scene && prompt && definition, 'Prompt, scene and answer regions must exist');
    assert(prompt.compareDocumentPosition(scene) & Node.DOCUMENT_POSITION_FOLLOWING, 'Screenshot must follow the complete sentence');
    assert(scene.compareDocumentPosition(definition) & Node.DOCUMENT_POSITION_FOLLOWING, 'Meaning must follow the screenshot');
    assert(back.querySelectorAll('.ensentence').length === 1 && !prompt.querySelector('.ensentence'), 'Translation must appear only in the revealed answer');
    assert(back.querySelector('.images-details').open, 'Existing screenshot must be visible without an extra disclosure');
    assert(back.querySelector('[aria-label="Enlarge card image"]'), 'Screenshot enlargement must stay keyboard-accessible');
    assert(![...back.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))), 'No card script handlers');
    const front = parse(fixture, 'question');
    assert(!front.querySelector('.definitions,.ensentence,.am-scene'), 'Answer-only data must never leak onto front');
    assert(front.querySelector('.am-sentence').textContent === '昨日、父から手紙が届いた。', 'Full sentence must be preserved');
    const image = '<img src="data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\"/%3E">';
    const native = {question: '<div class="card-wrap"><div class="sentence jp">この<b>場所</b>に来た。</div><div class="pic">'+image+'</div></div>', answer: '<div class="card-wrap"><div class="sentence jp">この<b>場所</b>に来た。</div></div><hr id="answer"><div class="card-wrap"><div class="reading">ばしょ</div><div class="definition"><div class="meaning">place</div></div></div>'};
    const nativeFront = parse(native, 'question');
    assert(nativeFront.querySelector('.am-scene img') && !nativeFront.querySelector('.meaning'), 'AnimeMine screenshot works on front without revealing meaning');
    assert(parse(native).querySelector('.am-answer-grid .meaning')?.textContent === 'place', 'Native recognition answer gets the same reveal layout');
    const onlyWord = parse({question:'<div class="card-wrap"><div class="word">猫</div></div>'}, 'question');
    assert(onlyWord.querySelector('.word')?.textContent === '猫', 'Word-only cards survive');
    const unknown = '<table><tbody><tr><td>Custom layout</td></tr></tbody></table>';
    assert(parse({question:unknown}, 'question').body.innerHTML === unknown, 'Unknown structure must remain untouched');
    const cloze = parse({question:'<span class="cloze">[...]</span>',answer:'hidden answer'}, 'question');
    assert(cloze.body.textContent === '[...]', 'Cloze must remain untouched');
    assert(!parse(fixture, 'answer', 'original').querySelector('.am-scene,.am-target'), 'Original template remains available');
    assert(fixture.answer.includes('onclick="alert(1)"'), 'Source card must not be mutated');
    return { duplicatePromptRemoved:true, targetProminent:true, sceneBetweenSentenceAndMeaning:true, noAnswerLeak:true, nativeAndCustomCardsPreserved:true };
  });
  return results;
}
