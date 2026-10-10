import { attempt, fill, h, toast } from './lib/ui.mjs';

const api = window.api;
let reloadLibrary = null;

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
  const folderList = h('ul', { class: 'folders' });
  const showList = h('div', { class: 'shows' }, h('p', { class: 'muted' }, 'Scanning…'));

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
      h('details', { class: 'folders-box', open: true }, h('summary', {}, 'Folders'), folderList),
      showList,
    ),
  );

  function loadAll() {
    return attempt(async () => {
      const [folders, shows] = await Promise.all([api.library.getFolders(), api.library.getShows()]);
      renderFolders(folders);
      renderShows(shows);
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
    fill(showList, shows.map(showSection));
  }

  function showSection(show) {
    return h(
      'section',
      { class: 'show' },
      h('h2', {}, show.title),
      h('ul', { class: 'episodes' }, show.episodes.map(episodeRow)),
    );
  }

  function episodeRow(episode) {
    const linked = Boolean(episode.subtitlePath);
    return h(
      'li',
      { class: 'episode', onclick: () => onPlay(episode) },
      h('span', { class: 'ep-no' }, episodeLabel(episode)),
      h('span', { class: 'ep-name', title: episode.name }, episode.name),
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

  reloadLibrary = loadAll;
  loadAll();
  return () => {
    reloadLibrary = null;
  };
}
