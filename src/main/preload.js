const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const subscribe = (channel) => (cb) => {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  library: {
    getShows: invoke('library:getShows'),
    getFolders: invoke('library:getFolders'),
    addFolder: invoke('library:addFolder'),
    removeFolder: invoke('library:removeFolder'),
    linkSubtitle: invoke('library:linkSubtitle'),
    onUpdated: subscribe('library:updated'),
  },
  player: {
    loadCues: invoke('player:loadCues'),
  },
  nlp: {
    tokenize: invoke('nlp:tokenize'),
  },
  dict: {
    status: invoke('dict:status'),
    download: invoke('dict:download'),
    onProgress: subscribe('dict:progress'),
    lookup: invoke('dict:lookup'),
  },
  ai: {
    explain: invoke('ai:explain'),
  },
  anki: {
    status: invoke('anki:status'),
    mine: invoke('anki:mine'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
});
