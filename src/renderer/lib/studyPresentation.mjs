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

  // AJT versions nest the prompt and ship two modes plus a FrontSide copy.
  // Resolve the active, current-side sentence rather than relying on a direct child.
  doc.querySelectorAll('.jpsentence:has(> .overlay)').forEach(el => {
    const overlay = el.querySelector(':scope > .overlay');
    el.replaceChildren(...overlay.childNodes);
  });
  const wrap = doc.body.querySelector('.wrap');
  const native = doc.body.querySelector(':scope > .card-wrap');
  const candidates = [...(wrap?.querySelectorAll('.sent-center:has(.jpsentence)') ?? [])]
    .filter(el => !el.closest('.fside'));
  const prompt = candidates.find(el => el.getAttribute('visible') === 'true')
    ?? candidates.find(el => el.getAttribute('visible') !== 'false')
    ?? candidates[0] ?? native?.querySelector(':scope > .sentence');
  if (prompt) {
    const root = wrap ?? native;
    root.classList.add('am-spotlight');
    if (wrap) root.classList.add('am-ajt');
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
      return copy.textContent.replace(/\s+/g, '');
    };
    wrap?.querySelectorAll('.jpsentence').forEach(jp => {
      if (jp === sentence || sentenceText(jp) !== sentenceText(sentence)) return;
      // Remove only the duplicate sentence, not its translation or media siblings.
      const block = jp.closest('.sent-center');
      jp.remove();
      block?.querySelectorAll('.toggle_furigana_button').forEach(el => el.remove());
      if (block && !block.textContent.trim() && !block.querySelector('img, audio, video')) block.remove();
    });
    // FrontSide headers are template chrome. Media is removed only when its
    // exact source is already retained on this side; unique images and text stay.
    wrap?.querySelectorAll('.fside header').forEach(el => el.remove());
    const frontSources = new Set([...(wrap?.querySelectorAll('.fside .images-details img') ?? [])]
      .map(img => img.getAttribute('src')).filter(Boolean));
    const retainedSources = new Set([...(wrap?.querySelectorAll('details.images-details img') ?? [])]
      .filter(img => !img.closest('.fside'))
      .map(img => img.getAttribute('src')).filter(Boolean));
    wrap?.querySelectorAll('.fside .images-details').forEach(details => {
      details.querySelectorAll('img').forEach(img => {
        if (retainedSources.has(img.getAttribute('src'))) img.remove();
      });
      details.querySelectorAll('.images').forEach(images => {
        if (!images.textContent.trim() && !images.children.length) images.remove();
      });
      const content = details.cloneNode(true);
      content.querySelectorAll('summary').forEach(el => el.remove());
      if (!content.textContent.trim() && !content.querySelector('*')) details.remove();
    });

    const media = [...(wrap?.querySelectorAll('details.images-details:has(img)') ?? [])]
      .find(el => !el.closest('.fside'))
      ?? native?.querySelector(':scope > .pic:has(img)');
    const scene = media ? sceneRegion(doc, media) : null;
    // Any additional unique images remain in context, without native Image chrome.
    wrap?.querySelectorAll('details.images-details').forEach(details => {
      if (scene?.contains(details)) return;
      details.querySelector(':scope > summary')?.remove();
      const figure = doc.createElement('figure');
      figure.className = 'am-extra-images';
      figure.append(...details.childNodes);
      details.replaceWith(figure);
    });
    const tags = tagChips(doc, root);

    if (side === 'answer') {
      const answer = doc.createElement('section');
      answer.className = 'am-answer-grid';
      answer.setAttribute('aria-label', 'Revealed answer');
      const headword = wrap?.querySelector('.headword_section');
      if (headword) {
        const pitch = headword.querySelector('#pitchpattern');
        if (pitch) {
          pitch.classList.add('am-pitch');
          pitch.querySelectorAll('[style]').forEach(el => {
            const shadow = el.style.boxShadow;
            el.removeAttribute('style');
            if (shadow) el.style.boxShadow = shadow.replace(/red|#[0-9a-f]{3,8}|rgb\([^)]*\)/gi, '#0a0a0a');
          });
          headword.prepend(pitch);
        }
        headword.querySelectorAll('#pitchnum, #vocab-audio, #sent-audio').forEach(el => el.remove());
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
      let links;
      if (footer) {
        // Only this matched template's footer separator is chrome.
        if (footer.previousElementSibling?.matches('hr')) footer.previousElementSibling.remove();
        const meaningful = [...footer.querySelectorAll('a[href]')].filter(link => {
          const href = link.getAttribute('href').trim();
          return href && !/^(#|javascript:)/i.test(href) && (link.textContent.trim() || link.getAttribute('aria-label'));
        });
        if (meaningful.length) {
          links = doc.createElement('nav');
          links.className = 'am-card-links';
          links.setAttribute('aria-label', 'Card resources');
          links.append(...meaningful);
        }
        footer.remove();
      }
      for (const source of root.querySelectorAll('.source, .notes')) source.classList.add('am-source');
      if (scene) {
        // The answer's FrontSide proves this scene is already visible in the
        // front pane. Keep its media identity, without showing a second copy.
        const images = [...scene.querySelectorAll('img')];
        if (images.length && images.every(img => frontSources.has(img.getAttribute('src')))) {
          scene.hidden = true;
          scene.classList.add('am-front-scene');
        }
        root.append(scene);
      }
      if (links) root.append(links);
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
  const sources = [...(root?.querySelectorAll('header .tags') ?? [])];
  if (!sources.length) {
    const source = root?.querySelector(':scope > .tags');
    if (source) sources.push(source);
  }
  const words = [...new Set(sources.flatMap(el => el.textContent.split(/\s+/)))]
    .filter(word => word && word.toLowerCase() !== 'jp1k');
  for (const source of sources) {
    const header = source.closest('header');
    source.remove();
    if (header && !header.textContent.trim() && !header.querySelector('img, audio, video')) header.remove();
  }
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
  media.before(scene);
  scene.append(toggle, control, imageLabel);
  imageLabel.append(images);
  if (!media.matches('.pic')) {
    // Replace disclosure chrome with a figure, retaining non-image siblings too.
    media.querySelector(':scope > summary')?.remove();
    scene.append(...media.childNodes);
  }
  if (!media.matches('.pic')) media.remove();
  return scene;
}
