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
  media: {
    probe: invoke('media:probe'),
    prepare: invoke('media:prepare'),
    cancel: invoke('media:cancel'),
    cacheInfo: invoke('media:cacheInfo'),
    clearCache: invoke('media:clearCache'),
    onProgress: subscribe('media:progress'),
  },
  known: {
    stats: invoke('known:stats'),
    ankiFields: invoke('known:ankiFields'),
    importAnki: invoke('known:importAnki'),
    importText: invoke('known:importText'),
    mark: invoke('known:mark'),
    classify: invoke('known:classify'),
    coverage: invoke('known:coverage'),
  },
  lookup: {
    at: invoke('lookup:at'),
  },
  pitch: {
    status: invoke('pitch:status'),
    download: invoke('pitch:download'),
    onProgress: subscribe('pitch:progress'),
  },
  progress: {
    get: invoke('progress:get'),
    update: invoke('progress:update'),
    continueWatching: invoke('progress:continue'),
    next: invoke('progress:next'),
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
    translate: invoke('ai:translate'),
  },
  anki: {
    status: invoke('anki:status'),
    mine: invoke('anki:mine'),
    getView: invoke('anki:getView'),
    setView: invoke('anki:setView'),
    listDecks: invoke('anki:listDecks'),
    overview: invoke('anki:overview'),
    browse: invoke('anki:browse'),
    media: invoke('anki:media'),
    setup: invoke('anki:setup'),
    recent: invoke('anki:recent'),
    updateNote: invoke('anki:updateNote'),
    deleteNote: invoke('anki:deleteNote'),
    openInAnki: invoke('anki:openInAnki'),
    preview: invoke('anki:preview'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
});
