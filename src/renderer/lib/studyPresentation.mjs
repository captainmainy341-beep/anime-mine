import { cardDocument } from './study.mjs';

// Presentation only. Parse the CURRENT side, never mine the answer for front
// content. The original template and the stored note are never changed.
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
    if (scene) prompt.after(scene);

    if (side === 'answer') {
      const headword = wrap?.querySelector(':scope > .headword_section');
      const nativeAnswer = native ? [...doc.body.querySelectorAll(':scope > .card-wrap')].slice(1) : [];
      const translation = prompt.querySelector('.ensentence');
      if (headword || nativeAnswer.length || translation) {
        const grid = doc.createElement('section');
        grid.className = 'am-answer-grid';
        grid.setAttribute('aria-label', 'Revealed answer');
        (scene ?? prompt).after(grid);
        if (headword) grid.append(headword);
        for (const answer of nativeAnswer) {
          // Keep a full furigana reading available without repeating the
          // sentence in the default layout. Different examples stay untouched.
          answer.querySelectorAll(':scope > .sentence').forEach(el => {
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
          grid.append(answer);
        }
        if (translation) {
          translation.querySelectorAll('a.hint').forEach(el => el.remove());
          translation.querySelectorAll('div.hint').forEach(el => el.style.removeProperty('display'));
          grid.append(translation);
        }
        native?.parentElement.querySelector(':scope > hr#answer')?.remove();
      }
      const footer = wrap?.querySelector(':scope > footer');
      if (footer) {
        const links = doc.createElement('details');
        links.className = 'am-card-links';
        const summary = doc.createElement('summary');
        summary.textContent = 'Card links';
        footer.before(links);
        links.append(summary, footer);
      }
    }
  }
  // DOMParser relocates template styles to <head>. Preserve non-duplicate styles.
  const styles = [...doc.head.querySelectorAll('style')].map(el => el.outerHTML).join('');
  return cardDocument({ ...card, [side]: styles + doc.body.innerHTML }, side, { theme: 'app' });
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
