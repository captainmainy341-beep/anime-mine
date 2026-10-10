const fs = require('node:fs');
const path = require('node:path');

const FINISH_MARGIN = 20;
const MIN_RESUME = 10;

function byEpisode(a, b) {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || (a.name ?? '').localeCompare(b.name ?? '');
}

function findNextEpisode(shows, videoPath) {
  for (const show of shows) {
    const episodes = [...show.episodes].sort(byEpisode);
    const index = episodes.findIndex((episode) => episode.path === videoPath);
    if (index !== -1) return episodes[index + 1] ?? null;
  }
  return null;
}

class WatchProgress {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'progress.json');
  }

  read() {
    if (!fs.existsSync(this.file)) return { videos: {} };
    return { videos: {}, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
  }

  write(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, this.file);
  }

  get(video) {
    return this.read().videos[video] ?? null;
  }

  all() {
    return this.read().videos;
  }

  update(video, patch = {}) {
    const data = this.read();
    const current = data.videos[video] ?? {
      position: 0,
      duration: 0,
      updated: 0,
      subOffset: 0,
      audioStreamIndex: null,
      subtitle: null,
      finished: false,
    };
    const next = { ...current, ...patch, updated: Date.now() };
    if ('position' in patch) {
      const position = Math.max(0, Number(patch.position) || 0);
      next.finished = next.duration > 0 && position > next.duration - FINISH_MARGIN;
      next.position = next.finished ? 0 : position;
    }
    data.videos[video] = next;
    this.write(data);
    return next;
  }

  async continueWatching(shows, limit = 5) {
    const videos = this.all();
    const items = [];
    for (const show of shows) {
      for (const episode of show.episodes) {
        const entry = videos[episode.path];
        if (!entry || entry.finished || !(entry.position > MIN_RESUME)) continue;
        items.push({
          episode,
          showTitle: show.title,
          position: entry.position,
          duration: entry.duration,
          updated: entry.updated,
        });
      }
    }
    return items.sort((a, b) => b.updated - a.updated).slice(0, limit);
  }
}

module.exports = { WatchProgress, findNextEpisode };
