// Library state is derived only from scan results and persisted reader progress.
export const LIBRARY_FILTERS = ['All', 'Reading', 'Unread', 'New', 'Finished'];
export const LIBRARY_SORTS = ['Recently read', 'Title'];
export function volumeProgress(volume, saved = {}) {
  const started = Number(saved.updatedAt) > 0;
  const total = Math.max(0, Number(volume.pageCount) || 0);
  const read = started ? Math.min(total, Math.max(0, Number(saved.page) || 0) + 1) : 0;
  return { started, read, total, percent: total ? 100 * read / total : 0, finished: started && total > 0 && read === total };
}
export function libraryRows(seriesList, progress = {}) {
  return seriesList.map(series => {
    const states = series.volumes.map(volume => volumeProgress(volume, progress[volume.id]));
    const recent = Math.max(0, ...series.volumes.map(v => Number(progress[v.id]?.updatedAt) || 0));
    const started = states.some(s => s.started);
    const finished = states.length > 0 && states.every(s => s.finished);
    const volume = [...series.volumes].sort((a, b) => (progress[b.id]?.updatedAt || 0) - (progress[a.id]?.updatedAt || 0))[0];
    const total = states.reduce((sum, s) => sum + s.total, 0);
    const read = states.reduce((sum, s) => sum + s.read, 0);
    return { series, volume, recent, started, finished, isNew: !started, percent: total ? read / total * 100 : 0 };
  });
}
export function filterLibrary(rows, { search = '', filter = 'All', sort = 'Recently read' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(row => row.series.title.toLocaleLowerCase().includes(query))
    .filter(row => filter === 'Reading' ? row.started && !row.finished : filter === 'Finished' ? row.finished : ['Unread', 'New'].includes(filter) ? !row.started : true)
    .sort((a, b) => (sort === 'Recently read' ? b.recent - a.recent : 0) || a.series.title.localeCompare(b.series.title, undefined, { numeric: true }));
}
export function libraryStats(rows) {
  return { titles: rows.length, volumes: rows.reduce((n, row) => n + row.series.volumes.length, 0), new: rows.filter(row => row.isNew).length };
}
export function volumeLabel(series, volume) {
  const numbered = volume?.title?.match(/(?:vol(?:ume)?[.\s_-]*|第)(\d+)/i) || volume?.title?.match(/^(\d+)(?:巻|\s|$)/);
  return `Vol ${numbered ? Number(numbered[1]) : series.volumes.findIndex(item => item.id === volume?.id) + 1}`;
}
