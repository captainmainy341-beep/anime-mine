const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_PORT = 8767;
const TIMEOUT_MS = 8000;

async function getConfig() {
  const stored = await api.storage.local.get({ port: DEFAULT_PORT, token: '' });
  const port = Number(stored.port) || DEFAULT_PORT;
  return { port, token: stored.token || '' };
}

async function bridge(path, { method = 'GET', body } = {}) {
  const { port, token } = await getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Anime Mine app did not respond in time');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function captureJpeg(sender) {
  const dataUrl = await api.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'jpeg', quality: 70 });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

const SITE_SCRIPT_ID = 'anime-mine-dynamic';
const CONTENT_JS = ['lib/captions.js', 'lib/subs.js', 'content.js'];
const CONTENT_CSS = ['content.css'];
const STATIC_ORIGINS = new Set(api.runtime.getManifest().host_permissions ?? []);

async function syncSites() {
  const { origins = [] } = await api.permissions.getAll();
  const sites = origins.filter((o) => /^https?:\/\//.test(o) && !STATIC_ORIGINS.has(o)).sort();
  const registered = await api.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
  if (!sites.length) {
    if (registered.length) await api.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT_ID] });
    return { sites };
  }
  const script = {
    id: SITE_SCRIPT_ID,
    matches: sites,
    js: CONTENT_JS,
    css: CONTENT_CSS,
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
  if (registered.length) await api.scripting.updateContentScripts([script]);
  else await api.scripting.registerContentScripts([script]);

  for (const tab of await api.tabs.query({ url: sites })) {
    const target = { tabId: tab.id, allFrames: true };
    await api.scripting.executeScript({ target, files: CONTENT_JS }).catch(() => {});
    await api.scripting.insertCSS({ target, files: CONTENT_CSS }).catch(() => {});
  }
  return { sites };
}

api.permissions.onAdded.addListener(() => syncSites().catch((err) => console.warn('Anime Mine sync failed', err)));
api.permissions.onRemoved.addListener(() => syncSites().catch((err) => console.warn('Anime Mine sync failed', err)));

async function handle(message, sender) {
  switch (message?.type) {
    case 'syncSites':
      return syncSites();
    case 'ping':
      return bridge('/ping');
    case 'lookup':
      return bridge('/lookup', { method: 'POST', body: { text: message.text, offset: message.offset } });
    case 'subtitles':
      return bridge('/subtitles', { method: 'POST', body: { title: message.title, season: message.season, episode: message.episode } });
    case 'mine': {
      const payload = { ...message.payload };
      let pictureError;
      if (message.capture) {
        try {
          payload.pictureBase64 = await captureJpeg(sender);
          payload.pictureExt = 'jpg';
        } catch (err) {
          pictureError = err?.message || String(err);
        }
      }
      const data = await bridge('/mine', { method: 'POST', body: payload });
      return pictureError ? { ...data, pictureError } : data;
    }
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: err.message || String(err) }),
  );
  return true;
});
