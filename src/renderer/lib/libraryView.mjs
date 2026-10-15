// Pure helpers for the library and settings views. No DOM access, so they run under node --test.

const MB = 1024 ** 2;
const GB = 1024 ** 3;

export function formatBytes(bytes) {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (n >= GB) return `${(n / GB).toFixed(2)} GB`;
  return `${(n / MB).toFixed(1)} MB`;
}

export function formatNumber(n) {
  const whole = Number.isFinite(n) ? Math.trunc(n) : 0;
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function progressFraction(position, duration) {
  if (!(duration > 0) || !Number.isFinite(position)) return 0;
  return Math.min(1, Math.max(0, position / duration));
}

export function cleanupLabel(state) {
  switch (state?.kind) {
    case 'cleaning':
      return `Cleaning ${Math.round(Math.min(1, Math.max(0, state.fraction)) * 100)}%`;
    case 'queued':
      return 'Queued';
    case 'ready':
      return 'Clean copy ready';
    case 'error':
      return 'Cleanup failed';
    default:
      return null;
  }
}

// coverage: the object returned by known:coverage, or null when the episode has no subtitle.
export function coverageLabel(coverage) {
  if (!coverage || !(coverage.totalWords > 0)) return null;
  const pct = Math.round(coverage.coverage * 100);
  const count = coverage.uniqueNew;
  return `${pct}% known · ${formatNumber(count)} new ${count === 1 ? 'word' : 'words'}`;
}

export function knownStatsLabel({ known = 0, learning = 0 } = {}) {
  return `${formatNumber(known)} known · ${formatNumber(learning)} learning`;
}

export function importSummary({ added = 0, skipped = 0 } = {}) {
  return `Imported ${formatNumber(added)} words (${formatNumber(skipped)} skipped)`;
}

// Runs tasks with at most `concurrency` in flight; a task starts on a later microtask, never synchronously.
export function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { task, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}
