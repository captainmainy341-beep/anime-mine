import { coverToPixels, expandCover, pictureRect, rectFromDrag, sourceBand } from './lib/coverRect.mjs';
import { findCueIndex, neighborIndex } from './lib/cues.mjs';
import { furigana } from './lib/furigana.mjs';
import { tokenizeCached } from './lib/nlp.mjs';
import { addKeyColor, dilateMask, keyMask, maskToRgba, setKeyTolerance } from './lib/subKey.mjs';
import {
  audioLabel,
  createGeneration,
  formatOffset,
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
import { withIcon } from './lib/doodleIcons.mjs';

const api = window.api;

const SAVE_INTERVAL_MS = 5000;
const KEY_MAX_WIDTH = 960;
const KEY_MASK_RADIUS = 2;
const WAND_PREVIEW = 'rgba(255, 0, 200, 0.75)';
const KEYS_HELP =
  'Space play/pause · ←/→ previous/next line · R replay line · L loop line · [/] subtitle offset · M mine word or sentence · Shift+M mine sentence · Esc close';

const pad = (n) => String(n).padStart(2, '0');
const basename = (path) => path.split(/[\\/]/).pop();

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

function fileUrl(path) {
  return `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`;
}

const knownCache = new Map();

function classifyCached(text, tokens) {
  if (!knownCache.has(text)) {
    knownCache.set(
      text,
      api.known.classify(tokens).catch((err) => {
        console.error(err);
        knownCache.delete(text);
        return null;
      }),
    );
  }
  return knownCache.get(text);
}

export function mountPlayer(container, episode, { onBack, onOpenSettings, onPlayEpisode }) {
  let cues = [];
  let rows = [];
  let badges = [];
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

  const video = h('video', { controls: true, preload: 'metadata' });
  const overlay = h('div', { class: 'subtitle-overlay' });
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
  const nextButton = h('button', { class: 'primary small next-episode', hidden: true, onclick: playNext }, 'Next episode →');
  const noSubs = h(
    'div',
    { class: 'nosubs', hidden: true },
    h('span', {}, 'No subtitles linked for this episode.'),
    h('button', { class: 'primary small', onclick: linkSubtitle }, 'Link subtitle'),
  );
  const cueList = h('ol', { class: 'cue-list' });
  const ankiChip = h('span', { class: 'chip' }, 'Anki…');
  const subsButton = h('button', { class: 'ghost small', onclick: toggleSubs }, 'Subtitles on');
  const coverButton = h('button', { class: 'ghost small toggle', onclick: toggleCoverMenu }, 'Cover subs');
  const boxButton = h('button', { class: 'ghost small toggle', onclick: toggleCoverEdit }, 'Box');
  const clearCoverButton = h('button', { class: 'ghost small', hidden: true, onclick: clearCover }, 'Remove');
  const coverHint = h('p', { class: 'cover-hint' });
  const wandButton = h(
    'button',
    { class: 'ghost small toggle', hidden: true, title: 'Click a subtitle letter (and its outline) to cover only those pixels', onclick: toggleWand },
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
  const clearKeyButton = h('button', { class: 'ghost small', hidden: true, onclick: clearKey }, 'Reset colours');
  const coverMenu = h(
    'div',
    { class: 'cover-menu', hidden: true },
    coverHint,
    h('div', { class: 'cover-menu-row' }, boxButton, wandButton, clearCoverButton),
    h('div', { class: 'cover-menu-row' }, wandTolerance, clearKeyButton),
  );
  const offsetChip = h('button', { class: 'chip', hidden: true, onclick: () => setSubOffset(0) }, '');
  const syncedChip = h('span', { class: 'chip', hidden: true }, 'Auto-synced');
  const audioSelect = h('select', { class: 'track-select', hidden: true, onchange: (e) => changeAudio(Number(e.target.value)) });
  const subSelect = h('select', { class: 'track-select', onchange: (e) => changeSubtitle(e.target.value) });
  const highlightToggle = toggleControl('highlightUnknown', 'Highlight', 'ghost small toggle');
  const furiganaToggle = toggleControl('showFurigana', 'Furigana', 'ghost small toggle');
  const autoPauseToggle = toggleControl('autoPause', 'Auto-pause', 'ghost small toggle');
  const loopChip = toggleControl('loopLine', 'Loop', 'chip');
  const popupSlot = h('div', { class: 'popup-slot', hidden: true });
  const popup = createPopup(popupSlot, {
    videoPath: episode.path,
    getAudioStreamIndex: () => audioStreamIndex,
    onOpenSettings,
    onMined: refreshAnki,
    onKnownChanged: handleKnownChanged,
  });

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
    escape: () => popup.close(),
  };

  function onKey(e) {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const name = e.key.toLowerCase();
    if ((editing || wand || coverMenuOpen) && name === 'escape') {
      e.preventDefault();
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

  container.append(
    h(
      'section',
      { class: 'player' },
      h(
        'header',
        { class: 'player-head' },
        h('button', { class: 'ghost small', onclick: onBack }, withIcon('back', 'Library')),
        h('h2', { class: 'player-title', title: episode.name }, episode.name),
        h(
          'div',
          { class: 'player-tools' },
          ankiChip,
          highlightToggle,
          furiganaToggle,
          autoPauseToggle,
          loopChip,
          offsetChip,
          syncedChip,
          subsButton,
          coverButton,
        ),
      ),
      h(
        'div',
        { class: 'player-body' },
        h(
          'div',
          { class: 'stage' },
          h('div', { class: 'video-wrap' }, video, coverLayer, coverMenu, overlay, prepareCard, codecError),
          h('div', { class: 'tracks' }, audioSelect, subSelect),
          noSubs,
          nextButton,
          h('p', { class: 'keys', title: KEYS_HELP }, KEYS_HELP),
        ),
        h('aside', { class: 'sidebar' }, popupSlot, cueList),
      ),
    ),
  );

  const listeners = new AbortController();
  const { signal } = listeners;
  const frameApi = typeof video.requestVideoFrameCallback === 'function';
  const coverObserver = new ResizeObserver(drawCover);
  coverObserver.observe(coverLayer);
  video.addEventListener('loadedmetadata', onMetadata, { signal });
  video.addEventListener('loadeddata', drawCover, { signal });
  video.addEventListener('timeupdate', onTimeUpdate, { signal });
  video.addEventListener('seeked', syncActive, { signal });
  video.addEventListener('seeked', drawCover, { signal });
  if (!frameApi) video.addEventListener('timeupdate', drawCover, { signal });
  video.addEventListener('play', onPlay, { signal });
  video.addEventListener('pause', onPause, { signal });
  video.addEventListener('ended', onEnded, { signal });
  video.addEventListener('error', onVideoError, { signal });
  document.addEventListener('keydown', onKey, { signal });
  coverLayer.addEventListener('pointerdown', onCoverDown, { signal });
  coverLayer.addEventListener('pointermove', onCoverMove, { signal });
  coverLayer.addEventListener('pointerup', onCoverUp, { signal });
  coverLayer.addEventListener('pointercancel', cancelDrag, { signal });
  const offMediaProgress = api.media.onProgress(onPrepareProgress);

  attempt(init);
  refreshAnki();

  return () => {
    alive = false;
    listeners.abort();
    coverObserver.disconnect();
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

  function toggleControl(key, label, className) {
    const control = h('button', { class: className, onclick: () => flip(key) }, label);
    toggleControls.push({ key, control });
    return control;
  }

  function syncToggles() {
    for (const { key, control } of toggleControls) control.classList.toggle('on', settings[key] === true);
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
    boxButton.classList.toggle('on', editing);
    clearCoverButton.hidden = !cover;
    wandButton.hidden = !cover;
    wandButton.classList.toggle('on', wand);
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
    startSource(resumeTarget(saved, duration));
    await loadSubs(subChoice);
  }

  function buildAudioOptions() {
    const audio = streams.filter((stream) => stream.type === 'audio');
    audioSelect.replaceChildren(...audio.map((stream) => h('option', { value: String(stream.index) }, audioLabel(stream))));
    audioSelect.value = String(audioStreamIndex);
    audioSelect.hidden = audio.length < 2;
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
    if (seekOnLoad !== null) {
      video.currentTime = seekOnLoad;
      seekOnLoad = null;
    }
    if (resumeAfterLoad) {
      resumeAfterLoad = false;
      play();
    }
  }

  function changeAudio(index) {
    audioStreamIndex = index;
    persist({ audioStreamIndex: index });
    resumeAfterLoad = !video.paused;
    startSource(video.currentTime);
  }

  function changeSubtitle(value) {
    subChoice = value === 'external' || value === 'off' ? value : Number(value);
    persist({ subtitle: subChoice });
    attempt(() => loadSubs(subChoice));
  }

  async function loadSubs(choice) {
    const token = subGen.begin();
    if (choice === 'off') {
      cues = [];
      noSubs.hidden = true;
      syncedChip.hidden = true;
      renderCues();
      return;
    }
    fill(cueList, h('li', { class: 'cue-status' }, 'Loading subtitles… (first open of a re-timed file can take a few seconds)'));
    const loaded = await api.player.loadCues(episode.path, choice === 'external' ? {} : { embeddedIndex: choice });
    if (!alive || !subGen.isCurrent(token)) return;
    cues = loaded.cues;
    noSubs.hidden = loaded.source !== 'none';
    syncedChip.hidden = loaded.synced !== true;
    renderCues();
  }

  function linkSubtitle() {
    return attempt(async () => {
      const stored = await api.library.linkSubtitle(episode.path);
      if (!alive || !stored) return;
      toast('Subtitle linked', 'success');
      linkedPath = stored;
      subChoice = 'external';
      buildSubtitleOptions();
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
  }

  function onPause() {
    stopSaving();
    stopFrames();
    saveProgress();
  }

  function onEnded() {
    stopSaving();
    saveProgress();
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

  function seekTo(index) {
    video.currentTime = videoTimeForCue(cues[index], subOffset);
    setActive(index);
  }

  function setSubOffset(next) {
    subOffset = next;
    refreshOffset();
    persist({ subOffset });
    syncActive();
  }

  function refreshOffset() {
    offsetChip.textContent = formatOffset(subOffset);
    offsetChip.hidden = subOffset === 0;
  }

  function syncActive() {
    const index = findCueIndex(cues, video.currentTime - subOffset);
    if (index !== activeIndex) setActive(index);
  }

  function setActive(index) {
    activeIndex = index;
    rows.forEach((row, i) => row.classList.toggle('active', i === index));
    if (index >= 0) rows[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (popup.index() !== index) popup.close();
    updateBadge(-1, null);
    renderOverlay();
  }

  function updateBadge(index, info) {
    badges.forEach((badge, i) => {
      badge.hidden = !(i === index && info?.isIPlusOne);
    });
  }

  function renderSegments(text, tokens, statuses, index) {
    return toSegments(text, tokens).map((seg) => {
      if (!seg.token) return seg.text;
      const tokenIndex = tokens.indexOf(seg.token);
      const status = statuses?.[tokenIndex];
      const classes = ['word'];
      if (settings.highlightUnknown && status && status !== 'skip') classes.push(`tok-${status}`);
      const ruby = settings.showFurigana ? furigana({ surface: seg.text, reading: seg.token.reading }) : null;
      return h(
        'span',
        {
          class: classes.join(' '),
          tabindex: 0,
          onclick: () => openWord(index, tokens, tokenIndex),
          onmouseenter: () => {
            lastWord = { index, tokens, tokenIndex };
          },
        },
        ruby?.rt ? h('ruby', {}, ruby.surface, h('rt', {}, ruby.rt)) : seg.text,
      );
    });
  }

  function renderOverlay() {
    const seq = ++overlaySeq;
    const index = activeIndex;
    const cue = cues[index];
    if (!cue) {
      fill(overlay);
      return;
    }
    fill(overlay, renderSegments(cue.text, [], null, index));
    tokenizeCached(cue.text)
      .then(async (tokens) => ({ tokens, result: await classifyCached(cue.text, tokens) }))
      .then(({ tokens, result }) => {
        if (!alive || seq !== overlaySeq) return;
        fill(overlay, renderSegments(cue.text, tokens, result?.statuses ?? null, index));
        updateBadge(index, result?.info ?? null);
      });
  }

  function handleKnownChanged() {
    knownCache.clear();
    renderOverlay();
  }

  function openWord(index, tokens, tokenIndex) {
    lastWord = { index, tokens, tokenIndex };
    video.pause();
    popup.open({ mode: 'word', cues: shiftCues(cues, subOffset), index, tokens, tokenIndex, token: tokens[tokenIndex] });
  }

  function openSentence(index) {
    video.pause();
    seekTo(index);
    popup.open({ mode: 'sentence', cues: shiftCues(cues, subOffset), index });
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
    attempt(() => popup.quickMine(target, { direct }));
  }

  function mineSentence(direct) {
    if (activeIndex < 0) return;
    attempt(() => popup.quickMine({ mode: 'sentence', cues: shiftCues(cues, subOffset), index: activeIndex }, { direct }));
  }

  function toggleSubs() {
    subsOn = !subsOn;
    overlay.hidden = !subsOn;
    subsButton.textContent = subsOn ? 'Subtitles on' : 'Subtitles off';
  }

  function renderCues() {
    popup.close();
    badges = [];
    rows = cues.map((cue, i) => {
      const badge = h('span', { class: 'plus-one', hidden: true }, '+1');
      badges.push(badge);
      return h(
        'li',
        { class: 'cue', onclick: () => openSentence(i) },
        h('span', { class: 'cue-time' }, formatTime(cue.start)),
        h('span', { class: 'cue-text' }, cue.text),
        cue.jlpt
          ? h(
            'span',
            { class: ['N1', 'N2'].includes(cue.jlpt) ? 'jlpt-badge strong' : 'jlpt-badge', title: cue.words.join('、') },
            cue.jlpt,
          )
          : null,
        badge,
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
      );
    });
    fill(cueList, rows);
    setActive(findCueIndex(cues, video.currentTime - subOffset));
  }

  async function refreshAnki() {
    const status = await api.anki.status().catch(() => ({ connected: false }));
    if (!alive) return;
    ankiChip.textContent = status.connected ? `Anki · ${status.deck}` : 'Anki offline';
    ankiChip.classList.toggle('ok', status.connected);
  }
}
