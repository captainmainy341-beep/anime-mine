import { attempt, fill, h, toast } from './lib/ui.mjs';
import { cleanupLabel, coverageLabel, createLimiter, progressFraction } from './lib/libraryView.mjs';
import { openPrep } from './learn/prep.mjs';

const api = window.api;
let reloadLibrary = null;
const progressLoad = createLimiter(4);
const coverageLoad = createLimiter(2);

api.library.onUpdated((event) => {
  toast(event?.message ?? 'Subtitle linked automatically', 'success');
  reloadLibrary?.();
});

api.desub.onDone(() => toast('Subtitle-free copy ready', 'success'));

const pad = (n) => String(n).padStart(2, '0');

function episodeLabel({ season, episode }) {
  const parts = [season == null ? '' : `S${pad(season)}`, episode == null ? '' : `E${pad(episode)}`];
  return parts.join('') || '—';
}

export function mountLibrary(container, { onPlay }) {
  const continueRow = h('section', { class: 'continue', hidden: true });
  const folderList = h('ul', { class: 'folders' });
  const foldersBox = h('details', { class: 'folders-box', open: true, hidden: true }, h('summary', {}, 'Folders'), folderList);
  const showList = h('div', { class: 'shows' }, h('p', { class: 'muted' }, 'Scanning…'));
  let loadSeq = 0;
  let continueSeq = 0;
  let closePrep = null;
  const rowsByPath = new Map();
  const cleanupStates = new Map();
  const offDesub = [
    api.desub.onProgress(({ videoPath, fraction }) => updateRow(videoPath, { kind: 'cleaning', fraction })),
    api.desub.onDone(({ videoPath }) => updateRow(videoPath, { kind: 'ready' })),
    api.desub.onError(({ videoPath }) => updateRow(videoPath, { kind: 'error' })),
  ];

  container.append(
    h(
      'section',
      { class: 'page' },
      h(
        'div',
        { class: 'page-head' },
        h('h1', {}, 'Library'),
        h('button', { class: 'primary', onclick: () => changeFolders(() => api.library.addFolder()) }, 'Add folder'),
      ),
      continueRow,
      foldersBox,
      showList,
    ),
  );

  function loadAll() {
    loadContinue();
    const seq = ++loadSeq;
    return attempt(async () => {
      const [folders, shows] = await Promise.all([api.library.getFolders(), api.library.getShows()]);
      if (seq !== loadSeq) return;
      renderFolders(folders);
      renderShows(shows);
    });
  }

  function loadContinue() {
    const seq = ++continueSeq;
    return attempt(async () => {
      const items = await api.progress.continueWatching();
      if (seq !== continueSeq) return;
      renderContinue(items);
    });
  }

  function changeFolders(task) {
    return attempt(async () => {
      renderShows(await task());
      renderFolders(await api.library.getFolders());
    });
  }

  function openPrepFor(episode) {
    closePrep?.();
    closePrep = openPrep({ videoPath: episode.path, title: episode.name });
  }

  function linkSubtitle(episode) {
    return attempt(async () => {
      const stored = await api.library.linkSubtitle(episode.path);
      if (!stored) return;
      toast('Subtitle linked', 'success');
      await loadAll();
    });
  }

  function renderContinue(items) {
    continueRow.hidden = items.length === 0;
    fill(
      continueRow,
      h('h2', {}, 'Continue watching'),
      h('div', { class: 'continue-list' }, items.map(continueCard)),
    );
  }

  function continueCard({ episode, showTitle, position, duration }) {
    const percent = Math.round(progressFraction(position, duration) * 100);
    return h(
      'button',
      { class: 'continue-card', onclick: () => onPlay(episode) },
      h('span', { class: 'continue-show' }, showTitle),
      h('span', { class: 'continue-ep' }, episodeLabel(episode)),
      h('span', { class: 'progress' }, h('span', { class: 'progress-fill', style: `width: ${percent}%` })),
    );
  }

  function renderFolders(folders) {
    foldersBox.hidden = folders.length === 0;
    if (!folders.length) {
      fill(folderList, h('li', { class: 'muted' }, 'No folders yet.'));
      return;
    }
    fill(
      folderList,
      folders.map((dir) =>
        h(
          'li',
          {},
          h('span', { class: 'path', title: dir }, dir),
          h('button', { class: 'ghost small', onclick: () => changeFolders(() => api.library.removeFolder(dir)) }, 'Remove'),
        ),
      ),
    );
  }

  function renderShows(shows) {
    if (!shows.length) {
      fill(
        showList,
        h(
          'div',
          { class: 'empty' },
          h('p', {}, 'No anime found yet.'),
          h('p', { class: 'muted' }, 'Add a folder with your video files. Subtitles next to them are linked automatically.'),
        ),
      );
      return;
    }
    const rows = [];
    rowsByPath.clear();
    fill(showList, shows.map((show) => showSection(show, rows)));
    const desub = api.desub.status().catch(() => null);
    for (const { row, episode } of rows) hydrateRow(row, episode, desub);
  }

  function showSection(show, rows) {
    return h(
      'section',
      { class: 'show' },
      h('h2', {}, show.title),
      h(
        'ul',
        { class: 'episodes' },
        show.episodes.map((episode) => {
          const row = episodeRow(episode);
          rowsByPath.set(episode.path, row);
          rows.push({ row, episode });
          return row;
        }),
      ),
    );
  }

  function episodeRow(episode) {
    const linked = Boolean(episode.subtitlePath);
    return h(
      'li',
      { class: 'episode', onclick: () => onPlay(episode) },
      h('span', { class: 'ep-no' }, episodeLabel(episode)),
      h(
        'span',
        { class: 'ep-main' },
        h('span', { class: 'ep-name', title: episode.name }, episode.name),
        h(
          'span',
          { class: 'ep-meta' },
          h('span', { class: 'progress ep-bar', hidden: true }, h('span', { class: 'progress-fill' })),
          h(
            'span',
            { class: 'ep-clean', hidden: true },
            h('span', { class: 'ep-clean-label' }),
            h('span', { class: 'progress ep-clean-bar', hidden: true }, h('span', { class: 'progress-fill' })),
          ),
          h('span', { class: 'badge ok ep-watched', hidden: true }, 'Watched'),
          h('span', { class: 'chip ep-chip', hidden: true }),
        ),
      ),
      linked
        ? h(
            'button',
            {
              class: 'ghost small',
              onclick: (e) => {
                e.stopPropagation();
                openPrepFor(episode);
              },
            },
            'Prep',
          )
        : null,
      h('span', { class: `badge ${linked ? 'ok' : 'warn'}` }, linked ? 'Linked' : 'Missing'),
      linked
        ? null
        : h(
            'button',
            {
              class: 'ghost small',
              onclick: (e) => {
                e.stopPropagation();
                linkSubtitle(episode);
              },
            },
            'Link subtitle',
          ),
    );
  }

  function hydrateRow(row, episode, desub) {
    progressLoad(async () => {
      if (!row.isConnected) return;
      showProgress(row, await api.progress.get(episode.path));
    }).catch(() => {});

    if (cleanupStates.has(episode.path)) setCleanup(row, cleanupStates.get(episode.path));

    progressLoad(async () => {
      if (!row.isConnected) return;
      const status = await desub;
      let state = null;
      if (status?.current?.video === episode.path) state = { kind: 'cleaning', fraction: status.current.fraction };
      else if (status?.queued?.includes(episode.path)) state = { kind: 'queued' };
      else if (await api.desub.isClean(episode.path)) state = { kind: 'ready' };
      // A live event that arrived while this snapshot was loading is newer than the snapshot.
      if (state && !cleanupStates.has(episode.path) && row.isConnected) {
        cleanupStates.set(episode.path, state);
        setCleanup(row, state);
      }
    }).catch(() => {});

    if (!episode.subtitlePath) return;
    setChip(row, { text: 'analysing…' });
    coverageLoad(async () => {
      if (!row.isConnected) return;
      setChip(row, { text: coverageLabel(await api.known.coverage({ videoPath: episode.path })) });
    }).catch(() => setChip(row, { text: null }));
  }

  function showProgress(row, entry) {
    const finished = Boolean(entry?.finished);
    const fraction = entry && !finished ? progressFraction(entry.position, entry.duration) : 0;
    const bar = row.querySelector('.ep-bar');
    bar.hidden = fraction <= 0;
    bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    row.querySelector('.ep-watched').hidden = !finished;
  }

  function updateRow(videoPath, state) {
    cleanupStates.set(videoPath, state);
    const row = rowsByPath.get(videoPath);
    if (row?.isConnected) setCleanup(row, state);
  }

  function setCleanup(row, state) {
    const label = cleanupLabel(state);
    const box = row.querySelector('.ep-clean');
    box.hidden = label === null;
    box.classList.toggle('ready', state?.kind === 'ready');
    box.classList.toggle('failed', state?.kind === 'error');
    row.querySelector('.ep-clean-label').textContent = label ?? '';
    const bar = row.querySelector('.ep-clean-bar');
    bar.hidden = state?.kind !== 'cleaning';
    if (state?.kind === 'cleaning') bar.firstElementChild.style.width = `${Math.round(state.fraction * 100)}%`;
  }

  function setChip(row, { text }) {
    const chip = row.querySelector('.ep-chip');
    chip.hidden = !text;
    chip.textContent = text ?? '';
  }

  reloadLibrary = loadAll;
  loadAll();
  return () => {
    reloadLibrary = null;
    closePrep?.();
    closePrep = null;
    for (const off of offDesub) off();
  };
}
