// Run with Playwright MCP run_code_unsafe (filename) after serving the repo on
// 127.0.0.1:5195. This fixture uses a fake API and never writes real Anki reviews.
// The reviewer.html fixture only links styles.css, so this check adds the Manga Ink sheets that
// index.html loads; the card front/back are the two sandboxed frames inside section.ink-study.
async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const results = [];
  const inkCss = ['ink-theme.css', 'ink-kit.css', 'ink-anki.css', 'ink-anki-card.css'];
  const frameFor = async (title) => {
    const handle = await page.locator(`iframe[title="${title}"]`).elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error(`No "${title}" card frame`);
    return frame;
  };
  const start = async () => {
    await page.goto('http://127.0.0.1:5195/test/fixtures/study/reviewer.html');
    for (const name of inkCss) await page.addStyleTag({ url: new URL(`/src/renderer/css/${name}`, page.url()).href });
    // On narrow viewports the Anki strip actions overlap the right-hand tabs; drive the tab
    // directly so these still exercise the card layout instead of the (S8-owned) tab strip.
    await page.getByRole('tab', { name: 'Study', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
  };
  for (const [width, height] of [[1440, 900], [1280, 800], [820, 720], [480, 800], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await start();

    // Front: paper card, sentence with the red target underline, no answer content.
    const front = await frameFor('Front of card');
    await front.waitForSelector('body.am-card');
    if (await front.locator('.definitions').count()) throw new Error('Answer leaked on the front');
    const prompt = await front.evaluate(() => {
      const sentence = getComputedStyle(document.querySelector('.am-sentence'));
      const target = getComputedStyle(document.querySelector('.am-target'));
      return {
        background: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scriptHandlers: [...document.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))),
        sentenceCount: document.querySelectorAll('.jpsentence').length,
        targetSameSize: parseFloat(target.fontSize) === parseFloat(sentence.fontSize),
        targetUnderline: target.textDecorationLine.includes('underline') ? target.textDecorationColor : '',
      };
    });
    if (prompt.background !== 'rgb(245, 242, 234)' || prompt.overflow || prompt.scriptHandlers || prompt.sentenceCount !== 1 || !prompt.targetSameSize || prompt.targetUnderline !== 'rgb(255, 46, 110)') throw new Error(JSON.stringify({ width, height, prompt }));

    // Space reveals the answer in the back frame; the front frame stays the same element.
    await page.evaluate(() => window.savedFront = document.querySelector('iframe'));
    await page.keyboard.press('Space');
    const back = await frameFor('Back of card');
    await back.waitForSelector('.am-answer-grid');
    const answer = await back.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth,
      scriptHandlers: [...document.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))),
      sentenceCount: document.querySelectorAll('.jpsentence').length,
      answerGrid: document.querySelectorAll('.am-answer-grid').length,
      translationVisible: document.querySelector('.ensentence div.hint').getBoundingClientRect().height > 0,
    }));
    if (answer.background !== 'rgb(245, 242, 234)' || answer.overflow || answer.scriptHandlers || answer.sentenceCount !== 1 || answer.answerGrid !== 1 || !answer.translationVisible) throw new Error(JSON.stringify({ width, height, answer }));

    // New rating bar: four .ink-rate buttons, only Good is black, tap targets stay usable.
    const bar = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.ink-rate')];
      const good = document.querySelector('.ink-rate-good');
      const goodStyle = getComputedStyle(good);
      const panel = document.querySelector('.ink-study-rate').getBoundingClientRect();
      return {
        count: buttons.length,
        eases: buttons.map(b => b.getAttribute('data-ease')).join(','),
        goodBlack: goodStyle.backgroundColor === 'rgb(10, 10, 10)' && goodStyle.color === 'rgb(245, 242, 234)',
        goodBorder: goodStyle.borderTopWidth,
        heights: buttons.map(b => Math.round(b.getBoundingClientRect().height)),
        enabled: buttons.every(b => !b.disabled),
        inPage: panel.left >= 0 && panel.right <= document.documentElement.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    if (bar.count !== 4 || bar.eases !== '1,2,3,4' || !bar.goodBlack || bar.goodBorder !== '3px' || bar.heights.some(h => h < 44) || !bar.enabled || !bar.inPage || bar.pageOverflow) throw new Error(JSON.stringify({ width, height, bar }));

    // The back keeps the scene one click away. Narrower frames clamp the shot to their width, so
    // the "grows on enlarge" check only applies where the 300px test image still fits (<820px frames do not).
    await back.locator('.am-scene summary').click();
    const shot = await back.locator('.am-scene img').boundingBox();
    const imageHeight = shot?.height ?? 0;
    if (imageHeight < 180 || imageHeight > 300) throw new Error(`Scene image left the frame size: ${imageHeight} at ${width}`);
    if (width >= 820) {
      await back.locator('.am-enlarge').click();
      if (!await back.getByLabel('Enlarge card image').isChecked()) throw new Error(`Image toggle not checked at ${width}`);
      const enlarged = await back.locator('.am-scene img').boundingBox();
      if (enlarged.height <= imageHeight) throw new Error(`Image enlargement failed at ${width}`);
      await back.locator('.am-enlarge').click();
    }

    // Original deck CSS is still one toggle away and comes back to the paper card.
    await page.getByRole('button', { name: 'Original style', exact: true }).click();
    const original = await frameFor('Front of card');
    await original.waitForSelector('body.card:not(.am-card)');
    if (!await original.evaluate(() => getComputedStyle(document.body).color === 'rgb(42, 27, 10)')) throw new Error('Original deck styles were not preserved');
    await page.getByRole('button', { name: 'App style', exact: true }).click();
    await (await frameFor('Front of card')).waitForSelector('body.am-card');
    await (await frameFor('Back of card')).waitForSelector('.am-answer-grid');

    await page.evaluate(() => window.savedFrame = document.querySelector('iframe'));
    await page.locator('.ink-rate-good').click();
    await page.keyboard.press('3');
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe') && document.querySelector('.ink-rate-good').disabled && window.studyMocks.calls.filter(c => c.ease).length === 1)) throw new Error('Save remounted the frame or allowed duplicate grading');
    await page.evaluate(() => window.studyMocks.rejectGrade());
    await page.getByText('Offline test', { exact: true }).waitFor();
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe') && !document.querySelector('.ink-rate-good').disabled)) throw new Error('Error recovery remounted the frame');
    await page.locator('.ink-rate-good').click();
    await page.evaluate(() => window.studyMocks.resolveGrade());
    await page.getByRole('button', { name: 'Show answer', exact: true }).waitFor();
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe') && window.savedFront === document.querySelector('iframe'))) throw new Error('Next card recreated the frame');
    if (!await page.getByText('1 reviewed this session', { exact: true }).isVisible()) throw new Error('Review count not updated');
    results.push({ width, height, ...prompt, imageHeight, ...answer, bar, stableFrame: true });
  }
  // A pending review must not overwrite a session that was explicitly ended.
  await start();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.locator('.ink-rate-good').click();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.evaluate(() => window.studyMocks.resolveGrade());
  await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
  if (await page.locator('iframe').count()) throw new Error('Late grade restored an ended session');
  const preservation = await page.evaluate(async () => {
    const { studyDocument } = await import('/src/renderer/lib/studyPresentation.mjs');
    const front = studyDocument({ question: '<span class="cloze">[...]</span>', answer: '<b>hidden answer</b>' }, 'question');
    const unknown = studyDocument({ question: '<table><tr><td>Custom layout</td></tr></table>' }, 'question');
    return { clozeKept: front.includes('class="cloze"') && !front.includes('hidden answer'), customKept: unknown.includes('<table>') && unknown.includes('Custom layout') };
  });
  if (!preservation.clozeKept || !preservation.customKept || errors.length) throw new Error(JSON.stringify({ preservation, errors }));
  return { results, preservation, lateGradeIgnored: true, pageErrors: errors };
}
