import { cardDocument } from './study.mjs';

// Inert parsing only. Unknown templates keep their structure; the original view
// is always available. Neither presentation enables scripts in the card frame.
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

  // JP1K/mpvacious vocabulary cards: use existing fields, not guessed text or
  // question/answer heuristics that could accidentally reveal a cloze answer.
  const wrap = doc.body.querySelector(':scope > .wrap');
  if (wrap) {
    wrap.querySelectorAll(':scope > .sent-center').forEach(el => el.classList.add('am-prompt'));
    const headword = wrap.querySelector(':scope > .headword_section');
    if (side === 'answer' && headword) {
      const media = wrap.querySelector(':scope > details.images-details');
      const grid = doc.createElement('div');
      grid.className = 'am-answer-grid';
      headword.before(grid);
      grid.append(headword);
      if (media) {
        media.open = true;
        const toggle = doc.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = 'am-enlarge-image';
        toggle.className = 'am-image-toggle';
        toggle.setAttribute('aria-label', 'Enlarge card image');
        const label = doc.createElement('label');
        label.htmlFor = toggle.id;
        label.className = 'am-enlarge';
        label.innerHTML = '<span class="am-expand">Enlarge image</span><span class="am-collapse">Reduce image</span>';
        const images = media.querySelector('.images');
        if (images) images.before(toggle, label);
        grid.append(media);
      }
      // Anki hint anchors rely on disabled card scripts. On the revealed answer
      // only, show the translation directly rather than a non-working link.
      wrap.querySelectorAll(':scope > .sent-center .ensentence > a.hint').forEach(el => el.remove());
      wrap.querySelectorAll(':scope > .sent-center .ensentence > div.hint').forEach(el => el.style.removeProperty('display'));
      const footer = wrap.querySelector(':scope > footer');
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
  // DOMParser relocates template <style> tags to <head>; preserve those that
  // aren't duplicates of card.css, while keeping the original markup untouched.
  const styles = [...doc.head.querySelectorAll('style')].map(el => el.outerHTML).join('');
  return cardDocument({ ...card, [side]: styles + doc.body.innerHTML }, side, { theme: 'app' });
}
