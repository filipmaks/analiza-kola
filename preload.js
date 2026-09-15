// The only bridge between the window and the app. The page gets intents, never Node or Electron.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const channels = ['ready', 'savePreferences', 'dismissError', 'scanToday', 'acceptNewLeagues', 'rejectNewLeagues',
  'useOnlyTodayLeagues', 'saveKey', 'loadModels', 'selectModel', 'start', 'resume', 'cancel', 'getReport',
  'deleteReport', 'openExternal', 'export'];

const api = Object.fromEntries(channels.map(name => [name, call(name)]));
api.onState = callback => {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('state', listener);
  return () => ipcRenderer.removeListener('state', listener);
};
contextBridge.exposeInMainWorld('fp', api);
