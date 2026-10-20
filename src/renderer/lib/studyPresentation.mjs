import { cardDocument } from './study.mjs';

// Presentation only. Parse the CURRENT side, never mine the answer for front
// content. The original template and the stored note are never changed.
//
// App theme layout follows the "Anki Card Clean" frame: the scene image reads as a black screenshot,
// the front is the sentence with the mined word underlined in red, and the back leads with the big
// headword, its reading, the meaning and the tags before the source sentence and translation.
export function studyDocument(card, side, theme = 'app') {
  if (theme !== 'app') return cardDocument(card, side);
  const markup = String(side === 'answer' ? card.answer ?? '' : card.question ?? '');
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  doc.querySelectorAll('script').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  });
  doc.querySelectorAll('style').forEach(el => {
    if (el.textContent.trim() === String(card.css ?? '').trim()) el.remove();
  });

  const wrap = doc.body.querySelector(':scope > .wrap');
  const native = doc.body.querySelector(':scope > .card-wrap');
  const prompt = wrap?.querySelector(':scope > .sent-center:has(.jpsentence)')
    ?? native?.querySelector(':scope > .sentence');
  if (prompt) {
    const root = wrap ?? native;
    root.classList.add('am-spotlight');
    prompt.classList.add('am-prompt');
    const sentence = prompt.querySelector('.jpsentence') ?? prompt;
    sentence.classList.add('am-sentence');
    sentence.querySelectorAll('b, strong, mark').forEach(el => el.classList.add('am-target'));
    const hasTarget = Boolean(sentence.querySelector('.am-target'));
    // JP1K repeats FrontSide on its back. Remove only identical sentence blocks,
    // retaining any different context, media, tags and unknown custom content.
    const sentenceText = el => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('rt, rp').forEach(node => node.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };
    wrap?.querySelectorAll(':scope > .fside .sent-center').forEach(el => {
      const jp = el.querySelector('.jpsentence');
      if (jp && sentenceText(jp) === sentenceText(sentence) && !el.querySelector('img, audio, video, .ensentence')) el.remove();
    });

    const media = wrap?.querySelector(':scope > details.images-details:has(img)')
      ?? native?.querySelector(':scope > .pic:has(img)');
    const scene = media ? sceneRegion(doc, media) : null;
    const tags = tagChips(doc, root);

    if (side === 'answer') {
      const answer = doc.createElement('section');
      answer.className = 'am-answer-grid';
      answer.setAttribute('aria-label', 'Revealed answer');
      const headword = wrap?.querySelector(':scope > .headword_section');
      if (headword) {
        wordRule(doc, headword);
        answer.append(headword);
      }
      const nativeAnswer = native ? [...doc.body.querySelectorAll(':scope > .card-wrap')].slice(1) : [];
      for (const block of nativeAnswer) {
        // Keep a full furigana reading available without repeating the
        // sentence in the default layout. Different examples stay untouched.
        block.querySelectorAll(':scope > .sentence').forEach(el => {
          if (sentenceText(el) !== sentenceText(sentence)) return;
          if (el.querySelector('ruby')) {
            const reading = doc.createElement('details');
            reading.className = 'am-sentence-reading';
            const summary = doc.createElement('summary');
            summary.textContent = 'Sentence reading';
            el.before(reading);
            reading.append(summary, el);
          } else el.remove();
        });
        answer.append(block);
      }
      if (tags) answer.append(tags);
      if (answer.hasChildNodes()) {
        prompt.before(answer);
        answer.after(divider(doc));
      }
      const translation = prompt.querySelector('.ensentence');
      if (translation) {
        translation.querySelectorAll('a.hint').forEach(el => el.remove());
        translation.querySelectorAll('div.hint').forEach(el => { el.style.removeProperty('display'); });
      }
      native?.parentElement?.querySelector(':scope > hr#answer')?.remove();
      const footer = wrap?.querySelector(':scope > footer');
      if (footer) {
        const links = doc.createElement('details');
        links.className = 'am-card-links';
        const summary = doc.createElement('summary');
        summary.textContent = 'Card links';
        footer.before(links);
        links.append(summary, footer);
      }
      for (const source of root.querySelectorAll('.source, .notes')) source.classList.add('am-source');
      // The scene is optional help on the back (the frame keeps the answer clean): keep it one click away.
      if (scene) {
        const details = scene.querySelector('details');
        if (details) details.open = false;
        root.append(scene);
      }
    } else {
      if (scene) prompt.before(scene);
      let anchor = prompt;
      if (hasTarget) {
        const hint = doc.createElement('p');
        hint.className = 'am-front-hint';
        hint.textContent = 'What does the underlined word mean?';
        anchor.after(hint);
        anchor = hint;
      }
      if (tags) {
        const rule = divider(doc);
        anchor.after(rule);
        rule.after(tags);
      }
    }
  }
  // DOMParser relocates template styles to <head>. Preserve non-duplicate styles.
  const styles = [...doc.head.querySelectorAll('style')].map(el => el.outerHTML).join('');
  return cardDocument({ ...card, [side]: styles + doc.body.innerHTML }, side, { theme: 'app' });
}

// Red rule under the big headword, as in the frame. Purely presentational.
function wordRule(doc, section) {
  const word = section.querySelector('.target_word');
  if (!word || section.querySelector('.am-word-rule')) return;
  const rule = doc.createElement('div');
  rule.className = 'am-word-rule';
  word.after(rule);
}

function divider(doc) {
  const rule = doc.createElement('div');
  rule.className = 'am-divider';
  return rule;
}

// Anki tags become the frame's small rounded chips. The original tag strip is replaced, not kept.
function tagChips(doc, root) {
  const source = root?.querySelector('header .tags') ?? doc.body.querySelector('.tags');
  if (!source) return null;
  const words = String(source.textContent ?? '').split(/\s+/).filter(Boolean);
  const header = source.closest('header');
  source.remove();
  if (header && !header.textContent.trim() && !header.querySelector('img, audio, video')) header.remove();
  if (!words.length) return null;
  const block = doc.createElement('div');
  block.className = 'am-tags';
  for (const word of words) {
    const chip = doc.createElement('span');
    chip.className = 'am-tag';
    chip.textContent = word.replace(/_/g, ' ');
    block.append(chip);
  }
  return block;
}

function sceneRegion(doc, media) {
  const images = media.matches('.pic') ? media : media.querySelector('.images');
  if (!images) return null;
  const scene = doc.createElement('figure');
  scene.className = 'am-scene';
  const toggle = doc.createElement('input');
  toggle.type = 'checkbox';
  // Avoid collision with IDs authored inside a custom card.
  let id = 'am-enlarge-image';
  while (doc.getElementById(id)) id += '-scene';
  toggle.id = id;
  toggle.className = 'am-image-toggle';
  toggle.setAttribute('aria-label', 'Enlarge card image');
  const control = doc.createElement('label');
  control.htmlFor = id;
  control.className = 'am-enlarge';
  control.innerHTML = '<span class="am-expand">Enlarge image</span><span class="am-collapse">Reduce image</span>';
  const imageLabel = doc.createElement('label');
  imageLabel.htmlFor = id;
  imageLabel.className = 'am-scene-image';
  images.classList.add('am-scene-images');
  if (!media.matches('.pic')) {
    media.open = true;
    // Keep the existing disclosure and its label, but make the image prominent.
    images.before(toggle, control, imageLabel);
    imageLabel.append(images);
    scene.append(media);
  } else {
    scene.append(toggle, control, imageLabel);
    imageLabel.append(images);
  }
  return scene;
}
