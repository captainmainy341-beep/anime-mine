const api = globalThis.browser ?? globalThis.chrome;

const portInput = document.getElementById('port');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('status');
const connEl = document.getElementById('conn');
const enableButton = document.getElementById('enable');

const SITE_SCRIPT_ID = 'anime-mine-dynamic';

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function setConnection(kind, text) {
  connEl.textContent = text;
  connEl.className = kind;
}

function readInputs() {
  const port = Number(portInput.value) || 8767;
  return { port, token: tokenInput.value.trim() };
}

async function save() {
  const { port, token } = readInputs();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setStatus('Port must be between 1 and 65535', 'bad');
    return false;
  }
  await api.storage.local.set({ port, token });
  return true;
}

async function checkConnection() {
  const reply = await api.runtime.sendMessage({ type: 'ping' });
  if (reply?.ok) setConnection('ok', 'Connected');
  else setConnection('bad', 'App not reachable');
  return reply;
}

async function testConnection() {
  if (!(await save())) return;
  setStatus('Testing...');
  const reply = await checkConnection();
  if (!reply?.ok) {
    setStatus(`Not reachable: ${reply?.error ?? 'no response'}`, 'bad');
    return;
  }
  const { dictReady, ankiConnected } = reply.data;
  const dict = dictReady ? 'dictionary ready' : 'dictionary not ready';
  const anki = ankiConnected ? 'Anki connected' : 'Anki not connected';
  setStatus(`Connected - ${dict}, ${anki}`, dictReady && ankiConnected ? 'ok' : 'bad');
}

async function init() {
  const { port, token } = await api.storage.local.get({ port: 8767, token: '' });
  portInput.value = port;
  tokenInput.value = token;
  checkConnection();
}

document.getElementById('save').addEventListener('click', async () => {
  if (await save()) setStatus('Saved', 'ok');
});
document.getElementById('test').addEventListener('click', testConnection);

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostsOf(patterns) {
  return patterns.map((pattern) => pattern.replace(/^[^:]+:\/\//, '').replace(/\/\*$/, ''));
}

let pending = null;

function framesList() {
  return document.getElementById('frames');
}

async function refreshEnableButton() {
  const tab = await activeTab();
  const frames = (await api.webNavigation.getAllFrames({ tabId: tab.id })) ?? [];
  const [top] = AnimeMineSites.originPatterns([tab.url]);
  const embedded = AnimeMineSites.originPatterns(frames.map((frame) => frame.url)).filter((p) => p !== top);
  pending = { tab, top, embedded };

  const list = framesList();
  list.replaceChildren();
  if (embedded.length) {
    const hint = document.createElement('div');
    hint.textContent = "Video player in another site's frame? Tick its host:";
    list.append(hint);
    for (const pattern of embedded) {
      const label = document.createElement('label');
      label.className = 'frame';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = pattern;
      label.append(box, ` ${hostsOf([pattern])[0]}`);
      list.append(label);
    }
  }

  if (!top) return;
  const registered = await api.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
  const active = registered[0]?.matches ?? [];
  const granted = await api.permissions.contains({ origins: [top] });
  if (granted && active.includes(top)) enableButton.textContent = 'Enabled here - update';
}

async function enableSite() {
  if (!pending?.top) {
    setStatus("This page can't be enabled", 'bad');
    return;
  }
  const { tab, top } = pending;
  const chosen = [...framesList().querySelectorAll('input:checked')].map((box) => box.value);
  const patterns = [top, ...chosen];
  const granted = await api.permissions.request({ origins: patterns });
  if (!granted) {
    setStatus('Permission denied', 'bad');
    return;
  }

  const reply = await api.runtime.sendMessage({ type: 'syncSites' });
  if (!reply?.ok) {
    setStatus(`Could not enable: ${reply?.error ?? 'no response'}`, 'bad');
    return;
  }

  enableButton.textContent = 'Enabled here - update';
  setStatus(`Enabled on ${hostsOf(patterns).join(', ')}. Reload the page if captions don't appear.`, 'ok');
}

enableButton.addEventListener('click', enableSite);

init();
refreshEnableButton();
