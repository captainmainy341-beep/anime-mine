import { coverToPixels, expandCover, pictureRect, rectFromDrag, sourceBand } from './lib/coverRect.mjs';
import { findCueIndex, neighborIndex } from './lib/cues.mjs';
import { furiganaSegments } from './lib/furigana.mjs';
import { tokenizeCached } from './lib/nlp.mjs';
import { addKeyColor, dilateMask, keyMask, maskToRgba, setKeyTolerance } from './lib/subKey.mjs';
import {
  audioLabel,
  createGeneration,
  isTypingTarget,
  loopSeekTarget,
  nextOffset,
  resumeTarget,
  shiftCues,
  shouldAutoPause,
  subtitleLabel,
  videoTimeForCue,
} from './lib/playerLogic.mjs';
import { toSegments } from './lib/segments.mjs';
import { attempt, fill, h, toast } from './lib/ui.mjs';
import { createPopup } from './popup.mjs';
import { doodle, withIcon } from './lib/doodleIcons.mjs';
import { inkHeader, setInkHeader } from './lib/inkHeader.mjs';
import { currentLineIndex, formatOffset as formatChipOffset } from './lib/subtitleTimeline.mjs';
import { mountTimeline } from './player/timeline.mjs';

const api = window.api;

const SAVE_INTERVAL_MS = 5000;
const KEY_MAX_WIDTH = 960;
const KEY_MASK_RADIUS = 2;
const WAND_PREVIEW = 'rgba(255, 0, 200, 0.75)';
const HEADER_THROTTLE_MS = 250;
const STRIP_HINT = 'Click a word to look it up. Space pauses, A and D change line.';
const KEYS_HELP =
  'Space play/pause · ←/→ previous/next line · A/D previous/next line · R replay line · L loop line · [/] subtitle offset · M mine word or sentence · Shift+M mine sentence · F fullscreen · Esc close';
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;

const pad = (n) => String(n).padStart(2, '0');
const basename = (path) => path.split(/[\\/]/).pop();

