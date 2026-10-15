import { attempt, h, toast } from '../lib/ui.mjs';
import { clozeToText } from '../lib/learnView.mjs';
import { rubyNode } from './ruby.mjs';
import { canSpeak, speak } from './speak.mjs';

const JOIN = ' / ';

function block(title, ...children) {
  return h('section', { class: 'learn-cv-block' }, h('h3', {}, title), ...children);
}

function chip(label, onclick) {
  return h('button', { type: 'button', class: 'learn-cv-chip', onclick }, label);
}

function plainChip(label) {
  return h('span', { class: 'learn-cv-chip learn-cv-chip-static' }, label);
}

function rubySlot(ctx, text, opts) {
  const slot = h('span', { class: 'learn-ruby' }, text);
  rubyNode(ctx.api.learn, text, { furigana: ctx.settings?.showFurigana !== false, ...opts }).then((node) => slot.replaceChildren(...node.childNodes));
  return slot;
}

function speakButton(text) {
  if (!canSpeak()) return null;
  return h('button', { type: 'button', class: 'learn-cv-speak', 'aria-label': 'Speak', onclick: () => speak(text) }, 'Speak');
}

function sentenceRow(ctx, ja, en) {
  return h(
    'li',
    { class: 'learn-cv-sentence' },
    h('div', { class: 'learn-cv-ja' }, rubySlot(ctx, ja), speakButton(ja)),
    en ? h('div', { class: 'learn-cv-en' }, en) : null,
  );
}

function notesOf(card) {
  return card.notes ?? { meaning: '', reading: '', mnemonic: '' };
}

function editPanel(card, ctx, onChange) {
  const notes = notesOf(card);
  const synonyms = h('input', { type: 'text', value: (card.synonyms ?? []).join(', '), placeholder: 'Comma separated' });
  const meaning = h('textarea', { rows: 2, value: notes.meaning });
  const reading = h('textarea', { rows: 2, value: notes.reading });
  const mnemonic = h('textarea', { rows: 4, value: notes.mnemonic });

  const askAi = h('button', {
    type: 'button',
    class: 'learn-cv-btn',
    onclick: () =>
      attempt(async () => {
        mnemonic.value = await ctx.api.learn.mnemonic(card.id);
      }),
  }, 'Ask AI');

  const save = h('button', {
    type: 'button',
    class: 'learn-cv-btn learn-cv-primary',
    onclick: () =>
      attempt(async () => {
        const patch = {
          synonyms: synonyms.value.split(',').map((s) => s.trim()).filter(Boolean),
          meaning: meaning.value,
          reading: reading.value,
          mnemonic: mnemonic.value,
        };
        const updated = await ctx.api.learn.setUserData({ id: card.id, patch });
        toast('Saved', 'info');
        onChange?.(updated);
      }),
  }, 'Save');

  return block(
    'Your notes',
    h('label', { class: 'learn-cv-field' }, 'Synonyms', synonyms),
    h('label', { class: 'learn-cv-field' }, 'Meaning note', meaning),
    h('label', { class: 'learn-cv-field' }, 'Reading note', reading),
    h('label', { class: 'learn-cv-field' }, 'Mnemonic', mnemonic),
    h('div', { class: 'learn-cv-actions' }, askAi, save),
  );
}

function componentsBlock(card, ctx) {
  if (!card.components?.length) return null;
  return block(
    'Components',
    h(
      'div',
      { class: 'learn-cv-chips' },
      card.components.map((c) => chip(`${c.char} ${c.name}`, () => ctx.go('item', c.id))),
    ),
  );
}

function vocabBlock(card, ctx) {
  if (!card.vocab?.length) return null;
  return block(
    'Vocabulary with this kanji',
    h(
      'div',
      { class: 'learn-cv-chips' },
      card.vocab.map((v) => chip(`${v.word}  ${v.meaning}`, () => ctx.go('item', v.id))),
    ),
  );
}

