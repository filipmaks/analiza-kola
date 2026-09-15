// Fudbalski pregled — desktop (Windows) entry point.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const C = require('./src/core/core.js');
const { LocalStore } = require('./src/main/store.js');
const { SecretStore } = require('./src/main/secrets.js');
const { Engine } = require('./src/main/engine.js');

// Diagnostics: FP_USER_DATA isolates data; --render <file.png> [--view settings|history] [--click <selector>] [--dark] snapshots the window.
if (process.env.FP_USER_DATA) app.setPath('userData', process.env.FP_USER_DATA);
const argument = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const renderTarget = argument('--render');

app.setAppUserModelId('rs.fudbalskipregled.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let engine = null;
let pending = null;
let sentRevision = -1;

function applyTheme() {
  if (renderTarget && process.argv.includes('--dark')) return;
  nativeTheme.themeSource = engine?.state.preferences.theme || 'system';
}

// State is pushed at most every 150 ms; a full report travels only when it changed.
function push() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    if (!win || win.isDestroyed()) return;
    const includeReport = engine.reportRevision !== sentRevision;
    sentRevision = engine.reportRevision;
    applyTheme();
    win.webContents.send('state', engine.snapshot(includeReport));
  }, 150);
}

const safeExternal = url => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['www.flashscore.com', 'flashscore.com', 'platform.openai.com'].includes(u.hostname);
  } catch { return false; }
};

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 940, minHeight: 640,
    title: 'Fudbalski pregled', backgroundColor: nativeTheme.shouldUseDarkColors ? '#15191d' : '#f3f4f2', show: false,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.removeMenu();
  win.once('ready-to-show', () => { if (!renderTarget) win.show(); });
  if (renderTarget) {
    win.webContents.once('did-finish-load', async () => {
      const view = argument('--view');
      if (process.argv.includes('--dark')) nativeTheme.themeSource = 'dark';
      await new Promise(r => setTimeout(r, 900));
      if (view) await win.webContents.executeJavaScript(`document.querySelector('[data-to="${view}"]')?.click()`);
      const click = argument('--click');
      if (click) await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(click)})?.click()`);
      await new Promise(r => setTimeout(r, 700));
      fs.writeFileSync(renderTarget, (await win.webContents.capturePage()).toPNG());
      app.exit(0);
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function handlers() {
  const on = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));
  on('ready', () => { sentRevision = engine.reportRevision; applyTheme(); return Object.assign(engine.snapshot(true), { version: app.getVersion() }); });
  on('savePreferences', patch => engine.savePreferences(patch));
  on('dismissError', () => engine.dismissError());
  on('scanToday', () => { engine.scanToday(); });
  on('acceptNewLeagues', () => engine.acceptNewLeagues());
  on('rejectNewLeagues', () => engine.rejectNewLeagues());
  on('useOnlyTodayLeagues', () => engine.useOnlyTodayLeagues());
  on('saveKey', value => engine.saveKey(value));
  on('loadModels', () => engine.loadModels());
  on('selectModel', model => engine.selectModel(model));
  on('start', () => engine.start());
  on('resume', id => engine.resume(id));
  on('cancel', () => engine.cancel());
  on('getReport', id => engine.getReport(id));
  on('deleteReport', id => engine.deleteReport(id));
  on('openExternal', url => { if (safeExternal(url)) shell.openExternal(url); });
  on('export', async (id, format) => {
    const report = engine.getReport(id);
    if (!report) return { ok: false, message: 'Izveštaj nije pronađen.' };
    const markdown = format !== 'json';
    const stamp = C.dateText(report.createdAt, false).replace(/\./g, '-').replace(/-$/, '');
    const result = await dialog.showSaveDialog(win, {
      title: 'Izvezi analizu',
      defaultPath: path.join(app.getPath('documents'), `fudbalski-pregled-${stamp}.${markdown ? 'md' : 'json'}`),
      filters: markdown ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const data = markdown ? C.reportMarkdown(report, engine.allLeagues) : JSON.stringify(report, (key, value) =>
        ['createdAt', 'windowEnd', 'kickoff', 'fetchedAt'].includes(key) && typeof value === 'number' ? new Date(value).toISOString() : value, 2);
      fs.writeFileSync(result.filePath, data, 'utf8');
      return { ok: true, message: `Sačuvano: ${result.filePath}` };
    } catch (error) {
      return { ok: false, message: `Izvoz nije uspeo: ${error.message}` };
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const root = path.join(app.getPath('userData'), 'data');
  let store;
  try {
    store = new LocalStore(root);
    store.prune();
  } catch (error) {
    dialog.showErrorBox('Nije moguće otvoriti lokalnu bazu', `Podaci nisu obrisani.\n\n${error.message}`);
    app.exit(1);
    return;
  }
  engine = new Engine({ store, secrets: new SecretStore(path.join(app.getPath('userData'), 'secrets')), adapterPath: path.join(__dirname, 'resources', 'Flashscore.js'), onChange: push });
  handlers();
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => engine?.shutdown());
app.on('window-all-closed', () => app.quit());
