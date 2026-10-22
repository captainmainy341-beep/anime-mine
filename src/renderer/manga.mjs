import { openReader } from './manga/reader.mjs';
import { createLimiter } from './lib/libraryView.mjs';
import { progressLabel } from './lib/mangaReader.mjs';
import { attempt, fill, h, toast } from './lib/ui.mjs';

import { inkHeader } from './lib/inkHeader.mjs';
import { doodle } from './lib/doodleIcons.mjs';
import { LIBRARY_FILTERS, LIBRARY_SORTS, libraryRows, filterLibrary, libraryStats, volumeLabel, volumeProgress } from './manga/libraryModel.mjs';

const api = window.api;
const coverLoad = createLimiter(3);
const PRIVACY =
  'When live OCR finds no text on a page, that page image is sent to the AI provider set in Settings. Off by default.';

export function mountManga(container) {
  let alive = true;
  let seriesList = [];
  let selected = null;
  let reader = null;
  let progress = {};
  let search = '';
  let filter = 'All';
  let sort = 'Recently read';
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
  const hero = inkHeader({ title: 'Manga' });
  hero.querySelector('.ink-hero-titleplate').append(h('span', { class: 'manga-ja', lang: 'ja' }, '漫画'));
  hero.append(h('div', { class: 'manga-head-actions' },
    h('button', { class: 'manga-ocr-button', onclick: () => { options.hidden = !options.hidden; } }, 'OCR options'),
    h('button', { onclick: addFolder }, 'Add folder', doodle('plus'))));
  const toolbar = h('div', { class: 'manga-toolbar' },
    h('label', { class: 'manga-search' }, doodle('search'), h('input', { type: 'search', placeholder: 'Search manga', 'aria-label': 'Search manga', oninput: event => { search = event.target.value; renderBody(); } })),
    h('div', { class: 'manga-filters', 'aria-label': 'Filter shelf' }, LIBRARY_FILTERS.map(name => h('button', { class: 'ink-toggle', 'aria-pressed': name === filter ? 'true' : 'false', onclick: event => {
      filter = name;
      for (const button of event.currentTarget.parentNode.children) button.setAttribute('aria-pressed', String(button === event.currentTarget));
      renderBody();
    } }, name))),
    h('button', { class: 'manga-sort', onclick: event => { sort = LIBRARY_SORTS[(LIBRARY_SORTS.indexOf(sort) + 1) % LIBRARY_SORTS.length]; event.currentTarget.textContent = `Sort: ${sort}`; renderBody(); } }, `Sort: ${sort}`));
  const root = h(
    'section',
    { class: 'page manga-view ink-screen' },
    hero,
    options,
    continueRow,
    toolbar,
    body,
    h('details', { class: 'ink-panel manga-folders' }, h('summary', {}, h('span', { class: 'ink-tag' }, 'Folders')), folderList,
      h('button', { class: 'small', onclick: loadAll }, doodle('sync'), ' Rescan folders')),
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
      const entries = await Promise.all(list.flatMap(series => series.volumes.map(async volume => [volume.id, await api.manga.getProgress(volume.id)])));
      if (!alive) return;
      progress = Object.fromEntries(entries);
      seriesList = list;
      selected = seriesList.find((series) => series.id === selected?.id) ?? null;
      aiBox.checked = settings.manga?.aiOcr === true;
      renderFolders(folders);
      renderBody();
      renderContinue(continued);
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
    const stats = libraryStats(libraryRows(seriesList, progress));
    fill(continueRow,
      coverFrame(series, volume, 0, false, true),
      h('div', { class: 'manga-continue-card ink-card' },
        h('span', { class: 'ink-tag' }, 'Continue reading'),
        h('h2', {}, series.title),
        h('p', { class: 'manga-meta' }, `${volume.title} · page ${continued.page + 1} of ${volume.pageCount}`),
        h('div', { class: 'manga-resume-row' }, track(volumeProgress(volume, progress[volume.id]).percent),
          h('button', { class: 'manga-resume', onclick: () => openVolumeReader(series, volume, continued.page) }, 'Resume', doodle('play')))),
      h('div', { class: 'manga-stats ink-card' }, Object.entries(stats).map(([label, value]) =>
        h('div', {}, h('strong', { class: label === 'new' ? 'manga-new-count' : '' }, value), h('span', {}, label)))));
  }

  function track(percent) {
    return h('span', { class: 'ink-track', role: 'progressbar', 'aria-label': 'Reading progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': Math.round(percent) }, h('i', { class: 'ink-track-fill', style: `width:${percent}%` }));
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
    toolbar.hidden = !!selected || !seriesList.length;
    if (!seriesList.length) return fill(body, emptyState());
    if (selected) return fill(body, seriesView(selected));
    const rows = filterLibrary(libraryRows(seriesList, progress), { search, filter, sort });
    const sections = [[rows.filter(row => row.started), 'On your shelf'], [rows.filter(row => !row.started), 'New in your folders']];
    fill(body, sections.filter(([items]) => items.length).map(([items, title]) => h('section', { class: 'manga-shelf' },
      h('h2', { class: 'ink-tag' }, title), h('div', { class: 'manga-grid' }, items.map(coverCard)))));
    if (!rows.length) fill(body, h('p', { class: 'manga-no-results', role: 'status' }, 'No titles match your filters.'));
  }

  function coverCard(row, index) {
    const { series, volume } = row;
    const card = h(
      'button',
      { class: 'manga-cover', onclick: () => { selected = series; renderBody(); } },
      coverFrame(series, volume, index, row.isNew),
      h('span', { class: 'manga-cover-title' }, series.title),
      h('span', { class: 'manga-meta' }, `${volumeLabel(series, volume)} · ${row.finished ? 'Finished' : row.started ? progressLabel([progress[volume.id]?.page ?? 0], volume.pageCount) : 'Unread'}`),
      track(row.percent),
    );
    return card;
  }

  function coverFrame(series, volume, index, isNew = false, eager = false) {
    const img = h('img', { class: 'manga-cover-img', alt: '', hidden: true });
    const card = h('div', { class: `manga-cover-frame manga-pattern-${index % 4}` },
      h('span', { class: 'manga-cover-pattern' }),
      h('span', { class: 'manga-cover-letter' }, series.title.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/u)?.[0]?.slice(0, 4) || series.title.split(/\s+/)[0]),
      h('span', { class: 'manga-cover-caption' }, series.title), img,
      h('span', { class: 'manga-vol-tag' }, volumeLabel(series, volume).toUpperCase()),
      isNew && h('span', { class: 'ink-stamp' }, 'NEW!'));
    if (volume) {
      const load = () => loadCover(img, series, volume);
      if (covers && !eager) {
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
        if (!alive || !dataUrl) return;
        img.onload = () => {
          if (!alive) return;
          img.hidden = false;
          img.parentElement?.classList.add('has-cover');
        };
        img.onerror = () => {
          img.hidden = true;
          img.parentElement?.classList.remove('has-cover');
        };
        img.src = dataUrl;
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
