import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { progressBar, runPackDownload } from './home.mjs';

const REVIEW_ORDERS = [
  ['random', 'Random'],
  ['lowestStageFirst', 'Lowest stage first'],
  ['levelAscending', 'Lowest level first'],
];

const MAX_LEVEL = 60;

function field(label, control, hint = '') {
  return h('label', { class: 'learn-field' }, h('span', {}, label), control, hint ? h('span', { class: 'learn-hint' }, hint) : null);
}

function toggle(control, text) {
  return h('label', { class: 'learn-switch' }, control, h('span', {}, text));
}

function integerInput(value, min, max) {
  return h('input', { type: 'number', min, max, step: 1, value });
}

export function mountLearnSettings(el, ctx) {
  const { api } = ctx;
  const body = h('div', { class: 'learn-settings' });
  el.append(body);
  let disposed = false;

  render();

  return () => {
    disposed = true;
  };

  function render() {
    const s = ctx.settings;
    const batch = integerInput(s.lessonBatch, 1, 50);
    const limit = integerInput(s.dailyLessonLimit, 0, 200);
    const order = h(
      'select',
      {},
      REVIEW_ORDERS.map(([value, label]) => h('option', { value }, label)),
    );
    order.value = s.reviewOrder;
    const autoAdd = h('input', { type: 'checkbox', checked: s.autoAddMined ? true : null });
    const anime = h('input', { type: 'checkbox', checked: s.preferAnimeSentences ? true : null });
    const furigana = h('input', { type: 'checkbox', checked: s.showFurigana ? true : null });
    const english = h('input', { type: 'checkbox', checked: s.showEnglish ? true : null });
    const lightning = h('input', { type: 'checkbox', checked: ctx.prefs.get('lightningMode', false) ? true : null });
    const speak = h('input', { type: 'checkbox', checked: ctx.prefs.get('autoSpeak', false) ? true : null });

    const save = h('button', {
      type: 'submit',
      class: 'learn-btn primary',
    }, 'Save');
    const form = h(
      'form',
      {
        class: 'learn-card',
        onsubmit: (event) => {
          event.preventDefault();
          save.disabled = true;
          attempt(async () => {
            try {
              const lessonBatch = Number(batch.value);
              const dailyLessonLimit = Number(limit.value);
              if (!Number.isInteger(lessonBatch) || lessonBatch < 1 || lessonBatch > 50) {
                throw new Error('Lesson batch must be a whole number from 1 to 50.');
              }
              if (!Number.isInteger(dailyLessonLimit) || dailyLessonLimit < 0 || dailyLessonLimit > 200) {
                throw new Error('Daily lesson limit must be a whole number from 0 to 200.');
              }
              await api.learn.settingsSet({
                lessonBatch,
                dailyLessonLimit,
                reviewOrder: order.value,
                autoAddMined: autoAdd.checked,
                preferAnimeSentences: anime.checked,
                showFurigana: furigana.checked,
                showEnglish: english.checked,
              });
              ctx.prefs.set('lightningMode', lightning.checked);
              ctx.prefs.set('autoSpeak', speak.checked);
              await ctx.reloadSettings();
              toast('Learn settings saved', 'info');
            } finally {
              save.disabled = false;
            }
          });
        },
      },
      h('h2', {}, 'Lessons & reviews'),
      field('Lesson batch size', batch, '1–50 items per lesson session.'),
      field('Daily lesson limit', limit, '0–200. 0 means no limit.'),
      field('Review order', order),
      h('h2', {}, 'Mining & anime'),
      toggle(autoAdd, 'Add mined words to Learn automatically'),
      toggle(anime, 'Prefer sentences from anime when available'),
      toggle(furigana, 'Show furigana'),
      toggle(english, 'Show English translations'),
      h('h2', {}, 'This device'),
      toggle(lightning, 'Lightning mode: advance automatically after a correct answer'),
      toggle(speak, 'Speak Japanese automatically'),
      save,
    );

    fill(body, form, dataSection(), resetSection());
  }

  function dataSection() {
    let bar = progressBar(0);
    const button = h('button', { type: 'button', class: 'learn-btn' }, 'Re-download data');
    button.addEventListener('click', () => {
      button.disabled = true;
      attempt(async () => {
        try {
          await runPackDownload(api, (fraction) => bar.replaceWith((bar = progressBar(fraction))));
          toast('Kanji & vocab data downloaded', 'info');
        } finally {
          button.disabled = false;
        }
      });
    });
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'Data'),
      h('p', { class: 'learn-sub' }, 'Rebuilds the kanji & vocab data from the open KANJIDIC2, JMdict and Tatoeba sources.'),
      button,
      bar,
    );
  }

  function resetSection() {
    const level = h('input', { type: 'number', min: 1, max: MAX_LEVEL, step: 1, value: 1 });
    const button = h('button', { type: 'button', class: 'learn-btn danger' }, 'Reset to level…');
    button.addEventListener('click', () => {
      const n = Number(level.value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LEVEL) {
        toast(`Level must be a whole number from 1 to ${MAX_LEVEL}.`, 'error');
        return;
      }
      if (!confirm(`Reset kanji & vocab progress above level ${n}? This cannot be undone.`)) return;
      attempt(async () => {
        await api.learn.resetLevel(n);
        toast(`Reset to level ${n}`, 'info');
      });
    });
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'Reset progress'),
      h(
        'p',
        { class: 'learn-sub' },
        'Reset removes kanji/vocab progress above that level; grammar is untouched.',
      ),
      field('Reset to level', level),
      button,
    );
  }
}
