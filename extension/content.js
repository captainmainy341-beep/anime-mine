(() => {
  if (window.__animeMineContent) return;
  window.__animeMineContent = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const C = globalThis.AnimeMineCaptions;
  const S = globalThis.AnimeMineSubs;
  const HOST = location.hostname;
  const SOURCE_HIDDEN = 'anime-mine-source-hidden';
  const CARD_SENSES = 4;
  const AUTO_MAX_FAILURES = 4;
  const AUTO_RETRY_MS = 15000;
  const AUTO_JIMAKU_SKIP = /(^|\.)(netflix|youtube)\.com$/;

  const state = {
    owner: null,
    text: '',
    shownAt: null,
    lastBeat: 0,
    sources: [],
    lookups: new Map(),
    cardToken: 0,
    cardSnapshot: null,
    pausedVideo: null,
    mining: false,
    lastPausedAt: 0,
    statusEl: null,
  };
  let overlay = null;
  let card = null;
  let bar = null;
  let ext = null;
  let tickTimer = null;
  let lastMouse = 0;
  let barHideTimer = null;
  let barMessageTimer = null;
  let fileInput = null;
  let barMessage = '';
  let autoAttempt = { key: null, failures: 0, retryAt: 0 };
  let jimakuBusy = false;

  const trackHooked = new WeakSet();
  const videoWatched = new WeakSet();
  const originalMode = new WeakMap();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function grabFrame() {
    const video = ext?.video?.isConnected ? ext.video : largestVideo();
    if (!video || !video.videoWidth || video.readyState < 2) return null;
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.8);
      return url.slice(url.indexOf(',') + 1);
    } catch {
      return null;
    }
  }

  function send(message) {
    return api.runtime.sendMessage(message).catch((err) => ({ ok: false, error: err.message }));
  }

  function mountRoot() {
    return document.fullscreenElement || document.body;
  }

  function remount() {
    const root = mountRoot();
    for (const node of [overlay, card, bar]) {
      if (node && node.parentNode !== root) root.appendChild(node);
    }
  }

  function stopEvent(e) {
    e.stopPropagation();
  }

  function ensureOverlay() {
    if (!overlay) {
      overlay = el('div');
      overlay.id = 'anime-mine-caption';
      overlay.style.display = 'none';
      overlay.addEventListener('mousedown', stopEvent);
      overlay.addEventListener('mouseover', onCharHover);
      overlay.addEventListener('mouseleave', () => {
        if (!state.cardSnapshot) highlight(null);
      });
      overlay.addEventListener('click', onCharClick);
    }
    const root = mountRoot();
    if (overlay.parentNode !== root) root.appendChild(overlay);
    return overlay;
  }

  function ensureCard() {
    if (!card) {
      card = el('div');
      card.id = 'anime-mine-card';
      card.style.display = 'none';
      card.addEventListener('mousedown', stopEvent);
      card.addEventListener('click', stopEvent);
    }
    const root = mountRoot();
    if (card.parentNode !== root) root.appendChild(card);
    return card;
  }

  function largestVideo() {
    let best = null;
    let bestArea = 0;
    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      if (rect.width * rect.height > bestArea) {
        best = video;
        bestArea = rect.width * rect.height;
      }
    }
    return best;
  }

  function visibleVideoRect() {
    const video = largestVideo();
    return video?.getBoundingClientRect() ?? { left: 0, width: window.innerWidth, bottom: window.innerHeight, height: window.innerHeight };
  }

  function positionBar() {
    if (!bar) return;
    const rect = visibleVideoRect();
    bar.style.top = `${Math.max(0, rect.top) + 8}px`;
    bar.style.left = `${rect.left + rect.width - 8}px`;
  }

  function positionOverlay() {
    positionBar();
    if (!overlay || overlay.style.display === 'none') return;
    const rect = visibleVideoRect();
    overlay.style.left = `${rect.left + rect.width / 2}px`;
    overlay.style.bottom = `${window.innerHeight - rect.bottom + rect.height * 0.06}px`;
    positionCard();
  }

  function positionCard() {
    if (!card || card.style.display === 'none') return;
    const rect = overlay && overlay.style.display !== 'none' ? overlay.getBoundingClientRect() : null;
    card.style.left = `${rect ? rect.left + rect.width / 2 : window.innerWidth / 2}px`;
    card.style.bottom = `${rect ? window.innerHeight - rect.top + 12 : window.innerHeight * 0.2}px`;
  }

  function renderOverlay(text) {
    const node = ensureOverlay();
    node.replaceChildren(
      ...C.charSpans(text).map(({ char, index }) => {
        const span = el('span', null, char);
        span.dataset.i = String(index);
        return span;
      }),
    );
    node.style.display = '';
  }

  function highlight(range) {
    if (!overlay) return;
    for (const node of overlay.children) {
      const i = Number(node.dataset.i);
      node.classList.toggle('anime-mine-hl', Boolean(range) && i >= range.start && i < range.end);
    }
  }

  function unhideSources() {
    for (const node of state.sources) node.classList.remove(SOURCE_HIDDEN);
    state.sources = [];
  }

  function clearCaption() {
    unhideSources();
    state.owner = null;
    state.text = '';
    state.shownAt = null;
    state.lookups = new Map();
    if (overlay) {
      overlay.style.display = 'none';
      overlay.replaceChildren();
    }
  }

  function setCaption(owner, rawText, sources) {
    if (ext && owner !== 'file') return;
    const text = C.normalizeCaption(rawText);
    if (!C.hasJapanese(text)) {
      if (owner === 'file' || owner === state.owner) clearCaption();
      return;
    }
    if (owner !== state.owner || text !== state.text) {
      state.owner = owner;
      state.text = text;
      state.shownAt = Date.now();
      if (state.shownAt - state.lastBeat > 60000) {
        state.lastBeat = state.shownAt;
        send({ type: 'ping' });
      }
      state.lookups = new Map();
      renderOverlay(text);
    }
    unhideSources();
    state.sources = sources;
    for (const node of sources) node.classList.add(SOURCE_HIDDEN);
    positionOverlay();
  }

  function readLines(root, selector) {
    const leaves = Array.from(root.querySelectorAll(selector)).filter((node) => !node.querySelector(selector));
    const parts = leaves.length ? leaves : [root];
    return parts.map((node) => node.textContent).join('\n');
  }

  function scanNetflix() {
    const node = document.querySelector('.player-timedtext');
    setCaption('netflix', node ? readLines(node, 'div') : '', node ? [node] : []);
  }

  function scanYouTube() {
    const windows = Array.from(document.querySelectorAll('.ytp-caption-window-container'));
    const segments = Array.from(document.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment'));
    setCaption('youtube', segments.map((node) => node.textContent).join('\n'), windows);
  }

  function scanCueSpans() {
    const cues = Array.from(document.querySelectorAll('.vp-cue'));
    const windows = [...new Set(cues.map((node) => node.parentElement))];
    setCaption('cuespan', cues.map((node) => node.textContent).join('\n'), windows);
  }

  function onCueChange(track) {
    const cues = track.activeCues ? Array.from(track.activeCues) : [];
    const text = cues.map((cue) => cue.text).join('\n');
    const wanted = C.hasJapanese(text) ? 'hidden' : originalMode.get(track);
    if (track.mode !== 'disabled' && track.mode !== wanted) track.mode = wanted;
    setCaption('track', text, []);
  }

  function hookVideos() {
    for (const video of document.querySelectorAll('video')) {
      const tracks = video.textTracks;
      if (!tracks) continue;
      if (!videoWatched.has(video)) {
        videoWatched.add(video);
        tracks.addEventListener('addtrack', hookVideos);
        tracks.addEventListener('change', hookVideos);
      }
      for (const track of tracks) {
        if (trackHooked.has(track) || track.mode === 'disabled') continue;
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
        trackHooked.add(track);
        originalMode.set(track, track.mode);
        track.addEventListener('cuechange', () => onCueChange(track));
      }
    }
  }

  function attachVideo(video) {
    if (!ext || video === ext.video) return;
    ext.video?.removeEventListener('timeupdate', tick);
    ext.video = video;
    video?.addEventListener('timeupdate', tick);
  }

  function tick() {
    if (!ext) return;
    if (!ext.video?.isConnected) attachVideo(largestVideo());
    const cue = ext.video ? S.findCue(ext.cues, ext.video.currentTime + ext.offset) : null;
    setCaption('file', cue ? cue.text : '', []);
  }

  let loadToken = 0;

  async function loadSubtitles(file, source = 'manual') {
    const token = ++loadToken;
    let cues = [];
    try {
      cues = S.parseSubtitles(S.decodeSubtitleBytes(await file.arrayBuffer()), file.name);
    } catch {
      cues = [];
    }
    if (token !== loadToken) return;
    if (source === 'jimaku-auto' && ext && ext.source !== 'jimaku-auto') return;
    if (!cues.length) {
      showBarMessage('No subtitles found in that file');
      return;
    }
    attachVideo(null);
    clearInterval(tickTimer);
    ext = { cues, name: file.name, offset: 0, video: null, source };
    document.documentElement.classList.add('anime-mine-file-mode');
    attachVideo(largestVideo());
    tickTimer = setInterval(tick, 100);
    tick();
    renderBar();
  }

  function removeSubtitles() {
    loadToken++;
    document.documentElement.classList.remove('anime-mine-file-mode');
    attachVideo(null);
    clearInterval(tickTimer);
    tickTimer = null;
    ext = null;
    clearCaption();
    renderBar();
  }

  function readEpisode() {
    const h1 = document.querySelector('.vp-container h1');
    if (!h1) {
      const title = C.cleanTitle(document.title).split(/\s+[|\-\u2013\u2014]\s+/)[0].trim();
      return title ? { title, season: null, episode: null, fromPlayer: false } : null;
    }
    const title = h1.textContent.trim();
    if (!title) return null;
    let label = h1.parentElement?.nextElementSibling?.textContent ?? '';
    if (!label) {
      const walker = document.createTreeWalker(document.querySelector('.vp-container'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (/S\d+\s*E\d+|Episode\s*\d+/i.test(node.textContent)) {
          label = node.textContent;
          break;
        }
      }
    }
    const { season, episode } = C.parseEpisodeLabel(label);
    return { title, season, episode, fromPlayer: true };
  }

  const episodeKey = (info) => (info ? `${info.title}|${info.season}|${info.episode}` : null);

  async function fetchJimaku({ auto }) {
    if (jimakuBusy) return 'busy';
    const info = readEpisode();
    if (!info) {
      if (!auto) showBarMessage('No title found on this page');
      return 'none';
    }
    const key = episodeKey(info);
    const generation = loadToken;
    jimakuBusy = true;
    const reply = await send({ type: 'subtitles', title: info.title, season: info.season, episode: info.episode });
    jimakuBusy = false;
    if (generation !== loadToken || episodeKey(readEpisode()) !== key) return 'stale';
    if (!reply?.ok) {
      if (!auto) showBarMessage(reply?.error || 'Jimaku lookup failed');
      return 'error';
    }
    if (!reply.data?.found) {
      if (!auto) showBarMessage('No Jimaku subtitles found');
      return 'missing';
    }
    const { name, dataBase64 } = reply.data;
    const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
    await loadSubtitles(new File([bytes], name), auto ? 'jimaku-auto' : 'jimaku');
    if (ext) ext.key = key;
    return 'loaded';
  }

  function autoJimaku() {
    if (jimakuBusy || AUTO_JIMAKU_SKIP.test(HOST) || !largestVideo()) return;
    if (ext && ext.source !== 'jimaku-auto') return;
    if (!ext && state.owner) return;
    const info = readEpisode();
    const key = info?.fromPlayer && info.episode !== null ? episodeKey(info) : null;
    if (!key) return;
    if (ext?.key === key) return;
    if (key !== autoAttempt.key) autoAttempt = { key, failures: 0, retryAt: 0 };
    if (autoAttempt.done || autoAttempt.failures >= AUTO_MAX_FAILURES || Date.now() < autoAttempt.retryAt) return;
    if (ext) removeSubtitles();
    const attempt = autoAttempt;
    fetchJimaku({ auto: true }).then((result) => {
      if (result === 'error') {
        attempt.failures++;
        attempt.retryAt = Date.now() + AUTO_RETRY_MS * 2 ** (attempt.failures - 1);
      } else if (result === 'loaded' || result === 'missing') {
        attempt.done = true;
      }
    });
  }

  function ensureBar() {
    if (!bar) {
      bar = el('div');
      bar.id = 'anime-mine-bar';
      bar.addEventListener('mousedown', stopEvent);
      bar.addEventListener('click', stopEvent);
    }
    const root = mountRoot();
    if (bar.parentNode !== root) root.appendChild(bar);
    return bar;
  }

  function formatOffset() {
    return `${ext.offset > 0 ? '+' : ''}${ext.offset.toFixed(1)}s`;
  }

  function shiftOffset(delta) {
    ext.offset = Math.round((ext.offset + delta) * 10) / 10;
    tick();
    renderBar();
  }

  function openPicker() {
    if (!fileInput) {
      fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = '.srt,.vtt,.ass,.ssa,.txt';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) loadSubtitles(file);
      });
      document.documentElement.appendChild(fileInput);
    }
    fileInput.click();
  }

  function renderBar() {
    ensureBar();
    bar.replaceChildren();
    if (ext) {
      bar.append(
        el('span', 'anime-mine-bar-name', ext.name),
        actionButton('\u2212', () => shiftOffset(-0.5)),
        el('span', 'anime-mine-bar-offset', formatOffset()),
        actionButton('+', () => shiftOffset(0.5)),
        actionButton('Remove', removeSubtitles),
      );
    } else {
      bar.append(actionButton('Subtitles', openPicker), actionButton('Jimaku', () => fetchJimaku({ auto: false })));
    }
    if (barMessage) bar.append(el('span', 'anime-mine-bar-msg', barMessage));
    positionBar();
    updateBarVisibility();
  }

  function showBarMessage(text) {
    barMessage = text;
    clearTimeout(barMessageTimer);
    barMessageTimer = setTimeout(() => {
      barMessage = '';
      renderBar();
    }, 4000);
    renderBar();
  }

  function updateBarVisibility() {
    if (!bar) return;
    const cardOpen = Boolean(card) && card.style.display !== 'none';
    const recent = Date.now() - lastMouse < 3000;
    const hovered = Boolean(ext) && bar.matches(':hover');
    const show = Boolean(largestVideo()) && (recent || cardOpen || hovered);
    if (show) positionBar();
    bar.classList.toggle('anime-mine-bar-visible', show);
  }

  function onMouseMove() {
    lastMouse = Date.now();
    updateBarVisibility();
    clearTimeout(barHideTimer);
    barHideTimer = setTimeout(updateBarVisibility, 3000);
  }

  function subtitleFileFrom(dataTransfer) {
    return Array.from(dataTransfer?.files ?? []).find((file) => /\.(srt|vtt|ass|ssa)$/i.test(file.name)) ?? null;
  }

  function scan() {
    if (/(^|\.)netflix\.com$/.test(HOST)) scanNetflix();
    else if (/(^|\.)youtube\.com$/.test(HOST)) scanYouTube();
    else scanCueSpans();
    hookVideos();
    autoJimaku();
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  });

  function lookupAt(text, offset) {
    const cache = text === state.text ? state.lookups : null;
    if (cache?.has(offset)) return cache.get(offset);
    const pending = send({ type: 'lookup', text, offset }).then((reply) => {
      if (!reply?.ok) throw new Error(reply?.error || 'Lookup failed');
      return reply.data;
    });
    if (cache) {
      cache.set(offset, pending);
      pending.catch(() => cache.delete(offset));
    }
    return pending;
  }

  function offsetOf(node) {
    return node instanceof HTMLElement && node.dataset.i !== undefined ? Number(node.dataset.i) : null;
  }

  function onCharHover(e) {
    if (!e.isTrusted) return;
    const offset = offsetOf(e.target);
    if (offset === null || state.cardSnapshot) return;
    const text = state.text;
    lookupAt(text, offset).then(
      (result) => {
        if (text !== state.text || state.cardSnapshot) return;
        highlight(result.span ? C.pickWordRange(text, result.span) : null);
      },
      () => {},
    );
  }

  function onCharClick(e) {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    const offset = offsetOf(e.target);
    if (offset !== null) openCard(state.text, offset);
  }

  function resumeVideo() {
    if (!state.pausedVideo) return;
    state.pausedVideo.play().catch(() => {});
    state.pausedVideo = null;
  }

  function setBusy(busy) {
    state.mining = busy;
    const wordAllowed = Boolean(state.cardSnapshot?.result?.span);
    for (const button of card?.querySelectorAll('button[data-mine]') ?? []) {
      button.disabled = busy || (button.dataset.mine === 'word' && !wordAllowed);
    }
  }

  function setStatus(text, ok = false) {
    if (!state.statusEl) return;
    state.statusEl.textContent = text;
    state.statusEl.className = ok ? 'anime-mine-card-status anime-mine-ok' : 'anime-mine-card-status';
  }

  function actionButton(label, onClick) {
    const button = el('button', null, label);
    button.type = 'button';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.isTrusted) return;
      onClick();
    });
    return button;
  }

  function renderCard(result, error) {
    const node = ensureCard();
    node.replaceChildren();
    const span = result?.span ?? null;
    const entry = result?.entries?.[0] ?? null;

    if (error) {
      node.appendChild(el('div', 'anime-mine-card-empty', error));
    } else if (!span) {
      node.appendChild(el('div', 'anime-mine-card-empty', 'No dictionary entry here'));
    } else {
      node.appendChild(el('div', 'anime-mine-card-word', result.dictForm || span.text));
      const reading = entry?.kana?.[0];
      if (reading) node.appendChild(el('div', 'anime-mine-card-reading', reading));
      const senses = el('ol', 'anime-mine-card-senses');
      for (const sense of (entry?.senses ?? []).slice(0, CARD_SENSES)) {
        const pos = sense.pos?.length ? `(${sense.pos.join(', ')}) ` : '';
        senses.appendChild(el('li', 'anime-mine-card-sense', pos + (sense.glosses ?? []).join('; ')));
      }
      node.appendChild(senses);
      if (result.inflection?.length) {
        const chips = el('div', 'anime-mine-chips');
        for (const label of result.inflection) chips.appendChild(el('span', 'anime-mine-chip', label));
        node.appendChild(chips);
      }
    }

    const mineWord = actionButton('Mine word', () => mine('word'));
    mineWord.dataset.mine = 'word';
    const mineSentence = actionButton('Mine sentence', () => mine('sentence'));
    mineSentence.dataset.mine = 'sentence';
    const buttons = el('div', 'anime-mine-card-buttons');
    buttons.append(mineWord, mineSentence, actionButton('Close', closeCard));
    node.appendChild(buttons);

    state.statusEl = el('div', 'anime-mine-card-status');
    node.appendChild(state.statusEl);
    setBusy(false);
  }

  function positionAndHighlight(text, result) {
    highlight(result?.span ? C.pickWordRange(text, result.span) : null);
    positionCard();
  }

  async function openCard(text, offset) {
    const token = ++state.cardToken;
    state.cardSnapshot = null;
    if (!state.pausedVideo) {
      const playing = Array.from(document.querySelectorAll('video')).find((v) => !v.paused);
      if (playing) {
        playing.pause();
        state.pausedVideo = playing;
      }
    }
    const node = ensureCard();
    node.style.display = '';
    node.replaceChildren(el('div', 'anime-mine-card-empty', 'Looking up...'));
    positionCard();

    let result = null;
    let error = null;
    try {
      result = await lookupAt(text, offset);
    } catch (err) {
      error = err.message;
    }
    if (token !== state.cardToken) return;
    state.cardSnapshot = { text, result };
    renderCard(result, error);
    positionAndHighlight(text, result);
  }

  function closeCard() {
    state.cardToken++;
    state.cardSnapshot = null;
    state.mining = false;
    if (card) card.style.display = 'none';
    highlight(null);
    resumeVideo();
  }

  async function mine(mode) {
    const snapshot = state.cardSnapshot;
    if (!snapshot || state.mining) return;
    if (mode === 'word' && !snapshot.result?.span) return;
    const token = state.cardToken;
    const frame = grabFrame();
    const cue = ext?.video ? S.findCue(ext.cues, ext.video.currentTime + ext.offset) : null;
    const playingNow = Array.from(document.querySelectorAll('video')).some((v) => !v.paused);
    let captionEndedAt = playingNow || !state.lastPausedAt ? Date.now() : state.lastPausedAt;
    if (cue && snapshot.text === state.text && state.shownAt) {
      captionEndedAt = Math.min(captionEndedAt, state.shownAt + (cue.end - cue.start) * 1000);
    }
    const payload = C.buildMinePayload({
      mode,
      text: snapshot.text,
      lookupResult: snapshot.result,
      title: document.title,
      captionShownAt: snapshot.text === state.text ? state.shownAt : null,
      captionEndedAt,
      pictureBase64: frame,
    });
    setBusy(true);
    setStatus('Mining...');
    const reply = await send({ type: 'mine', payload, capture: !frame });
    setBusy(false);
    if (token !== state.cardToken) return;
    const pictureError = reply?.data?.pictureError;
    setStatus(
      reply?.ok ? (pictureError ? `Added without picture: ${pictureError}` : 'Added') : reply?.error || 'Mining failed',
      Boolean(reply?.ok),
    );
  }

  function onKey(e) {
    if (!e.isTrusted) return;
    if (!card || card.style.display === 'none') return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeCard();
    } else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
      mine('word');
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
      mine('sentence');
    }
  }

  function showNotice() {
    const notice = el('div', 'anime-mine-notice');
    notice.appendChild(
      el('span', null, 'Anime Mine app not reachable - open the app and check the token in the extension popup'),
    );
    const close = el('button', 'anime-mine-notice-close', '×');
    close.type = 'button';
    close.addEventListener('click', () => notice.remove());
    notice.appendChild(close);
    mountRoot().appendChild(notice);
  }

  async function init() {
    const reply = await send({ type: 'ping' });
    if (!reply?.ok && window.top === window) showNotice();
    scan();
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', positionOverlay);
    window.addEventListener('scroll', () => { positionOverlay(); positionBar(); }, true);
    document.addEventListener('fullscreenchange', () => {
      remount();
      positionOverlay();
    });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pause', (e) => {
      if (e.target instanceof HTMLVideoElement) state.lastPausedAt = Date.now();
    }, true);
    ensureBar();
    renderBar();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    }, true);
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      const file = subtitleFileFrom(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      loadSubtitles(file);
    }, true);
  }

  init();
})();
