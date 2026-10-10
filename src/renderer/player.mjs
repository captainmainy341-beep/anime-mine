import { findCueIndex, neighborIndex } from './lib/cues.mjs';
import { tokenizeCached } from './lib/nlp.mjs';
import { toSegments } from './lib/segments.mjs';
import { attempt, fill, h, toast } from './lib/ui.mjs';
import { createPopup } from './popup.mjs';

const api = window.api;

const pad = (n) => String(n).padStart(2, '0');

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

function fileUrl(path) {
  return `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`;
}

function overlayNodes(segments, index, openWord) {
  return segments.map((seg) =>
    seg.token ? h('span', { class: 'word', tabindex: 0, onclick: () => openWord(index, seg.token) }, seg.text) : seg.text,
  );
}

export function mountPlayer(container, episode, { onBack, onOpenSettings }) {
  let cues = [];
  let rows = [];
  let activeIndex = -1;
  let overlaySeq = 0;
  let subsOn = true;

  const video = h('video', { src: fileUrl(episode.path), controls: true, preload: 'metadata' });
  const overlay = h('div', { class: 'subtitle-overlay' });
  const codecError = h(
    'div',
    { class: 'video-error', hidden: true },
    "This video's codec isn't supported by the built-in player.",
  );
  const noSubs = h(
    'div',
    { class: 'nosubs', hidden: true },
    h('span', {}, 'No subtitles linked for this episode.'),
    h('button', { class: 'primary small', onclick: linkSubtitle }, 'Link subtitle'),
  );
  const cueList = h('ol', { class: 'cue-list' });
  const ankiChip = h('span', { class: 'chip' }, 'Anki…');
  const subsButton = h('button', { class: 'ghost small', onclick: toggleSubs }, 'Subtitles on');
  const popupSlot = h('div', { class: 'popup-slot', hidden: true });
  const popup = createPopup(popupSlot, { videoPath: episode.path, onOpenSettings, onMined: refreshAnki });

  const keyActions = {
    ' ': togglePlay,
    arrowleft: () => step(-1),
    a: () => step(-1),
    arrowright: () => step(1),
    d: () => step(1),
    r: replay,
    escape: () => popup.close(),
  };

  function onKey(e) {
    const action = keyActions[e.key.toLowerCase()];
    if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    action();
  }

  container.append(
    h(
      'section',
      { class: 'player' },
      h(
        'header',
        { class: 'player-head' },
        h('button', { class: 'ghost small', onclick: onBack }, '← Library'),
        h('h2', { class: 'player-title', title: episode.name }, episode.name),
        ankiChip,
        subsButton,
      ),
      h(
        'div',
        { class: 'player-body' },
        h(
          'div',
          { class: 'stage' },
          h('div', { class: 'video-wrap' }, video, overlay, codecError),
          noSubs,
          h('p', { class: 'keys' }, 'Space play/pause · ←/→ previous/next line · R replay line · Esc close'),
        ),
        h('aside', { class: 'sidebar' }, popupSlot, cueList),
      ),
    ),
  );

  video.addEventListener('timeupdate', syncActive);
  video.addEventListener('seeked', syncActive);
  video.addEventListener('play', () => popup.close());
  video.addEventListener('error', () => {
    codecError.hidden = false;
  });
  document.addEventListener('keydown', onKey);

  loadCues();
  refreshAnki();

  return () => {
    document.removeEventListener('keydown', onKey);
    video.pause();
    video.removeAttribute('src');
    video.load();
    popup.close();
  };

  function togglePlay() {
    if (video.paused) play();
    else video.pause();
  }

  function play() {
    // Playback failures surface through the video element's error event.
    video.play().catch(() => {});
  }

  function step(dir) {
    const index = neighborIndex(cues, video.currentTime, dir);
    if (index < 0) return;
    seekTo(index);
    play();
  }

  function replay() {
    if (activeIndex < 0) return;
    seekTo(activeIndex);
    play();
  }

  function seekTo(index) {
    video.currentTime = cues[index].start;
    setActive(index);
  }

  function syncActive() {
    const index = findCueIndex(cues, video.currentTime);
    if (index !== activeIndex) setActive(index);
  }

  function setActive(index) {
    activeIndex = index;
    rows.forEach((row, i) => row.classList.toggle('active', i === index));
    if (index >= 0) rows[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (popup.index() !== index) popup.close();
    renderOverlay();
  }

  function renderOverlay() {
    const seq = ++overlaySeq;
    const index = activeIndex;
    const cue = cues[index];
    if (!cue) {
      fill(overlay);
      return;
    }
    fill(overlay, overlayNodes(toSegments(cue.text, []), index, openWord));
    tokenizeCached(cue.text).then((tokens) => {
      if (seq === overlaySeq) fill(overlay, overlayNodes(toSegments(cue.text, tokens), index, openWord));
    });
  }

  function openWord(index, token) {
    video.pause();
    popup.open({ mode: 'word', cues, index, token });
  }

  function openSentence(index) {
    video.pause();
    seekTo(index);
    popup.open({ mode: 'sentence', cues, index });
  }

  function toggleSubs() {
    subsOn = !subsOn;
    overlay.hidden = !subsOn;
    subsButton.textContent = subsOn ? 'Subtitles on' : 'Subtitles off';
  }

  function renderCues() {
    popup.close();
    rows = cues.map((cue, i) =>
      h(
        'li',
        { class: 'cue', onclick: () => openSentence(i) },
        h('span', { class: 'cue-time' }, formatTime(cue.start)),
        h('span', { class: 'cue-text' }, cue.text),
        h(
          'button',
          {
            class: 'ghost small cue-sentence',
            onclick: (e) => {
              e.stopPropagation();
              openSentence(i);
            },
          },
          'Sentence',
        ),
      ),
    );
    fill(cueList, rows);
    setActive(findCueIndex(cues, video.currentTime));
  }

  function loadCues() {
    return attempt(async () => {
      const loaded = await api.player.loadCues(episode.path);
      cues = loaded.cues;
      noSubs.hidden = Boolean(loaded.subtitlePath);
      renderCues();
    });
  }

  function linkSubtitle() {
    return attempt(async () => {
      const stored = await api.library.linkSubtitle(episode.path);
      if (!stored) return;
      toast('Subtitle linked', 'success');
      await loadCues();
    });
  }

  async function refreshAnki() {
    const status = await api.anki.status().catch(() => ({ connected: false }));
    ankiChip.textContent = status.connected ? `Anki · ${status.deck}` : 'Anki offline';
    ankiChip.classList.toggle('ok', status.connected);
  }
}
