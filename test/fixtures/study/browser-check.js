// Run with Playwright MCP run_code_unsafe (filename) after serving the repo on
// 127.0.0.1:5195. This fixture uses a fake API and never writes real Anki reviews.
async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const results = [];
  const start = async () => {
    await page.goto('http://127.0.0.1:5195/test/fixtures/study/reviewer.html');
    await page.getByRole('tab', { name: 'Study', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
  };
  for (const [width, height] of [[1440, 900], [1280, 800], [820, 720], [480, 800], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await start();
    let frame = page.frames().find(f => f.parentFrame());
    await frame.waitForSelector('.am-card');
    if (await frame.locator('.definitions').count()) throw new Error('Answer leaked on the front');
    await page.keyboard.press('Space');
    frame = page.frames().find(f => f.parentFrame());
    await frame.waitForSelector('.am-answer-grid');
    const colors = await frame.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      imageHeight: document.querySelector('.am-answer-grid img').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      translationVisible: document.querySelector('.ensentence div.hint').getBoundingClientRect().height > 0,
      scriptHandlers: [...document.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))),
    }));
    const dock = await page.locator('.study-controls').boundingBox();
    if (colors.background !== 'rgb(22, 26, 34)' || colors.imageHeight > 191 || colors.overflow || !colors.translationVisible || colors.scriptHandlers || dock.y + dock.height > height) throw new Error(JSON.stringify({ width, height, colors, dock }));
    await frame.locator('.am-enlarge').click();
    if (!await frame.getByLabel('Enlarge card image').isChecked()) throw new Error('Image toggle not checked');
    const enlarged = await frame.locator('.am-answer-grid img').boundingBox();
    if (enlarged.height <= colors.imageHeight) throw new Error('Image enlargement failed');
    await frame.locator('.am-enlarge').click();
    await page.getByRole('button', { name: 'Original style', exact: true }).click();
    frame = page.frames().find(f => f.parentFrame());
    await frame.waitForSelector('body.card:not(.am-card)');
    if (!await frame.evaluate(() => getComputedStyle(document.body).color === 'rgb(42, 27, 10)')) throw new Error('Original deck styles were not preserved');
    await page.getByRole('button', { name: 'App style', exact: true }).click();
    await page.getByRole('button', { name: 'Hide answer', exact: true }).click();
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page.evaluate(() => window.savedFrame = document.querySelector('iframe'));
    await page.locator('.grade-good').click();
    await page.keyboard.press('3');
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe') && document.querySelector('.grade-good').disabled && window.studyMocks.calls.filter(c => c.ease).length === 1)) throw new Error('Save remounted the frame or allowed duplicate grading');
    await page.evaluate(() => window.studyMocks.rejectGrade());
    await page.getByText('Offline test', { exact: true }).waitFor();
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe') && !document.querySelector('.grade-good').disabled)) throw new Error('Error recovery remounted the frame');
    await page.locator('.grade-good').click();
    await page.evaluate(() => window.studyMocks.resolveGrade());
    await page.getByRole('button', { name: 'Show answer', exact: true }).waitFor();
    if (!await page.evaluate(() => window.savedFrame === document.querySelector('iframe'))) throw new Error('Next card recreated the frame');
    if (!await page.getByText('1 reviewed this session', { exact: true }).isVisible()) throw new Error('Review count not updated');
    results.push({ width, height, ...colors, stableFrame: true });
  }
  // A pending review must not overwrite a session that was explicitly ended.
  await start();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.locator('.grade-good').click();
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
