import { attempt, fill, h, toast } from './lib/ui.mjs';
import { coverageLabel, createLimiter, progressFraction } from './lib/libraryView.mjs';

const api = window.api;
let reloadLibrary = null;
const progressLoad = createLimiter(4);
const coverageLoad = createLimiter(2);

api.library.onUpdated((event) => {
  toast(event?.message ?? 'Subtitle linked automatically', 'success');
  reloadLibrary?.();
});

const pad = (n) => String(n).padStart(2, '0');

function episodeLabel({ season, episode }) {
  const parts = [season == null ? '' : `S${pad(season)}`, episode == null ? '' : `E${pad(episode)}`];
  return parts.join('') || '—';
}

export function mountLibrary(container, { onPlay }) {
  const continueRow = h('section', { class: 'continue', hidden: true });
  const folderList = h('ul', { class: 'folders' });
  const showList = h('div', { class: 'shows' }, h('p', { class: 'muted' }, 'Scanning…'));
  let loadSeq = 0;
  let continueSeq = 0;

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
      h('details', { class: 'folders-box', open: true }, h('summary', {}, 'Folders'), folderList),
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
    fill(showList, shows.map((show) => showSection(show, rows)));
    for (const { row, episode } of rows) hydrateRow(row, episode);
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
          h('span', { class: 'badge ok ep-watched', hidden: true }, 'Watched'),
          h('span', { class: 'chip ep-chip', hidden: true }),
        ),
      ),
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

  function hydrateRow(row, episode) {
    progressLoad(async () => {
      if (!row.isConnected) return;
      showProgress(row, await api.progress.get(episode.path));
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

  function setChip(row, { text }) {
    const chip = row.querySelector('.ep-chip');
    chip.hidden = !text;
    chip.textContent = text ?? '';
  }

  reloadLibrary = loadAll;
  loadAll();
  return () => {
    reloadLibrary = null;
  };
}