export function cleanPlayerTitle(value) {
  return basename(String(value ?? ''))
    .replace(/\.(?:mkv|mp4|avi|mov|webm)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function formatTime(seconds) {
  const value = Number(seconds);
  const total = Math.floor(Number.isFinite(value) ? Math.max(0, value) : 0);
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

// Text on the black plate in the player header: 'EPISODE 4 OF 12  ·  12:34 / 23:40'.
// Episode number/total only when the library knows them; the times only once the duration is known.
export function plateLabel({ episode = null, total = null, time = null, duration = 0 } = {}) {
  const parts = [];
  const number = Number(episode);
  if (episode != null && Number.isFinite(number) && number > 0) {
    const count = Number(total);
    parts.push(total != null && Number.isFinite(count) && count > 0 ? `EPISODE ${number} OF ${count}` : `EPISODE ${number}`);
  }
  const length = Number(duration);
  if (Number.isFinite(length) && length > 0 && time != null && Number.isFinite(Number(time))) {
    parts.push(`${formatTime(time)} / ${formatTime(length)}`);
  }
  return parts.join('  ·  ');
}

// Graph paper plate above the video: 'Kono Subarashii S3  ·  E04'.
export function episodePlateLabel({ show = '', episode = null } = {}) {
  const number = Number(episode);
  const tag = episode != null && Number.isInteger(number) && number > 0 ? `E${pad(number)}` : '';
  const title = String(show ?? '').trim();
  return [title, tag].filter(Boolean).join('  ·  ');
}

export function scrubFraction(time, duration) {
  const now = Number(time);
  const length = Number(duration);
  if (!Number.isFinite(now) || !Number.isFinite(length) || length <= 0) return 0;
  return Math.max(0, Math.min(1, now / length));
}

export function scrubTime(fraction, duration) {
  const part = Number(fraction);
  const length = Number(duration);
  if (!Number.isFinite(part) || !Number.isFinite(length) || length <= 0) return 0;
  return Math.max(0, Math.min(1, part)) * length;
}

// The tokens worth a chip in the translation strip: real words, never punctuation or whitespace.
export function chipTokens(tokens) {
  return (tokens ?? [])
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => {
      const surface = token?.surface;
      return typeof surface === 'string' && surface.trim() !== '' && !PUNCTUATION_ONLY.test(surface);
    });
}

// Which chip is black: only the word the popup has open, and only on the line it belongs to.
export function selectedChipIndex(tokens, selection, lineIndex = null) {
  const count = Array.isArray(tokens) ? tokens.length : 0;
  if (!count || !selection) return -1;
  if (lineIndex != null && selection.index !== lineIndex) return -1;
  const index = Number(selection.tokenIndex);
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1;
}

// The translation strip shows the line's translation when the data has one, else the Japanese line.
export function lineStripText(cue) {
  if (!cue) return '';
  const translation = [cue.translation, cue.english, cue.en].find((value) => typeof value === 'string' && value.trim());
  return String(translation ?? cue.text ?? '').trim();
}

export function languageTag(lang, kind = 'subs') {
  const code = String(lang ?? '').toLowerCase().split(/[-_]/)[0];
  if (!code) return '';
  const audio = { ja: 'JP', en: 'EN', ko: 'KR', zh: 'ZH' };
  const subs = { ja: 'JA', en: 'EN', ko: 'KO', zh: 'ZH' };
  return (kind === 'audio' ? audio : subs)[code] ?? code.toUpperCase().slice(0, 3);
}

// 'SUBS JA', 'SUBS OFF', 'AUDIO JP' — the small paper chips in the control bar.
export function trackChipLabel(kind, { choice = null, streams = [], linkedLang = null } = {}) {
  const tag = kind === 'audio' ? 'AUDIO' : 'SUBS';
  if (kind !== 'audio' && choice === 'off') return `${tag} OFF`;
  let lang = kind !== 'audio' && choice === 'external' ? linkedLang : null;
  const index = Number(choice);
  const picked = choice != null && choice !== '' && choice !== 'off' && choice !== 'external';
  if (picked && Number.isFinite(index)) {
    lang = streams.find((stream) => stream.index === index)?.lang ?? lang;
  }
  const code = languageTag(lang, kind);
  return code ? `${tag} ${code}` : tag;
}

function fileUrl(path) {
  return `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`;
}

export function createPlayerKnownCache(classify) {
  const cache = new Map();
  return {
    clear: () => cache.clear(),
    classify(text, tokens) {
      if (!cache.has(text)) {
        const pending = classify(tokens).catch((err) => {
          console.error(err);
          if (cache.get(text) === pending) cache.delete(text);
          return null;
        });
        cache.set(text, pending);
      }
      return cache.get(text);
    },
  };
}

export function mountPlayer(container, episode, { onBack, onOpenSettings, onPlayEpisode }) {
  const knownCache = createPlayerKnownCache((tokens) => api.known.classify(tokens));
  let cues = [];
  let streams = [];
  let linkedPath = episode.subtitlePath ?? null;
  let activeIndex = -1;
  let overlaySeq = 0;
  let subsOn = true;
  let settings = {};
  let duration = 0;
  let planMode = null;
  let planAudio = null;
  let audioStreamIndex = null;
  let subOffset = 0;
  let subChoice = 'off';
  let usingDirect = false;
  let seekOnLoad = null;
  let resumeAfterLoad = false;
  let ready = false;
  let alive = true;
  let preparing = false;
  const sourceGen = createGeneration();
  const subGen = createGeneration();
  let saveTimer = null;
  let nextEpisode = null;
  let lastWord = null;
  const toggleControls = [];
  let cover = null;
  let key = null;
  let wand = false;
  let coverMenuOpen = false;
  let editing = false;
  let coverSuppressed = false;
  let dragStart = null;
  let frameRequest = null;

  let showTitle = '';
  let episodeNumber = episode.episode ?? null;
  let episodeTotal = null;
  let lineIndex = -1;
  let lineTokens = [];
  let lineChips = [];
  let selectedToken = null;
  let menuOpen = false;
  let headerTimer = null;
  let lastHeaderPaint = 0;
  let scrubbing = false;

  const header = inkHeader({ title: 'Player', compact: true, label: '', value: 0, max: 0 });
  const video = h('video', { preload: 'metadata', playsinline: true, class: 'player-video' });
  video.controls = false;
  const overlay = h('div', { class: 'subtitle-overlay', hidden: true });
  const coverCanvas = h('canvas', { class: 'cover-canvas', hidden: true });
  const keyCanvas = document.createElement('canvas');
  const pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = 1;
  pixelCanvas.height = 1;
  const coverDraft = h('div', { class: 'cover-draft', hidden: true });
  const coverLayer = h('div', { class: 'cover-layer' }, coverCanvas, coverDraft);
  const codecError = h(
    'div',
    { class: 'video-error', hidden: true },
    "This video's codec isn't supported by the built-in player.",
  );
  const prepareText = h('span', {}, 'Preparing video for playback (compatibility mode)… 0%');
  const prepareCard = h(
    'div',
    { class: 'prepare-card', hidden: true },
    prepareText,
    h('button', { class: 'ghost small', onclick: cancelPrepare }, 'Cancel'),
  );
  const nextButton = h(
    'button',
    { class: 'primary small next-episode', hidden: true, onclick: playNext },
    withIcon('next', 'Next episode'),
  );
  const noSubs = h(
    'div',
    { class: 'nosubs', hidden: true },
    h('span', {}, 'No subtitles linked for this episode.'),
    h('button', { class: 'primary small', onclick: linkSubtitle }, 'Link subtitle'),
  );
  const ankiChip = h('span', { class: 'chip' }, 'Anki…');
  const subsButton = h('button', { class: 'player-menu-btn', 'aria-pressed': 'true', onclick: toggleSubs }, 'Subtitles on');
  const coverButton = h('button', { class: 'player-menu-btn toggle', onclick: toggleCoverMenu }, 'Cover subs');
  const boxButton = h('button', { class: 'player-menu-btn toggle', onclick: toggleCoverEdit }, 'Box');
  const clearCoverButton = h('button', { class: 'player-menu-btn', hidden: true, onclick: clearCover }, 'Remove');
  const coverHint = h('p', { class: 'cover-hint' });
  const wandButton = h(
    'button',
    {
      class: 'player-menu-btn toggle',
      hidden: true,
      title: 'Click a subtitle letter (and its outline) to cover only those pixels',
      onclick: toggleWand,
    },
    'Wand',
  );
  const wandTolerance = h('input', {
    type: 'range',
    class: 'wand-tolerance',
    min: '4',
    max: '96',
    step: '1',
    hidden: true,
    title: 'Wand tolerance',
    oninput: onToleranceInput,
    onchange: onToleranceChange,
  });
  const clearKeyButton = h('button', { class: 'player-menu-btn', hidden: true, onclick: clearKey }, 'Reset colours');
  const coverMenu = h(
    'div',
    { class: 'cover-menu', hidden: true },
    coverHint,
    h('div', { class: 'cover-menu-row' }, boxButton, wandButton, clearCoverButton),
    h('div', { class: 'cover-menu-row' }, wandTolerance, clearKeyButton),
  );
  const linkButton = h('button', { class: 'player-menu-btn', onclick: linkSubtitle }, withIcon('plus', 'Link subtitle'));
  const syncedChip = h('span', { class: 'chip', hidden: true }, 'Auto-synced');
  const audioSelect = h('select', {
    class: 'ctrl-chip-input',
    'aria-label': 'Audio track',
    onchange: (e) => changeAudio(Number(e.target.value)),
  });
  const audioChipLabel = h('span', { class: 'ctrl-chip-label' }, 'AUDIO');
  const audioChip = h('span', { class: 'ctrl-chip ctrl-audio', hidden: true, title: 'Audio track' }, audioChipLabel, audioSelect);
  const subSelect = h('select', {
    class: 'ctrl-chip-input',
    'aria-label': 'Subtitle track',
    onchange: (e) => changeSubtitle(e.target.value),
  });
  const subChipLabel = h('span', { class: 'ctrl-chip-label' }, 'SUBS OFF');
  const subChip = h('span', { class: 'ctrl-chip ctrl-subs', title: 'Subtitle track' }, subChipLabel, subSelect);
  const highlightToggle = toggleControl('highlightUnknown', 'Highlight');
  const furiganaToggle = toggleControl('showFurigana', 'Furigana');
  const autoPauseToggle = toggleControl('autoPause', 'Auto-pause');
  const loopChip = toggleControl('loopLine', 'Loop');
  const offsetChip = h(
    'button',
    { class: 'ctrl-chip ctrl-offset', type: 'button', title: 'Reset subtitle offset to 0s', onclick: () => setSubOffset(0) },
    formatChipOffset(0),
  );
  const playButton = h('button', {
    class: 'ctrl-play',
    type: 'button',
    title: 'Play (Space)',
    'aria-label': 'Play',
    onclick: togglePlay,
  });
  const timeNow = h('span', { class: 'ctrl-time is-now' }, '00:00');
  const timeTotal = h('span', { class: 'ctrl-time is-total' }, '00:00');
  const scrubFill = h('i', { class: 'ink-track-fill' });
  const scrubTrack = h('span', { class: 'ink-track' }, scrubFill);
  const scrubber = h(
    'div',
    {
      class: 'ctrl-scrub',
      role: 'slider',
      tabindex: '0',
      'aria-label': 'Seek',
      'aria-valuemin': '0',
      'aria-valuemax': '0',
      'aria-valuenow': '0',
    },
    scrubTrack,
  );
  const fullscreenButton = h(
    'button',
    {
      class: 'ctrl-fullscreen',
      type: 'button',
      title: 'Fullscreen (F)',
      'aria-label': 'Fullscreen',
      onclick: toggleFullscreen,
    },
    doodle('fullscreen'),
  );
  const controls = h(
    'div',
    { class: 'player-controls' },
    playButton,
    timeNow,
    scrubber,
    timeTotal,
    h('span', { class: 'ctrl-tracks' }, subChip, audioChip, offsetChip),
    fullscreenButton,
  );

  const stripLine = h('p', { class: 'strip-line' });
  const stripHint = h('p', { class: 'strip-hint', title: KEYS_HELP }, STRIP_HINT);
  const stripChips = h('div', { class: 'strip-chips' });
  const strip = h('div', { class: 'player-strip' }, h('div', { class: 'strip-text' }, stripLine, stripHint), stripChips);

  const backButton = h('button', { class: 'stage-btn stage-back', type: 'button', title: 'Back to Library', onclick: onBack }, withIcon('back', 'Library'));
  const titlePlate = h('span', { class: 'stage-plate' });
  const subsMenuButton = h(
    'button',
    {
      class: 'stage-btn stage-subs',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      title: 'Subtitles and tools',
      onclick: toggleMenu,
    },
    withIcon('menu', 'Subtitles'),
  );
  const menu = h(
    'div',
    { class: 'player-menu', hidden: true, role: 'group', 'aria-label': 'Subtitles and tools' },
    h('span', { class: 'ink-tag ink-tag-caps' }, 'Subtitle tools'),
    h('div', { class: 'player-menu-row' }, ankiChip, syncedChip),
    h(
      'div',
      { class: 'player-menu-row' },
      subsButton,
      highlightToggle,
      furiganaToggle,
      autoPauseToggle,
      loopChip,
      coverButton,
    ),
    coverMenu,
    h('div', { class: 'player-menu-row' }, linkButton),
  );

  const popupSlot = h('div', { class: 'popup-slot', hidden: true });
  const popup = createPopup(popupSlot, {
    videoPath: episode.path,
    getAudioStreamIndex: () => audioStreamIndex,
    onOpenSettings,
    onMined: refreshAnki,
    onKnownChanged: handleKnownChanged,
  });

  const stage = h(
    'div',
    { class: 'player-stage' },
    video,
    coverLayer,
    overlay,
    h('div', { class: 'stage-top' }, backButton, titlePlate, h('span', { class: 'stage-spacer' }), subsMenuButton),
    menu,
    noSubs,
    nextButton,
    popupSlot,
    prepareCard,
    codecError,
  );
  const mainColumn = h('div', { class: 'player-main' }, stage, controls, strip);
  const timelineEl = h('aside', { class: 'player-timeline' });
  const timeline = mountTimeline(timelineEl, {
    onSeek: (index) => seekCue(index),
    onOffset: (delta) => setSubOffset(nextOffset(subOffset, delta)),
  });
  const root = h('section', { class: 'player ink-screen' }, header, h('div', { class: 'player-grid' }, mainColumn, timelineEl));

  const keyActions = {
    ' ': togglePlay,
    arrowleft: () => step(-1),
    a: () => step(-1),
    arrowright: () => step(1),
    d: () => step(1),
    r: replay,
    l: () => flip('loopLine'),
    '[': () => setSubOffset(nextOffset(subOffset, -0.1)),
    ']': () => setSubOffset(nextOffset(subOffset, 0.1)),
    m: () => mineWordOrSentence(settings.quickMine === true),
    f: toggleFullscreen,
    escape: closePopup,
  };

  function onKey(e) {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const name = e.key.toLowerCase();
    if ((editing || wand || coverMenuOpen || menuOpen) && name === 'escape') {
      e.preventDefault();
      setMenuOpen(false);
      coverMenuOpen = false;
      wand = false;
      setEditing(false);
      return;
    }
    const action = name === 'm' && e.shiftKey ? () => mineSentence(true) : keyActions[name];
    if (!action) return;
    e.preventDefault();
    action();
  }

  container.append(root);

  const listeners = new AbortController();
  const { signal } = listeners;
  const frameApi = typeof video.requestVideoFrameCallback === 'function';
  const coverObserver = new ResizeObserver(drawCover);
  coverObserver.observe(coverLayer);
  const popupObserver = new MutationObserver(() => {
    if (!popupSlot.hidden || !selectedToken) return;
    selectedToken = null;
    renderStripChips();
  });
  popupObserver.observe(popupSlot, { attributes: true, attributeFilter: ['hidden'] });

  video.addEventListener('loadedmetadata', onMetadata, { signal });
  video.addEventListener('loadeddata', drawCover, { signal });
  video.addEventListener('timeupdate', onTimeUpdate, { signal });
  video.addEventListener('seeked', syncActive, { signal });
  video.addEventListener('seeked', drawCover, { signal });
  video.addEventListener('seeked', () => { syncScrub(); scheduleHeader(); }, { signal });
  if (!frameApi) video.addEventListener('timeupdate', drawCover, { signal });
  video.addEventListener('play', onPlay, { signal });
  video.addEventListener('pause', onPause, { signal });
  video.addEventListener('ended', onEnded, { signal });
  video.addEventListener('error', onVideoError, { signal });
  video.addEventListener('click', togglePlay, { signal });
  document.addEventListener('keydown', onKey, { signal });
  document.addEventListener('pointerdown', onDocumentPointerDown, { signal });
  document.addEventListener('fullscreenchange', syncFullscreenButton, { signal });
  coverLayer.addEventListener('pointerdown', onCoverDown, { signal });
  coverLayer.addEventListener('pointermove', onCoverMove, { signal });
  coverLayer.addEventListener('pointerup', onCoverUp, { signal });
  coverLayer.addEventListener('pointercancel', cancelDrag, { signal });
  scrubber.addEventListener('pointerdown', onScrubDown, { signal });
  scrubber.addEventListener('pointermove', onScrubMove, { signal });
  scrubber.addEventListener('pointerup', onScrubUp, { signal });
  scrubber.addEventListener('pointercancel', onScrubUp, { signal });
  scrubber.addEventListener('keydown', onScrubKey, { signal });
  const offMediaProgress = api.media.onProgress(onPrepareProgress);

  syncTitlePlate();
  syncTrackChips();
  syncScrub();
  setPlayIcon();
  paintHeader();
  renderStripChips();
  attempt(init);
  refreshAnki();
  loadEpisodeInfo();

  return () => {
    alive = false;
    knownCache.clear();
    listeners.abort();
    coverObserver.disconnect();
    popupObserver.disconnect();
    clearTimeout(headerTimer);
    headerTimer = null;
    timeline.destroy();
    stopFrames();
    offMediaProgress();
    stopSaving();
    saveProgress();
    cancelPreparation();
    video.pause();
    video.removeAttribute('src');
    video.load();
    popup.close();
  };

  function durationOf() {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return duration > 0 ? duration : 0;
  }

  function paintHeader() {
    lastHeaderPaint = Date.now();
    const total = durationOf();
    const time = ready && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    setInkHeader(header, {
      title: 'Player',
      label: plateLabel({ episode: episodeNumber, total: episodeTotal, time, duration: total }),
      value: time,
      max: total,
    });
  }

  function scheduleHeader() {
    const wait = HEADER_THROTTLE_MS - (Date.now() - lastHeaderPaint);
    if (wait <= 0) {
      paintHeader();
      return;
    }
    if (headerTimer !== null) return;
    headerTimer = setTimeout(() => {
      headerTimer = null;
      paintHeader();
    }, wait);
  }

  async function loadEpisodeInfo() {
    try {
      const shows = await api.library.getShows();
      if (!alive) return;
      const show = (shows ?? []).find((entry) => entry.episodes.some((item) => item.path === episode.path));
      if (!show) return;
      const position = show.episodes.findIndex((item) => item.path === episode.path);
      showTitle = show.title ?? '';
      episodeNumber = episode.episode ?? (position >= 0 ? position + 1 : null);
      episodeTotal = show.episodes.length || null;
      syncTitlePlate();
      paintHeader();
    } catch (err) {
      console.error(err);
    }
  }

  function syncTitlePlate() {
    const label = episodePlateLabel({ show: cleanPlayerTitle(showTitle || episode.name || episode.path), episode: episodeNumber });
    titlePlate.textContent = label;
    titlePlate.title = label;
  }

  function setPlayIcon() {
    const paused = video.paused;
    fill(playButton, doodle(paused ? 'play' : 'pause'));
    playButton.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    playButton.title = paused ? 'Play (Space)' : 'Pause (Space)';
  }

  function syncScrub() {
    const total = durationOf();
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    scrubFill.style.width = `${scrubFraction(time, total) * 100}%`;
    timeNow.textContent = formatTime(time);
    timeTotal.textContent = formatTime(total);
    scrubber.setAttribute('aria-valuemin', '0');
    scrubber.setAttribute('aria-valuemax', String(Math.round(total)));
    scrubber.setAttribute('aria-valuenow', String(Math.round(time)));
    scrubber.setAttribute('aria-valuetext', `${formatTime(time)} / ${formatTime(total)}`);
  }

  function seekBy(delta) {
    const total = durationOf();
    if (total <= 0) return;
    video.currentTime = Math.max(0, Math.min(total, video.currentTime + delta));
    syncScrub();
    syncActive();
  }

  function seekFromPointer(event) {
    const box = scrubTrack.getBoundingClientRect();
    const total = durationOf();
    if (!box.width || total <= 0) return;
    video.currentTime = scrubTime((event.clientX - box.left) / box.width, total);
    syncScrub();
  }

  function onScrubDown(event) {
    if (event.button !== 0) return;
    scrubbing = true;
    try {
      scrubber.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers have no capture target.
    }
    seekFromPointer(event);
    event.preventDefault();
  }

  function onScrubMove(event) {
    if (scrubbing) seekFromPointer(event);
  }

  function onScrubUp(event) {
    if (!scrubbing) return;
    scrubbing = false;
    try {
      scrubber.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be released.
    }
  }

  function onScrubKey(event) {
    const total = durationOf();
    const step = event.shiftKey ? 30 : 5;
    let target = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = video.currentTime - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = video.currentTime + step;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = total;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    video.currentTime = Math.max(0, Math.min(total, target));
    syncScrub();
    syncActive();
  }

  function toggleFullscreen() {
    const target = mainColumn;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    target.requestFullscreen?.().catch(() => {});
  }

  function syncFullscreenButton() {
    const on = document.fullscreenElement === mainColumn;
    fullscreenButton.classList.toggle('is-on', on);
    fullscreenButton.setAttribute('aria-pressed', String(on));
    fullscreenButton.title = on ? 'Leave fullscreen (F)' : 'Fullscreen (F)';
  }

  function toggleMenu() {
    setMenuOpen(!menuOpen);
  }

  function setMenuOpen(open) {
    menuOpen = open;
    menu.hidden = !open;
    subsMenuButton.classList.toggle('is-on', open);
    subsMenuButton.setAttribute('aria-expanded', String(open));
    if (!open && (coverMenuOpen || editing || wand)) {
      coverMenuOpen = false;
      wand = false;
      setEditing(false);
    }
  }

  function onDocumentPointerDown(event) {
    if (!menuOpen) return;
    if (menu.contains(event.target) || subsMenuButton.contains(event.target)) return;
    setMenuOpen(false);
  }

  function syncTrackChips() {
    subChipLabel.textContent = trackChipLabel('subs', {
      choice: subChoice,
      streams,
      linkedLang: linkedPath ? 'ja' : null,
    });
    audioChipLabel.textContent = trackChipLabel('audio', { choice: audioStreamIndex, streams });
    subChip.title = subSelect.selectedOptions?.[0]?.textContent ?? 'Subtitle track';
    audioChip.title = audioSelect.selectedOptions?.[0]?.textContent ?? 'Audio track';
  }

  function toggleControl(key, label) {
    const control = h('button', { class: 'player-menu-btn toggle', 'aria-pressed': 'false', onclick: () => flip(key) }, label);
    toggleControls.push({ key, control });
    return control;
  }

  function syncToggles() {
    for (const { key, control } of toggleControls) {
      const on = settings[key] === true;
      control.classList.toggle('on', on);
      control.setAttribute('aria-pressed', String(on));
    }
  }

  function flip(key) {
    settings = { ...settings, [key]: !settings[key] };
    syncToggles();
    if (key === 'highlightUnknown' || key === 'showFurigana') renderOverlay();
    attempt(() => api.settings.set({ [key]: settings[key] }));
  }

  function syncCoverUi() {
    coverMenu.hidden = !coverMenuOpen;
    coverButton.classList.toggle('on', coverMenuOpen || cover !== null);
    coverButton.setAttribute('aria-pressed', String(coverMenuOpen));
    boxButton.classList.toggle('on', editing);
    boxButton.setAttribute('aria-pressed', String(editing));
    clearCoverButton.hidden = !cover;
    wandButton.hidden = !cover;
    wandButton.classList.toggle('on', wand);
    wandButton.setAttribute('aria-pressed', String(wand));
    wandTolerance.hidden = !(wand && key);
    if (key) wandTolerance.value = String(key.tolerance);
    clearKeyButton.hidden = !(wand && key);
    coverMenu.querySelectorAll('.cover-menu-row').forEach((row) => {
      row.hidden = [...row.children].every((child) => child.hidden);
    });
    coverHint.textContent = wand
      ? key ? 'Click more letters or outlines. Slide to fine-tune.' : 'Pause, then click a subtitle letter.'
      : editing ? 'Drag a box over the subtitles.' : 'Subtitles are covered.';
    coverLayer.classList.toggle('editing', editing || wand);
  }

  function toggleCoverMenu() {
    coverMenuOpen = !coverMenuOpen;
    editing = coverMenuOpen && !cover;
    wand = false;
    cancelDrag();
    syncCoverUi();
    drawCover();
  }

  function toggleCoverEdit() {
    setEditing(!editing);
  }

  function setEditing(on) {
    editing = on;
    if (on) wand = false;
    cancelDrag();
    syncCoverUi();
    drawCover();
  }

  function toggleWand() {
    wand = !wand;
    if (wand) editing = false;
    cancelDrag();
    syncCoverUi();
    drawCover();
  }

  function clearKey() {
    attempt(() => saveKey(null));
  }

  async function saveKey(next) {
    const saved = await api.settings.set({ subtitleKey: next });
    key = saved?.subtitleKey ?? next;
    syncCoverUi();
    drawCover();
  }

  function onToleranceInput() {
    if (!key) return;
    key = setKeyTolerance(key, Number(wandTolerance.value));
    drawCover();
  }

  function onToleranceChange() {
    if (key) attempt(() => saveKey(key));
  }

  function sampleWand(e) {
    if (e.button !== 0 || !video.videoWidth) return;
    const pic = currentPicture();
    const point = coverPoint(e);
    const fx = (point.x - pic.left) / pic.width;
    const fy = (point.y - pic.top) / pic.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    const px = Math.min(video.videoWidth - 1, Math.floor(fx * video.videoWidth));
    const py = Math.min(video.videoHeight - 1, Math.floor(fy * video.videoHeight));
    const ctx = pixelCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, px, py, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    attempt(() => saveKey(addKeyColor(key, [r, g, b])));
  }

  function clearCover() {
    wand = false;
    editing = false;
    attempt(async () => {
      await saveKey(null);
      await saveCover(null);
    });
  }

  async function saveCover(next) {
    await api.settings.set({ subtitleCover: next });
    cover = next;
    syncCoverUi();
    drawCover();
  }

  function currentPicture() {
    return pictureRect(coverLayer.clientWidth, coverLayer.clientHeight, video.videoWidth, video.videoHeight);
  }

  function coverPoint(e) {
    const box = coverLayer.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  function onCoverDown(e) {
    if (wand) {
      sampleWand(e);
      return;
    }
    if (!editing || e.button !== 0 || !video.videoWidth) return;
    dragStart = coverPoint(e);
    coverLayer.setPointerCapture(e.pointerId);
  }

  function onCoverMove(e) {
    if (dragStart) showDraft(dragStart, coverPoint(e));
  }

  function onCoverUp(e) {
    if (!dragStart) return;
    const next = rectFromDrag(dragStart, coverPoint(e), currentPicture());
    cancelDrag();
    if (next) attempt(() => saveCover(next));
  }

  function cancelDrag() {
    dragStart = null;
    coverDraft.hidden = true;
  }

  function showDraft(a, b) {
    const pic = currentPicture();
    const rect = rectFromDrag(a, b, pic);
    coverDraft.hidden = !rect;
    if (rect) placeAt(coverDraft, coverToPixels(rect, pic));
  }

  function placeAt(el, box) {
    Object.assign(el.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }

  function drawCover() {
    const show = alive && cover && !coverSuppressed && video.readyState >= 2 && video.videoWidth > 0;
    coverCanvas.hidden = !show;
    if (!show) return;
    const area = expandCover(cover);
    const box = coverToPixels(area, currentPicture());
    placeAt(coverCanvas, box);
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    if (coverCanvas.width !== width) coverCanvas.width = width;
    if (coverCanvas.height !== height) coverCanvas.height = height;
    const band = sourceBand(area, video.videoWidth, video.videoHeight);
    const ctx = coverCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    coverCanvas.classList.toggle('keyed', key !== null);
    if (key && wand) {
      ctx.fillStyle = WAND_PREVIEW;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.save();
      ctx.filter = 'blur(14px)';
      ctx.translate(0, height);
      ctx.scale(1, -1);
      const pad = 28;
      ctx.drawImage(video, band.sx, band.sy, band.sw, band.sh, -pad, -pad, width + pad * 2, height + pad * 2);
      ctx.restore();
    }
    if (key) keepKeyedPixels(ctx, area, width, height);
  }

  // Keeps the cover only where the frame matches the wand's key colours, so everything else in the box shows through.
  function keepKeyedPixels(ctx, area, width, height) {
    const sw = area.w * video.videoWidth;
    const sh = area.h * video.videoHeight;
    const scale = Math.min(1, KEY_MAX_WIDTH / sw);
    const kw = Math.max(1, Math.round(sw * scale));
    const kh = Math.max(1, Math.round(sh * scale));
    if (keyCanvas.width !== kw) keyCanvas.width = kw;
    if (keyCanvas.height !== kh) keyCanvas.height = kh;
    const kctx = keyCanvas.getContext('2d', { willReadFrequently: true });
    kctx.drawImage(video, area.x * video.videoWidth, area.y * video.videoHeight, sw, sh, 0, 0, kw, kh);
    const pixels = kctx.getImageData(0, 0, kw, kh);
    const mask = dilateMask(keyMask(pixels.data, kw, kh, key), kw, kh, KEY_MASK_RADIUS);
    kctx.putImageData(new ImageData(maskToRgba(mask, [0, 0, 0], pixels.data), kw, kh), 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.filter = 'blur(1px)';
    ctx.drawImage(keyCanvas, 0, 0, width, height);
    ctx.restore();
  }

  function startFrames() {
    if (frameApi && frameRequest === null) frameRequest = video.requestVideoFrameCallback(onFrame);
  }

  function stopFrames() {
    if (frameRequest !== null) video.cancelVideoFrameCallback(frameRequest);
    frameRequest = null;
  }

  function onFrame() {
    frameRequest = null;
    drawCover();
    if (!video.paused) startFrames();
  }

  async function init() {
    settings = await api.settings.get();
    if (!alive) return;
    syncToggles();
    cover = settings.subtitleCover ?? null;
    key = settings.subtitleKey ?? null;
    syncCoverUi();
    const probe = await api.media.probe(episode.path);
    if (!alive) return;
    const saved = probe.saved;
    duration = probe.duration ?? 0;
    streams = probe.streams;
    audioStreamIndex = saved?.audioStreamIndex ?? probe.defaults.audioStreamIndex;
    planAudio = audioStreamIndex;
    planMode = probe.plan.mode;
    subOffset = saved?.subOffset ?? 0;
    subChoice = saved?.subtitle ?? (linkedPath ? 'external' : (probe.defaults.subtitleStreamIndex ?? 'off'));
    buildAudioOptions();
    buildSubtitleOptions();
    refreshOffset();
    syncTrackChips();
    syncScrub();
    paintHeader();
    startSource(resumeTarget(saved, duration));
    await loadSubs(subChoice);
  }

  function buildAudioOptions() {
    const audio = streams.filter((stream) => stream.type === 'audio');
    audioSelect.replaceChildren(...audio.map((stream) => h('option', { value: String(stream.index) }, audioLabel(stream))));
    audioSelect.value = String(audioStreamIndex);
    audioChip.hidden = audio.length < 2;
  }

  function buildSubtitleOptions() {
    subSelect.replaceChildren(
      ...(linkedPath ? [h('option', { value: 'external' }, `Linked: ${basename(linkedPath)}`)] : []),
      ...streams
        .filter((stream) => stream.type === 'subtitle')
        .map((stream) => h('option', { value: String(stream.index), disabled: !stream.textBased }, subtitleLabel(stream))),
      h('option', { value: 'off' }, 'Off'),
    );
    subSelect.value = String(subChoice);
  }

  function startSource(seek) {
    seekOnLoad = seek;
    ready = false;
    codecError.hidden = true;
    usingDirect = planMode === 'direct' && audioStreamIndex === planAudio;
    coverSuppressed = false;
    if (usingDirect) {
      cancelPreparation();
      prepareCard.hidden = true;
      video.src = fileUrl(episode.path);
    } else {
      playPrepared(false);
    }
  }

  async function playPrepared(force) {
    const token = sourceGen.begin();
    const current = () => alive && sourceGen.isCurrent(token);
    preparing = true;
    prepareCard.hidden = false;
    try {
      const { path, cleaned } = await api.media.prepare({ videoPath: episode.path, audioStreamIndex, force });
      if (!current()) return;
      coverSuppressed = cleaned === true;
      preparing = false;
      prepareCard.hidden = true;
      video.src = fileUrl(path);
    } catch (err) {
      if (!current()) return;
      preparing = false;
      prepareCard.hidden = true;
      codecError.hidden = false;
      toast(err.message, 'error');
    }
  }

  async function cancelPreparation() {
    sourceGen.begin();
    if (!preparing) return;
    preparing = false;
    await api.media.cancel(episode.path).catch((err) => console.error(err));
  }

  function onPrepareProgress({ videoPath, fraction }) {
    if (videoPath !== episode.path || prepareCard.hidden) return;
    prepareText.textContent = `Preparing video for playback (compatibility mode)… ${Math.round(fraction * 100)}%`;
  }

  function cancelPrepare() {
    attempt(async () => {
      await cancelPreparation();
      onBack();
    });
  }

  function onVideoError() {
    if (!usingDirect) {
      codecError.hidden = false;
      return;
    }
    usingDirect = false;
    seekOnLoad = video.currentTime;
    resumeAfterLoad = !video.paused;
    playPrepared(true);
  }

  function onMetadata() {
    ready = true;
    if (!duration && Number.isFinite(video.duration)) duration = video.duration;
    if (seekOnLoad !== null) {
      video.currentTime = seekOnLoad;
      seekOnLoad = null;
    }
    if (resumeAfterLoad) {
      resumeAfterLoad = false;
      play();
    }
    syncScrub();
    paintHeader();
  }

  function changeAudio(index) {
    audioStreamIndex = index;
    persist({ audioStreamIndex: index });
    resumeAfterLoad = !video.paused;
    syncTrackChips();
    startSource(video.currentTime);
  }

  function changeSubtitle(value) {
    subChoice = value === 'external' || value === 'off' ? value : Number(value);
    persist({ subtitle: subChoice });
    syncTrackChips();
    attempt(() => loadSubs(subChoice));
  }

  async function loadSubs(choice) {
    const token = subGen.begin();
    if (choice === 'off') {
      cues = [];
      noSubs.hidden = true;
      syncedChip.hidden = true;
      applyCues();
      return;
    }
    stripLine.textContent = 'Loading subtitles… (first open of a re-timed file can take a few seconds)';
    fill(stripChips);
    const loaded = await api.player.loadCues(episode.path, choice === 'external' ? {} : { embeddedIndex: choice });
    if (!alive || !subGen.isCurrent(token)) return;
    cues = loaded.cues;
    noSubs.hidden = loaded.source !== 'none';
    syncedChip.hidden = loaded.synced !== true;
    applyCues();
  }

  function applyCues() {
    closePopup();
    timeline.setCues(cues);
    timeline.setOffset(subOffset);
    setActive(findCueIndex(cues, video.currentTime - subOffset), true);
    syncTimeline();
  }

  function linkSubtitle() {
    return attempt(async () => {
      const stored = await api.library.linkSubtitle(episode.path);
      if (!alive || !stored) return;
      toast('Subtitle linked', 'success');
      linkedPath = stored;
      subChoice = 'external';
      buildSubtitleOptions();
      syncTrackChips();
      persist({ subtitle: subChoice });
      await loadSubs(subChoice);
    });
  }

  function persist(patch) {
    return api.progress.update({ videoPath: episode.path, patch }).catch((err) => console.error(err));
  }

  function saveProgress() {
    if (!ready || !Number.isFinite(video.duration)) return;
    persist({ position: video.currentTime, duration: video.duration });
  }

  function startSaving() {
    saveTimer ??= setInterval(saveProgress, SAVE_INTERVAL_MS);
  }

  function stopSaving() {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  function onPlay() {
    popup.close();
    nextButton.hidden = true;
    startSaving();
    startFrames();
    setPlayIcon();
    scheduleHeader();
  }

  function onPause() {
    stopSaving();
    stopFrames();
    saveProgress();
    setPlayIcon();
    scheduleHeader();
  }

  function onEnded() {
    stopSaving();
    saveProgress();
    setPlayIcon();
    syncScrub();
    attempt(async () => {
      nextEpisode = await api.progress.next(episode.path);
      if (!alive) return;
      nextButton.hidden = !nextEpisode || !onPlayEpisode;
    });
  }

  function playNext() {
    if (nextEpisode) onPlayEpisode(nextEpisode);
  }

  function togglePlay() {
    if (video.paused) play();
    else video.pause();
  }

  function play() {
    // Playback failures surface through the video element's error event.
    video.play().catch(() => {});
  }

  function onTimeUpdate() {
    const cue = cues[activeIndex];
    const time = video.currentTime;
    const loopTo = loopSeekTarget({ loopLine: settings.loopLine, cue, time, subOffset });
    if (loopTo !== null) video.currentTime = loopTo;
    else if (shouldAutoPause({ autoPause: settings.autoPause, cue, time, subOffset })) video.pause();
    syncActive();
    syncScrub();
    scheduleHeader();
  }

  function step(dir) {
    const index = neighborIndex(cues, video.currentTime - subOffset, dir);
    if (index < 0) return;
    seekTo(index);
    play();
  }

  function replay() {
    if (activeIndex < 0) return;
    seekTo(activeIndex);
    play();
  }

  function seekCue(index) {
    if (!Number.isInteger(index) || index < 0 || index >= cues.length) return;
    seekTo(index);
  }

  function seekTo(index) {
    video.currentTime = videoTimeForCue(cues[index], subOffset);
    setActive(index);
    syncTimeline();
  }

  function setSubOffset(next) {
    subOffset = next;
    refreshOffset();
    persist({ subOffset });
    syncActive();
  }

  function refreshOffset() {
    offsetChip.textContent = formatChipOffset(subOffset);
    offsetChip.classList.toggle('is-set', subOffset !== 0);
    timeline.setOffset(subOffset);
  }

  function syncTimeline() {
    timeline.setCurrent(currentLineIndex(cues, video.currentTime - subOffset));
  }

  function syncActive() {
    const index = findCueIndex(cues, video.currentTime - subOffset);
    if (index !== activeIndex) setActive(index);
    syncTimeline();
  }

  function setActive(index, force = false) {
    if (index === activeIndex && !force) {
      syncTimeline();
      return;
    }
    activeIndex = index;
    selectedToken = null;
    if (popup.index() !== index) popup.close();
    renderOverlay();
    syncTimeline();
  }

  function renderSegments(text, tokens, statuses, index) {
    const lines = [[]];
    for (const seg of toSegments(text, tokens)) {
      const pieces = seg.text.split('\n');
      pieces.forEach((piece, pieceIndex) => {
        if (pieceIndex) lines.push([]);
        if (!piece) return;
        if (!seg.token) { lines.at(-1).push(piece); return; }
        const tokenIndex = tokens.indexOf(seg.token);
        const status = statuses?.[tokenIndex];
        const classes = ['word'];
        if (settings.highlightUnknown && status && status !== 'skip') classes.push(`tok-${status}`);
        const parts = settings.showFurigana && pieces.length === 1
          ? furiganaSegments({ surface: piece, reading: seg.token.reading }) : [{ text: piece }];
        lines.at(-1).push(h('span', {
          class: classes.join(' '), tabindex: 0,
          onclick: () => openWord(index, tokens, tokenIndex),
          onmouseenter: () => { lastWord = { index, tokens, tokenIndex }; },
        }, parts.map((part) => part.ruby ? h('ruby', {}, part.text, h('rt', {}, part.ruby)) : part.text)));
      });
    }
    return lines.map((line) => h('div', { class: 'subtitle-line' }, line));
  }

  function renderOverlay() {
    const seq = ++overlaySeq;
    const index = activeIndex;
    const cue = cues[index];
    overlay.hidden = !subsOn || !cue;
    stripLine.textContent = lineStripText(cue);
    setLineTokens(index, []);
    if (!cue) {
      fill(overlay);
      return;
    }
    fill(overlay, renderSegments(cue.text, [], null, index));
    tokenizeCached(cue.text)
      .then(async (tokens) => ({ tokens, result: alive && seq === overlaySeq ? await knownCache.classify(cue.text, tokens) : null }))
      .then(({ tokens, result }) => {
        if (!alive || seq !== overlaySeq) return;
        fill(overlay, renderSegments(cue.text, tokens, result?.statuses ?? null, index));
        setLineTokens(index, tokens);
      });
  }

  function setLineTokens(index, tokens) {
    lineIndex = index;
    lineTokens = tokens ?? [];
    lineChips = chipTokens(lineTokens);
    renderStripChips();
  }

  function renderStripChips() {
    const selected = selectedChipIndex(lineTokens, selectedToken, lineIndex);
    fill(
      stripChips,
      lineChips.map(({ token, index: tokenIndex }) =>
        h(
          'button',
          {
            class: `strip-chip${tokenIndex === selected ? ' is-selected' : ''}`,
            type: 'button',
            title: token.reading ? `${token.surface} · ${token.reading}` : token.surface,
            onclick: () => openWord(lineIndex, lineTokens, tokenIndex),
          },
          token.surface,
        ),
      ),
    );
  }

  function handleKnownChanged() {
    knownCache.clear();
    renderOverlay();
  }

  function openWord(index, tokens, tokenIndex) {
    lastWord = { index, tokens, tokenIndex };
    selectedToken = { index, tokenIndex };
    video.pause();
    popup.open({ mode: 'word', cues: shiftCues(cues, subOffset), index, tokens, tokenIndex, token: tokens[tokenIndex] });
    renderStripChips();
  }

  function closePopup() {
    popup.close();
    if (!selectedToken) return;
    selectedToken = null;
    renderStripChips();
  }

  function mineWordOrSentence(direct) {
    if (activeIndex < 0) return;
    const target =
      popup.index() !== -1 && lastWord
        ? {
            mode: 'word',
            cues: shiftCues(cues, subOffset),
            index: lastWord.index,
            tokens: lastWord.tokens,
            tokenIndex: lastWord.tokenIndex,
            token: lastWord.tokens[lastWord.tokenIndex],
          }
        : { mode: 'sentence', cues: shiftCues(cues, subOffset), index: activeIndex };
    if (target.mode === 'word') {
      selectedToken = { index: target.index, tokenIndex: target.tokenIndex };
      renderStripChips();
    }
    attempt(() => popup.quickMine(target, { direct }));
  }

  function mineSentence(direct) {
    if (activeIndex < 0) return;
    attempt(() => popup.quickMine({ mode: 'sentence', cues: shiftCues(cues, subOffset), index: activeIndex }, { direct }));
  }

  function toggleSubs() {
    subsOn = !subsOn;
    overlay.hidden = !subsOn || !cues[activeIndex];
    subsButton.textContent = subsOn ? 'Subtitles on' : 'Subtitles off';
    subsButton.setAttribute('aria-pressed', String(subsOn));
  }

  async function refreshAnki() {
    const status = await api.anki.status().catch(() => ({ connected: false }));
    if (!alive) return;
    ankiChip.textContent = status.connected ? `Anki · ${status.deck}` : 'Anki offline';
    ankiChip.classList.toggle('ok', status.connected);
  }
}
