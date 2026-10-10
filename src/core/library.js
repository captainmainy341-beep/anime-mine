const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { findBestVideo, parseMediaName } = require('./matcher');

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.m4v', '.webm', '.avi']);
const SUBTITLE_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt']);
const SETTLE_MS = 800;

async function listFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

function fileSize(file) {
  return fsp.stat(file).then(stat => stat.size, () => null);
}

function byEpisode(a, b) {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.name.localeCompare(b.name);
}

// Japanese-tagged subtitles outrank untagged ones.
function rank(lang) {
  return lang === 'ja' ? 2 : 1;
}

// Best sidecar per video from sorted subtitle files. Subtitles tagged with a non-Japanese language are skipped.
function pickSidecars(files, videos) {
  const picked = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const { lang } = parseMediaName(name);
    if (lang && lang !== 'ja') continue;
    const match = findBestVideo(name, videos);
    if (!match) continue;
    const current = picked.get(match.video.path);
    if (!current || rank(lang) > rank(current.lang)) picked.set(match.video.path, { file, lang });
  }
  return picked;
}

class Library {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'library.json');
    this.subsDir = path.join(dataDir, 'subs');
  }

  // `manual` (video paths linked by hand) and `auto` (video path -> { lang, origin, source }) may be
  // missing in files written by older versions; defaults keep those files loadable.
  load() {
    const saved = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    return { folders: [], links: {}, manual: [], auto: {}, ...saved };
  }

  save(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, this.file);
  }

  getFolders() {
    return this.load().folders;
  }

  addFolder(dir) {
    const data = this.load();
    const folder = path.resolve(dir);
    if (data.folders.includes(folder)) return;
    data.folders.push(folder);
    this.save(data);
  }

  removeFolder(dir) {
    const data = this.load();
    const folder = path.resolve(dir);
    data.folders = data.folders.filter(item => item !== folder);
    this.save(data);
  }

  // Whether a sidecar may be stored for videoPath. Manual links are never replaced, and neither are
  // links without auto metadata (legacy entries). An auto link is replaced only by a better-ranked
  // sidecar, or by a refresh from the watcher of the same file it already came from.
  canLink(data, videoPath, { lang, origin, refresh = false }) {
    if (data.manual.includes(videoPath)) return false;
    if (!data.links[videoPath]) return true;
    const current = data.auto[videoPath];
    if (!current) return false;
    if (refresh && current.source === 'watch' && current.origin === origin) return true;
    return rank(lang) > rank(current.lang);
  }

  async scan() {
    const folders = this.getFolders();
    const files = [...new Set((await Promise.all(folders.map(listFiles))).flat())].sort();
    const videos = files
      .filter(file => VIDEO_EXTS.has(path.extname(file).toLowerCase()))
      .map(file => ({ path: file, name: path.basename(file) }));
    const subtitles = files.filter(file => SUBTITLE_EXTS.has(path.extname(file).toLowerCase()));

    // Read state only after the async traversal and decide synchronously, so links saved meanwhile survive.
    const data = this.load();
    let changed = false;
    for (const [videoPath, { file, lang }] of pickSidecars(subtitles, videos)) {
      if (!this.canLink(data, videoPath, { lang, origin: file })) continue;
      data.links[videoPath] = file;
      data.auto[videoPath] = { lang, origin: file, source: 'scan' };
      changed = true;
    }
    if (changed) this.save(data);

    const shows = new Map();
    for (const video of videos) {
      const media = parseMediaName(video.name);
      const episode = {
        path: video.path,
        name: video.name,
        season: media.season,
        episode: media.episode,
        subtitlePath: data.links[video.path] ?? null,
      };
      shows.set(media.title, [...(shows.get(media.title) ?? []), episode]);
    }
    return [...shows]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, episodes]) => ({ title, episodes: episodes.sort(byEpisode) }));
  }

  copySubtitle(videoPath, subtitlePath) {
    fs.mkdirSync(this.subsDir, { recursive: true });
    const key = crypto.createHash('sha1').update(videoPath).digest('hex').slice(0, 12);
    const stored = path.join(this.subsDir, `${key}-${path.basename(subtitlePath)}`);
    fs.copyFileSync(subtitlePath, stored);
    return stored;
  }

  linkSubtitle(videoPath, subtitlePath) {
    const stored = this.copySubtitle(videoPath, subtitlePath);
    const data = this.load();
    data.links[videoPath] = stored;
    if (!data.manual.includes(videoPath)) data.manual.push(videoPath);
    delete data.auto[videoPath];
    this.save(data);
    return stored;
  }

  async autoLinkSubtitle(subtitlePath, { refresh = false } = {}) {
    const { lang } = parseMediaName(path.basename(subtitlePath));
    if (lang && lang !== 'ja') return null;
    const episodes = (await this.scan()).flatMap(show => show.episodes);
    const videos = episodes.map(({ path: videoPath, name }) => ({ path: videoPath, name }));
    const match = findBestVideo(path.basename(subtitlePath), videos);
    if (!match) return null;
    const videoPath = match.video.path;
    const data = this.load();
    if (!this.canLink(data, videoPath, { lang, origin: subtitlePath, refresh })) return null;
    const stored = this.copySubtitle(videoPath, subtitlePath);
    data.links[videoPath] = stored;
    data.auto[videoPath] = { lang, origin: subtitlePath, source: 'watch' };
    this.save(data);
    const episode = episodes.find(item => item.path === videoPath);
    return { ...episode, subtitlePath: stored };
  }

  getSubtitle(videoPath) {
    return this.load().links[videoPath] ?? null;
  }

  watchDownloads(dir, onLinked) {
    const timers = new Map();

    const check = async (file, previousSize) => {
      const size = await fileSize(file);
      if (size === null) {
        timers.delete(file);
        return;
      }
      if (size !== previousSize) return schedule(file, size);
      timers.delete(file);
      // refresh: a file modified after being linked updates the copy this watcher stored.
      const episode = await this.autoLinkSubtitle(file, { refresh: true }).catch(() => null);
      if (episode) onLinked(episode, episode.subtitlePath);
    };

    const schedule = (file, size) => {
      timers.set(file, setTimeout(check, SETTLE_MS, file, size));
    };

    let watcher;
    try {
      watcher = fs.watch(dir, (_event, name) => {
        if (!name || !SUBTITLE_EXTS.has(path.extname(name).toLowerCase())) return;
        const file = path.join(dir, name);
        clearTimeout(timers.get(file));
        schedule(file, -1);
      });
    } catch (error) {
      console.warn(`Downloads folder cannot be watched (${dir}): ${error.message}`);
      return () => {};
    }
    watcher.on('error', error => console.warn(`Downloads watcher failed (${dir}): ${error.message}`));

    return () => {
      watcher.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }
}

module.exports = { Library };
