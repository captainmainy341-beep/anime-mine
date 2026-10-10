const path = require('path');
const { fileURLToPath } = require('url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createServices } = require('./services');

const APP_FILE = path.join(__dirname, '..', 'renderer', 'index.html');
let services = null;

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && fileURLToPath(parsed) === APP_FILE;
  } catch {
    return false;
  }
}

function send(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.loadFile(APP_FILE);
}

function registerHandlers(handlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAppUrl(event.senderFrame?.url)) throw new Error(`Blocked IPC from untrusted frame: ${channel}`);
      return handler(...args);
    });
  }
}

app.whenReady()
  .then(async () => {
    services = createServices({ dataDir: app.getPath('userData'), dialog, notify: send });
    registerHandlers(services.handlers);
    await services.start();
    createWindow();
  })
  .catch((err) => {
    dialog.showErrorBox('anime-mine failed to start', err.message);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => services?.stop());
