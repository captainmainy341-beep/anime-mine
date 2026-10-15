import { openReader } from './manga/reader.mjs';
import { createLimiter } from './lib/libraryView.mjs';
import { progressLabel } from './lib/mangaReader.mjs';
import { attempt, fill, h, toast } from './lib/ui.mjs';

const api = window.api;
const coverLoad = createLimiter(3);
const PRIVACY =
  'When live OCR finds no text on a page, that page image is sent to the AI provider set in Settings. Off by default.';

export function mountManga(container) {
  let alive = true;
  let seriesList = [];
  let selected = null;
  let reader = null;
  const indexRows = new Map();
  const pendingCovers = new Map();
  const covers = 'IntersectionObserver' in window ? new IntersectionObserver(onCoverVisible, { rootMargin: '200px' }) : null;

  const continueRow = h('section', { class: 'manga-continue', hidden: true });
  const body = h('div', { class: 'manga-body' });
  const folderList = h('ul', { class: 'manga-folder-list' });
  const aiBox = h('input', { type: 'checkbox', onchange: saveAi });
  const options = h(
    'div',
    { class: 'manga-options', hidden: true },
    h('label', { class: 'manga-option' }, aiBox, h('span', {}, 'AI OCR fallback (sends page images to your configured AI provider)')),
    h('p', { class: 'muted' }, PRIVACY),
  );
  const root = h(
    'section',
    { class: 'page manga-view' },
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Manga'),
      h(
        'div',
        { class: 'manga-head-actions' },
        h('button', { class: 'ghost', onclick: () => { options.hidden = !options.hidden; } }, 'OCR options'),
        h('button', { class: 'primary', onclick: addFolder }, 'Add folder'),
      ),
    ),
    options,
    continueRow,
    body,
    h('details', { class: 'folders-box manga-folders' }, h('summary', {}, 'Folders'), folderList),
  );
  container.append(root);

  const unsubscribe = api.manga.onIndexProgress(onIndexProgress);
  loadAll();

  function loadAll() {
    return attempt(async () => {
      const [list, folders, settings, continued] = await Promise.all([
        api.manga.getSeries(),
        api.manga.getFolders(),
        api.settings.get(),
        api.manga.continueReading(),
      ]);
      if (!alive) return;
      seriesList = list;
      selected = seriesList.find((series) => series.id === selected?.id) ?? null;
      aiBox.checked = settings.manga?.aiOcr === true;
      renderFolders(folders);
      renderContinue(continued);
      renderBody();
    });
  }

  function findVolume(seriesId, volId) {
    const series = seriesList.find((item) => item.id === seriesId);
    const volume = series?.volumes.find((item) => item.id === volId);
    return series && volume ? { series, volume } : null;
  }

  function renderContinue(continued) {
    const found = continued && findVolume(continued.seriesId, continued.volId);
    continueRow.hidden = !found;
    if (!found) return fill(continueRow);
    const { series, volume } = found;
    fill(
      continueRow,
      h('h2', {}, 'Continue reading'),
      h(
        'button',
        { class: 'manga-continue-card', onclick: () => openVolumeReader(series, volume, continued.page) },
        h('span', { class: 'manga-continue-title' }, series.title),
        h('span', { class: 'muted' }, volume.title),
        h('span', { class: 'manga-progress-label' }, progressLabel([continued.page], volume.pageCount)),
      ),
    );
  }

  function renderFolders(folders) {
    if (!folders.length) return fill(folderList, h('li', { class: 'muted' }, 'No folders yet.'));
    fill(
      folderList,
      folders.map((dir) =>
        h(
          'li',
          {},
          h('span', { class: 'path', title: dir }, dir),
          h('button', { class: 'ghost small', onclick: () => removeFolder(dir) }, 'Remove'),
        ),
      ),
    );
  }

  function renderBody() {
    covers?.disconnect();
    pendingCovers.clear();
    indexRows.clear();
    if (!seriesList.length) return fill(body, emptyState());
    if (selected) return fill(body, seriesView(selected));
    fill(body, h('div', { class: 'manga-grid' }, seriesList.map(coverCard)));
  }

  function coverCard(series) {
    const img = h('img', { class: 'manga-cover-img', alt: '' });
    const count = series.volumes.length;
    const card = h(
      'button',
      { class: 'manga-cover', onclick: () => { selected = series; renderBody(); } },
      h('div', { class: 'manga-cover-frame' }, img),
      h('span', { class: 'manga-cover-title' }, series.title),
      h('span', { class: 'muted' }, `${count} ${count === 1 ? 'volume' : 'volumes'}`),
    );
    const first = series.volumes[0];
    if (first) {
      const load = () => loadCover(img, series, first);
      if (covers) {
        pendingCovers.set(card, load);
        covers.observe(card);
      } else {
        load();
      }
    }
    return card;
  }

  function onCoverVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const load = pendingCovers.get(entry.target);
      pendingCovers.delete(entry.target);
      covers.unobserve(entry.target);
      load?.();
    }
  }

  function loadCover(img, series, volume) {
    return coverLoad(() => api.manga.page({ seriesId: series.id, volId: volume.id, index: 0 }))
      .then(({ dataUrl }) => {
        if (alive) img.src = dataUrl;
      })
      .catch(() => {});
  }

  function seriesView(series) {
    return h(
      'div',
      { class: 'manga-series' },
      h(
        'div',
        { class: 'manga-series-head' },
        h('button', { class: 'ghost small', onclick: () => { selected = null; renderBody(); } }, 'All series'),
        h('h2', {}, series.title),
      ),
      h('ul', { class: 'manga-volumes' }, series.volumes.map((volume) => volumeRow(series, volume))),
    );
  }

  function volumeRow(series, volume) {
    const label = h('span', { class: 'muted manga-progress-label' }, 'Loading…');
    const bar = h('span', { class: 'manga-bar', hidden: true }, h('span', { class: 'manga-bar-fill' }));
    const indexBtn = h('button', { class: 'small', onclick: () => indexVolume(series, volume) }, 'Index vocabulary');
    const cancelBtn = h('button', { class: 'ghost small', hidden: true, onclick: () => api.manga.cancelIndex(volume.id) }, 'Cancel');
    indexRows.set(volume.id, { bar, indexBtn, cancelBtn, fill: bar.firstChild });
    api.manga
      .getProgress(volume.id)
      .then((saved) => {
        if (alive) label.textContent = progressLabel([saved.page], volume.pageCount);
      })
      .catch(() => {});
    return h(
      'li',
      { class: 'manga-volume' },
      h('div', { class: 'manga-volume-main' }, h('span', { class: 'manga-volume-title' }, volume.title), label),
      h(
        'div',
        { class: 'manga-volume-actions' },
        h('button', { class: 'small primary', onclick: () => readVolume(series, volume) }, 'Read'),
        indexBtn,
        cancelBtn,
      ),
      bar,
    );
  }

  function readVolume(series, volume) {
    return attempt(async () => {
      const saved = await api.manga.getProgress(volume.id);
      openVolumeReader(series, volume, saved.page);
    });
  }

  function openVolumeReader(series, volume, page) {
    reader?.close();
    reader = openReader(root, {
      series,
      volume,
      startPage: page,
      onClose: () => {
        reader = null;
        if (alive) loadAll();
      },
    });
  }

  async function indexVolume(series, volume) {
    const setBusy = (busy) => {
      const row = indexRows.get(volume.id);
      if (!row) return;
      row.indexBtn.disabled = busy;
      row.cancelBtn.hidden = !busy;
      row.bar.hidden = !busy;
    };
    setBusy(true);
    setProgress(volume.id, 0, 1);
    try {
      const result = await api.manga.index({ seriesId: series.id, volId: volume.id });
      if (result.cancelled) toast('Indexing cancelled');
      else toast(`Indexed ${result.sentences} sentences`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function setProgress(volId, done, total) {
    const row = indexRows.get(volId);
    if (row) row.fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }

  function onIndexProgress({ volId, done, total }) {
    setProgress(volId, done, total);
  }

  function addFolder() {
    return attempt(async () => {
      await api.manga.addFolder();
      await loadAll();
    });
  }

  function removeFolder(dir) {
    return attempt(async () => {
      await api.manga.removeFolder(dir);
      await loadAll();
    });
  }

  async function saveAi(event) {
    const box = event.target;
    try {
      await api.settings.set({ manga: { aiOcr: box.checked } });
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message, 'error');
    }
  }

  function emptyState() {
    return h(
      'div',
      { class: 'manga-empty' },
      h('h2', {}, 'No manga yet'),
      h('p', {}, 'Add a folder that contains your manga. Supported layouts:'),
      h(
        'ul',
        {},
        h('li', {}, 'A folder of page images (jpg, png, webp and similar). Each subfolder is one volume.'),
        h('li', {}, '.cbz, .zip or .pdf volumes containing page images.'),
        h('li', {}, 'Optional mokuro sidecar files next to a volume, for Japanese text blocks.'),
      ),
      h('button', { class: 'primary', onclick: addFolder }, 'Add folder'),
    );
  }

  return () => {
    alive = false;
    unsubscribe();
    covers?.disconnect();
    reader?.close();
    root.remove();
  };
}
