import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { rubyNode } from './ruby.mjs';
import { typedKana } from './vn/challenge.mjs';
import { characterSvg } from './vn/defaultSkin.mjs';
import { createLessonRun, createMatchGame, exampleChunks, formulaChips, lessonSummaryLine, mulberry32, orderTiles, sectionSpans, shuffledPick, startablePoints, tutorLine } from './lessonModel.mjs';
import { doodle, withIcon } from '../lib/doodleIcons.mjs';

const button = (label, onclick, className = 'story-btn', props = {}) => h('button', { type: 'button', class: className, onclick, ...props }, label);
const MOODS = { good: 'smile', bad: 'sad', idle: 'neutral', cheer: 'surprised' };

// The "learn first" lesson that sits in front of a Genki story scene: words, patterns, then practice.
// `tutor` is the story character who guides it (any id; the drawn default pack covers unknown ones).
export function mountLesson(host, ctx, { data, tutor = { char: 'hana', color: '#7cc6b4' }, onExit, onStory }) {
  const api = ctx.api.story;
  const lesson = data.lesson;
  const items = { ...data.items };
  const furigana = ctx.settings?.showFurigana !== false;
  const rand = mulberry32((Date.now() ^ (lesson.lesson * 7919)) >>> 0);
  let run = createLessonRun(lesson);
  let disposed = false;
  let locked = false;
  let act = null;
  let saved = false;
  let cleanup = null;

  const barFill = h('div', { class: 'lesson-bar-fill' });
  const barTicks = h('div', { class: 'lesson-bar-ticks', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'lesson-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, barFill, barTicks);
  const xp = h('span', { class: 'lesson-pill lesson-xp', title: 'Experience earned in this lesson' });
  const streak = h('span', { class: 'lesson-pill lesson-streak', title: 'Answers in a row' });
  const body = h('main', { class: 'lesson-body' });
  const feedback = h('div', { class: 'lesson-feedback', role: 'status', 'aria-live': 'polite', hidden: true });
  const go = h('button', { type: 'button', class: 'story-btn primary lesson-go' });
  const avatar = h('div', { class: 'lesson-avatar', 'aria-hidden': 'true' });
  const bubble = h('p', { class: 'lesson-bubble', hidden: true });
  const root = h(
    'section',
    { class: 'lesson', 'aria-label': `Lesson ${lesson.lesson}: ${lesson.title}` },
    h('header', { class: 'lesson-top' }, button(doodle('close'), leave, 'lesson-close', { 'aria-label': 'Leave the lesson', title: 'Leave (Esc)' }), bar, xp, streak),
    body,
    h('footer', { class: 'lesson-foot' }, h('div', { class: 'lesson-tutor' }, avatar), h('div', { class: 'lesson-mid' }, bubble, feedback), go),
  );
  host.replaceChildren(root);
  document.addEventListener('keydown', onKey);
  go.addEventListener('click', () => act?.());
  setTutor('idle');
  render();

  return () => {
    disposed = true;
    cleanup?.();
    document.removeEventListener('keydown', onKey);
    window.speechSynthesis?.cancel?.();
    root.remove();
  };

  // ---- chrome ----

  function setTutor(mood, line = '') {
    avatar.innerHTML = characterSvg(tutor.char, MOODS[mood] ?? 'neutral', tutor.color);
    avatar.dataset.mood = mood;
    bubble.textContent = line;
    bubble.hidden = !line;
    avatar.classList.remove('hop');
    void avatar.offsetWidth;
    if (mood === 'good' || mood === 'cheer') avatar.classList.add('hop');
  }

  function setAction(label, handler, { disabled = false, tone = 'primary', hidden = false } = {}) {
    go.textContent = label;
    go.hidden = hidden;
    go.disabled = disabled;
    go.className = `story-btn ${tone} lesson-go`;
    act = disabled ? null : handler;
  }

  function drawChrome() {
    const { index, total } = run.progress();
    const percent = Math.round((Math.min(index, total) / total) * 100);
    barFill.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    const spans = sectionSpans(run.steps);
    fill(barTicks, spans.map((s) => h('span', { style: `left:${(s.from / (run.steps.length - 1)) * 100}%` }, s.label)));
    fill(xp, withIcon('bolt', String(run.stats.xp)));
    fill(streak, withIcon('flame', String(run.stats.streak)));
    streak.classList.toggle('hot', run.stats.streak >= 3);
  }

  function swap(node, kind) {
    body.className = `lesson-body kind-${kind}`;
    body.replaceChildren(node);
    body.scrollTop = 0;
    void body.offsetWidth;
    body.classList.add('enter');
  }

  function render() {
    if (disposed) return;
    cleanup?.();
    cleanup = null;
    locked = false;
    feedback.hidden = true;
    feedback.className = 'lesson-feedback';
    drawChrome();
    const step = run.step;
    if (step.kind === 'intro') return showIntro();
    if (step.kind === 'cards') return showCards(step);
    if (step.kind === 'match') return showMatch(step);
    if (step.kind === 'concept') return showConcept(step);
    if (step.kind === 'drill') return showDrill(step);
    return showDone();
  }

  function next() {
    run.advance();
    render();
  }

  // ---- steps ----

  function showIntro() {
    setTutor('cheer', 'Ready when you are!');
    swap(
      h('div', { class: 'lesson-intro' },
        h('span', { class: 'story-level' }, `Lesson ${lesson.lesson} · learn first`),
        h('h1', { lang: 'en' }, lesson.title),
        h('p', { class: 'lesson-hook' }, lesson.hook),
        h('ul', { class: 'lesson-goals' }, lesson.goals.map((g) => h('li', {}, g))),
        h('div', { class: 'lesson-facts' },
          h('span', {}, h('b', {}, String(lesson.vocab.length)), ' words'),
          h('span', {}, h('b', {}, String(lesson.points.length)), ' patterns'),
          h('span', {}, h('b', {}, String(lesson.drills.length)), ' exercises'),
          h('span', {}, 'about ', h('b', {}, String(lesson.minutes)), ' min')),
        h('p', { class: 'lesson-note' }, 'Nothing here counts as a review. It is a warm-up so the story scene feels easy.'),
      ),
      'intro',
    );
    setAction("Let's go", next);
  }

  function showCards(step) {
    setTutor('idle', 'Use the speaker for pronunciation, then check the meaning.');
    const revealed = new Set();
    const rows = step.words.map((word, i) => {
      const answerId = `lesson-word-answer-${lesson.lesson}-${step.round + 1}-${i + 1}`;
      const answer = h('span', { id: answerId, class: 'lesson-word-meaning', lang: 'en', hidden: true }, word.en);
      const check = button('Check meaning', toggleMeaning, 'lesson-word-reveal', { 'aria-expanded': 'false', 'aria-controls': answerId });
      const row = h('li', { class: 'lesson-word-entry' },
        h('span', { class: 'lesson-word-number', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'lesson-word-copy' },
          h('span', { class: 'lesson-word-main', lang: 'ja' }, word.ja),
          word.reading !== word.ja ? h('span', { class: 'lesson-word-reading', lang: 'ja' }, word.reading) : null),
        h('div', { class: 'lesson-word-study' }, check, answer),
        button(doodle('sound'), () => ctx.speak?.(word.reading || word.ja), 'lesson-word-speak', { 'aria-label': `Hear ${word.ja}` }));

      function toggleMeaning() {
        const show = answer.hidden;
        answer.hidden = !show;
        check.setAttribute('aria-expanded', String(show));
        check.textContent = show ? 'Hide answer' : 'Check meaning';
        if (show && !revealed.has(i)) {
          revealed.add(i);
          ctx.speak?.(word.reading || word.ja);
          if (revealed.size === step.words.length) {
            setTutor('good', 'You studied every word!');
            go.classList.add('pulse');
          }
        }
      }

      return row;
    });
    swap(
      h('section', { class: 'lesson-vocab-sheet', 'aria-labelledby': 'lesson-vocab-title' },
        h('header', { class: 'lesson-vocab-head' },
          h('div', {},
            h('span', { class: 'story-level' }, `Lesson ${lesson.lesson} · Vocabulary`),
            h('h2', { id: 'lesson-vocab-title' }, `New words ${step.round + 1}`)),
          h('span', { class: 'lesson-vocab-page', 'aria-label': `Vocabulary set ${step.round + 1}` }, String(step.round + 1).padStart(2, '0'))),
        h('p', { class: 'lesson-sub' }, 'Say each word aloud. Try to recall its meaning before checking.'),
        h('div', { class: 'lesson-vocab-labels', 'aria-hidden': 'true' },
          h('span', {}, 'No.'), h('span', {}, 'Word'), h('span', {}, 'Meaning'), h('span', {}, 'Listen')),
        h('ol', { class: 'lesson-word-list' }, rows)),
      'cards',
    );
    setAction('Next', () => {
      run.sawWords(step.words.length);
      next();
    });
  }

  function showMatch(step) {
    setTutor('idle', 'Match each word with its meaning.');
    const game = createMatchGame(step.words, rand);
    const leftEls = game.left.map((item, i) => h('button', { type: 'button', class: 'lesson-tile', lang: 'ja', onclick: () => pick('left', i) }, item.text, h('small', {}, item.hint)));
    const rightEls = game.right.map((item, i) => h('button', { type: 'button', class: 'lesson-tile', onclick: () => pick('right', i) }, item.text));
    const els = { left: leftEls, right: rightEls };
    const status = h('p', { class: 'lesson-sub', role: 'status', 'aria-live': 'polite' }, 'Tap one on the left, then its meaning on the right.');
    swap(h('div', { class: 'lesson-match' }, h('h2', {}, 'Match-up'), status, h('div', { class: 'lesson-match-grid' }, h('div', { class: 'col' }, leftEls), h('div', { class: 'col' }, rightEls))), 'match');
    setAction('Continue', () => {
      run.finishMatch(game.misses);
      next();
    }, { disabled: true });
    let busy = false;
    function paintPending() {
      for (const side of ['left', 'right']) els[side].forEach((el, i) => el.classList.toggle('pending', game.pending?.side === side && game.pending.index === i));
    }
    function pick(side, index) {
      if (busy) return;
      const out = game.pick(side, index);
      if (out.type === 'ignored') return;
      if (out.type === 'pending') {
        paintPending();
        ctx.speak?.(side === 'left' ? game.left[index].hint || game.left[index].text : '');
        return;
      }
      if (out.type === 'match') {
        for (const s of ['left', 'right']) els[s].forEach((el, i) => {
          if ((s === 'left' ? game.left : game.right)[i].id === out.id) {
            el.classList.remove('pending');
            el.classList.add('matched');
            el.disabled = true;
          }
        });
        paintPending();
        if (out.done) {
          const clean = game.misses === 0;
          setTutor(clean ? 'cheer' : 'good', clean ? 'Perfect round!' : tutorLine('good', game.misses));
          status.textContent = clean ? 'All matched with no mistakes.' : `All matched. ${game.misses} slip${game.misses === 1 ? '' : 's'}.`;
          setAction('Continue', () => {
            run.finishMatch(game.misses);
            next();
          });
          go.classList.add('pulse');
        }
        return;
      }
      busy = true;
      const a = els[out.first.side][out.first.index];
      const b = els[out.second.side][out.second.index];
      a.classList.add('miss');
      b.classList.add('miss');
      setTutor('bad', 'Not that pair. Try another.');
      setTimeout(() => {
        a.classList.remove('miss', 'pending');
        b.classList.remove('miss', 'pending');
        busy = false;
        paintPending();
      }, 520);
    }
  }

  function showConcept(step) {
    const point = lesson.points[step.point];
    const state = items[point.id]?.state;
    setTutor('idle', point.gist);
    let exampleIndex = 0;
    let timers = [];
    const chunksEl = h('div', { class: 'lesson-chunks', lang: 'ja' });
    const enEl = h('p', { class: 'lesson-en', lang: 'en' });
    const dots = h('div', { class: 'lesson-dots', role: 'tablist', 'aria-label': 'Examples' });
    const count = h('span', { class: 'lesson-count' });

    function showExample(i) {
      timers.forEach(clearTimeout);
      timers = [];
      exampleIndex = (i + point.examples.length) % point.examples.length;
      const example = point.examples[exampleIndex];
      const chunks = exampleChunks(example);
      fill(chunksEl, chunks.map((chunk, c) => {
        const text = h('span', { class: 'ja' }, chunk.text);
        if (furigana) rubyNode(ctx.api.learn, chunk.text, { furigana }).then((node) => { if (!disposed && text.isConnected) text.replaceChildren(node); });
        return h('div', { class: 'lesson-chunk', 'data-tone': String(c % 4), style: `--i:${c}` }, text, chunk.gloss ? h('span', { class: 'gloss' }, chunk.gloss) : null);
      }));
      enEl.textContent = example.en;
      enEl.classList.remove('show');
      timers.push(setTimeout(() => enEl.classList.add('show'), 180 + chunks.length * 190));
      count.textContent = `${exampleIndex + 1} / ${point.examples.length}`;
      fill(dots, point.examples.map((_, d) => h('button', { type: 'button', class: `dot${d === exampleIndex ? ' on' : ''}`, role: 'tab', 'aria-selected': String(d === exampleIndex), 'aria-label': `Example ${d + 1}`, onclick: () => showExample(d) })));
    }

    const speakExample = () => ctx.speak?.(point.examples[exampleIndex].ja.replaceAll('|', ''));
    const adder = state === 'new'
      ? button('＋ Add to my reviews', () => attempt(async () => {
        const out = await api.learn(point.id);
        if (out.started) {
          items[point.id].state = 'started';
          adder.replaceWith(h('span', { class: 'lesson-added' }, withIcon('check', 'In your reviews')));
          toast(`${point.title} added to your reviews`);
        } else toast('Could not start this one yet', 'error');
      }), 'story-chip lesson-add', { title: 'Start this grammar point in your SRS reviews' })
      : state === 'started' ? h('span', { class: 'lesson-added' }, withIcon('check', 'In your reviews')) : null;

    swap(
      h('div', { class: 'lesson-concept' },
        h('div', { class: 'lesson-concept-head' },
          h('span', { class: 'story-level' }, `Pattern ${step.point + 1} of ${lesson.points.length}`),
          adder),
        h('h2', { class: 'lesson-title', lang: 'ja' }, point.title),
        h('div', { class: 'lesson-formula', lang: 'ja', 'aria-label': `Formula ${point.formula}` }, formulaChips(point.formula).map((c, i) => h('span', { class: `chip ${c.kind}`, style: `--i:${i}` }, c.text))),
        h('p', { class: 'lesson-gist' }, point.gist),
        h('div', { class: 'lesson-explain' }, point.explain.map((p) => h('p', {}, p))),
        h('section', { class: 'lesson-theater', 'aria-label': 'Examples' },
          h('div', { class: 'lesson-theater-top' }, h('span', { class: 'story-level' }, 'Watch it work'), count),
          chunksEl,
          enEl,
          h('div', { class: 'lesson-theater-controls' },
            button(doodle('back'), () => showExample(exampleIndex - 1), 'story-chip', { 'aria-label': 'Previous example' }),
            dots,
            button(doodle('next'), () => showExample(exampleIndex + 1), 'story-chip', { 'aria-label': 'Next example' }),
            button(doodle('sound'), speakExample, 'story-chip', { 'aria-label': 'Hear it' }),
            button(doodle('replay'), () => showExample(exampleIndex), 'story-chip', { 'aria-label': 'Replay animation' }))),
        point.tip ? h('p', { class: 'lesson-callout tip' }, h('b', {}, withIcon('bulb', 'Tip')), point.tip) : null,
        point.watch ? h('p', { class: 'lesson-callout watch' }, h('b', {}, withIcon('warn', 'Watch out')), point.watch) : null,
      ),
      'concept',
    );
    showExample(0);
    cleanup = () => timers.forEach(clearTimeout);
    setAction('Try it', next);
  }

  // ---- exercises ----

  function showDrill(step) {
    const drill = step.drill;
    setTutor(step.retry ? 'cheer' : 'idle', step.retry ? 'Second chance. You can do this!' : '');
    const head = h('div', { class: 'lesson-drill-head' },
      h('span', { class: 'story-level' }, step.retry ? 'Second chance' : { gap: 'Fill the gap', pick: 'Pick the answer', order: 'Build the sentence', type: 'Type it' }[drill.type]),
      step.retry ? h('span', { class: 'lesson-retry' }, 'missed earlier') : null);
    const finish = (result, reveal) => {
      locked = true;
      reveal?.(result);
      const word = result.ok ? tutorLine('good', run.stats.streak) : tutorLine('bad', run.stats.retries);
      setTutor(result.ok ? 'good' : 'bad', word);
      bubble.hidden = true;
      feedback.hidden = false;
      feedback.className = `lesson-feedback ${result.ok ? 'ok' : 'bad'}`;
      fill(feedback, h('strong', {}, result.ok ? withIcon('check', word) : withIcon('close', `Answer: ${result.expected}`)), drill.why ? h('p', {}, drill.why) : null);
      drawChrome();
      setAction('Continue', next, { tone: result.ok ? 'primary ok' : 'primary bad' });
      go.focus();
    };
    const grade = (answer, reveal) => {
      if (locked) return;
      finish(run.answerDrill(step, answer), reveal);
    };

    if (drill.type === 'gap') {
      const [before, after] = drill.ja.split('＿');
      const options = drill.options;
      const gap = h('span', { class: 'lesson-gap', 'aria-label': 'missing word' }, '？');
      const buttons = options.map((text, i) => h('button', { type: 'button', class: 'lesson-option', lang: 'ja', onclick: () => choose(i) }, h('kbd', {}, String(i + 1)), text));
      const choose = (i) => grade(options[i], (result) => {
        gap.textContent = drill.answer;
        gap.classList.add(result.ok ? 'ok' : 'bad');
        buttons.forEach((b, j) => b.classList.add(options[j] === drill.answer ? 'right' : j === i ? 'wrong' : 'dim'));
        buttons.forEach((b) => { b.disabled = true; });
      });
      swap(h('div', { class: 'lesson-drill' }, head, h('p', { class: 'lesson-sentence', lang: 'ja' }, before, gap, after), h('p', { class: 'lesson-en', lang: 'en' }, drill.en), h('div', { class: 'lesson-options row' }, buttons)), 'drill');
      setAction('Check', () => {}, { disabled: true, hidden: true });
      cleanup = registerChoices(buttons, choose);
    } else if (drill.type === 'pick') {
      const { options, answer } = shuffledPick(drill, rand);
      const buttons = options.map((text, i) => h('button', { type: 'button', class: 'lesson-option', onclick: () => choose(i) }, h('kbd', {}, String(i + 1)), h('span', { lang: /[ぁ-んァ-ヶ一-龠]/.test(text) ? 'ja' : 'en' }, text)));
      const choose = (i) => grade(i === answer ? drill.answer : -1, () => {
        buttons.forEach((b, j) => { b.classList.add(j === answer ? 'right' : j === i ? 'wrong' : 'dim'); b.disabled = true; });
      });
      swap(h('div', { class: 'lesson-drill' }, head, h('p', { class: 'lesson-question' }, drill.q), h('div', { class: 'lesson-options' }, buttons)), 'drill');
      setAction('Check', () => {}, { disabled: true, hidden: true });
      cleanup = registerChoices(buttons, choose);
    } else if (drill.type === 'order') {
      const tiles = orderTiles(drill, rand);
      const placed = [];
      const line = h('div', { class: 'lesson-answer-line', lang: 'ja', 'aria-label': 'Your sentence' });
      const bank = h('div', { class: 'lesson-bank', lang: 'ja' });
      const draw = () => {
        fill(line, placed.length ? placed.map((t, i) => h('button', { type: 'button', class: 'lesson-tile placed', onclick: () => { if (!locked) { placed.splice(i, 1); draw(); } } }, t)) : h('span', { class: 'hint' }, 'Tap the pieces in order'));
        fill(bank, tiles.map((t) => h('button', { type: 'button', class: 'lesson-tile', disabled: placed.includes(t) ? true : null, onclick: () => { if (!locked && !placed.includes(t)) { placed.push(t); draw(); } } }, t)));
        if (!locked) setAction('Check', () => grade([...placed], (result) => { line.classList.add(result.ok ? 'ok' : 'bad'); bank.classList.add('dim'); }), { disabled: placed.length < drill.chunks.length });
      };
      swap(h('div', { class: 'lesson-drill' }, head, h('p', { class: 'lesson-question', lang: 'en' }, drill.en), line, bank), 'drill');
      draw();
    } else {
      const input = h('input', { class: 'story-input lesson-input', type: 'text', lang: 'ja', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Type in kana (romaji works too)', 'aria-label': 'Answer in kana',
        oninput: (event) => { event.target.value = typedKana(event.target.value); if (!locked) setAction('Check', submit, { disabled: input.value.trim() === '' }); },
        onkeydown: (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          if (locked) next();
          else if (input.value.trim()) submit();
        } });
      const submit = () => grade(typedKana(input.value, { final: true }), (result) => { input.classList.add(result.ok ? 'ok' : 'bad'); input.readOnly = true; });
      swap(h('div', { class: 'lesson-drill' }, head, h('p', { class: 'lesson-question' }, drill.prompt), drill.show ? h('p', { class: 'lesson-show', lang: 'ja' }, drill.show) : null, input), 'drill');
      setAction('Check', submit, { disabled: true });
      queueMicrotask(() => input.focus());
    }
  }

  // Number keys choose options; returns the listener cleanup.
  function registerChoices(buttons, choose) {
    const handler = (event) => {
      const n = Number(event.key);
      if (locked || !Number.isInteger(n) || n < 1 || n > buttons.length) return;
      if (event.target?.closest?.('input, textarea')) return;
      choose(n - 1);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }

  // ---- finish ----

  function showDone() {
    const summary = lessonSummaryLine(run);
    const startable = startablePoints(lesson, items);
    setTutor('cheer', 'Lesson complete! Now the story will feel familiar.');
    drawChrome();
    if (!saved) {
      saved = true;
      api.lessonDone({ id: lesson.id, accuracy: run.accuracy() }).catch((err) => toast(err.message, 'error'));
    }
    const confetti = h('div', { class: 'lesson-confetti', 'aria-hidden': 'true' }, Array.from({ length: 28 }, (_, i) => h('i', { style: `--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--r:${(i * 53) % 360}deg;--c:${i % 5}` })));
    const reviewButtons = startable.map((point) => {
      const btn = button(`＋ ${point.title}`, () => attempt(async () => {
        const out = await api.learn(point.id);
        if (out.started) {
          items[point.id].state = 'started';
          fill(btn, withIcon('check', point.title));
          btn.disabled = true;
          toast(`${point.title} added to your reviews`);
        }
      }), 'story-chip', { lang: 'ja' });
      return btn;
    });
    swap(
      h('div', { class: 'lesson-done' },
        confetti,
        h('span', { class: 'story-level' }, 'Lesson complete'),
        h('h1', {}, lesson.title, ' ', doodle('check')),
        h('div', { class: 'lesson-results' },
          h('div', {}, h('b', {}, String(summary.words)), h('span', {}, 'words met')),
          h('div', {}, h('b', {}, String(lesson.points.length)), h('span', {}, 'patterns')),
          h('div', {}, h('b', {}, `${summary.accuracy}%`), h('span', {}, 'first-try')),
          h('div', {}, h('b', {}, String(summary.xp)), h('span', {}, 'XP'))),
        summary.bestStreak >= 3 ? h('p', { class: 'lesson-sub' }, withIcon('flame', `Best streak: ${summary.bestStreak} in a row`)) : null,
        reviewButtons.length ? h('div', { class: 'lesson-review' }, h('p', { class: 'lesson-sub' }, 'Want these in your spaced-repetition reviews?'), h('div', { class: 'story-card-actions' }, reviewButtons)) : null,
        h('div', { class: 'story-card-actions lesson-done-actions' },
          button('Practice again', () => { run = createLessonRun(lesson); saved = false; render(); }, 'story-btn'),
          button('Back to Story', onExit, 'story-btn')),
      ),
      'done',
    );
    setAction('Start the story', onStory);
    go.classList.add('pulse');
  }

  function leave() {
    if (run.finished || run.index === 0 || window.confirm('Leave this lesson? Your progress in it will be lost.')) onExit();
  }

  function onKey(event) {
    if (disposed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      leave();
    } else if (event.key === 'Enter' && !event.target?.closest?.('input, textarea, button, [role="button"]')) {
      if (act && !go.disabled) {
        event.preventDefault();
        act();
      }
    }
  }
}