function sentencesBlock(card, ctx) {
  if (!card.sentences?.length) return null;
  return block('Sentences', h('ul', { class: 'learn-cv-sentences' }, card.sentences.map((s) => sentenceRow(ctx, s.ja, s.en))));
}

function wordHeader(card, ctx) {
  const word = card.char ?? card.word;
  const glyph = card.kind === 'vocab' || card.kind === 'custom' ? rubySlot(ctx, word) : h('span', { class: 'learn-cv-glyph' }, word);
  return h(
    'header',
    { class: 'learn-cv-head' },
    glyph,
    h('div', { class: 'learn-cv-meanings' }, (card.meanings ?? []).join(JOIN)),
    card.readingText ? h('div', { class: 'learn-cv-readings' }, card.readingText) : null,
  );
}

function kanjiLike(card, ctx, { compact, onChange }) {
  return h(
    'div',
    { class: 'learn-cardview' },
    wordHeader(card, ctx),
    card.hint ? block('Hint', h('p', { class: 'learn-cv-hint' }, card.hint)) : null,
    componentsBlock(card, ctx),
    vocabBlock(card, ctx),
    sentencesBlock(card, ctx),
    compact ? null : editPanel(card, ctx, onChange),
  );
}

function animeExample(ctx, ex) {
  const before = ex.text.slice(0, ex.matchStart);
  const hit = ex.text.slice(ex.matchStart, ex.matchEnd);
  const after = ex.text.slice(ex.matchEnd);
  return h(
    'li',
    { class: 'learn-cv-sentence' },
    h('div', { class: 'learn-cv-ja' }, before, h('mark', {}, hit), after),
    h('button', {
      type: 'button',
      class: 'learn-cv-btn',
      onclick: () => ctx.watch({ videoPath: ex.videoPath, start: ex.start }),
    }, 'Watch'),
  );
}

function grammarExample(ctx, ex) {
  const en = h('div', { class: 'learn-cv-en', hidden: true }, ex.en ?? '');
  const toggle = h('button', {
    type: 'button',
    class: 'learn-cv-btn',
    onclick: () => {
      en.hidden = !en.hidden;
    },
  }, 'English');
  return h(
    'li',
    { class: 'learn-cv-sentence' },
    h('div', { class: 'learn-cv-ja' }, rubySlot(ctx, ex.ja), speakButton(ex.ja), toggle),
    ex.hint ? h('div', { class: 'learn-cv-hint' }, ex.hint) : null,
    en,
  );
}

function grammarView(card, ctx) {
  const similar = card.similar ?? [];
  return h(
    'div',
    { class: 'learn-cardview' },
    h(
      'header',
      { class: 'learn-cv-head' },
      h('h2', { class: 'learn-cv-title' }, rubySlot(ctx, card.title)),
      h('div', { class: 'learn-cv-chips' }, plainChip(card.jlpt), plainChip(card.formality)),
      h('div', { class: 'learn-cv-meanings' }, card.meaning),
    ),
    block('Structure', h('p', {}, card.structure)),
    card.notes ? block('Notes', h('p', { class: 'learn-cv-notes' }, card.notes)) : null,
    card.examples?.length
      ? block('Examples', h('ul', { class: 'learn-cv-sentences' }, card.examples.map((ex) => grammarExample(ctx, ex))))
      : null,
    card.animeExamples?.length
      ? block('From your anime', h('ul', { class: 'learn-cv-sentences' }, card.animeExamples.map((ex) => animeExample(ctx, ex))))
      : null,
    similar.length
      ? block(
          'Similar points',
          h(
            'div',
            { class: 'learn-cv-chips' },
            similar.map((s) => (s.id ? chip(s.title, () => ctx.go('point', s.id)) : plainChip(s.title))),
          ),
        )
      : null,
  );
}

export function renderCard(card, ctx, { compact = false, onChange } = {}) {
  if (card.kind === 'grammar') return grammarView(card, ctx);
  return kanjiLike(card, ctx, { compact, onChange });
}
