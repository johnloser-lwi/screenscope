const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenScope', {
  getSources: () => ipcRenderer.invoke('get-sources'),

  startRegionSelect: (sourceId) =>
    ipcRenderer.invoke('start-region-select', sourceId),

  onRegionSelected: (callback) => {
    ipcRenderer.on('region-selected', (_event, region) => callback(region));
  },

  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },

  refreshSources: () => ipcRenderer.send('refresh-sources'),

  // Used by the region selector window
  confirmRegion: (region) => ipcRenderer.send('region-confirmed', region),
  cancelRegionSelect: () => ipcRenderer.send('region-cancelled'),

  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.send('set-settings', partial),

  // Lets main mirror the renderer's layout state for its menu checkmarks
  notifyLayout: (state) => ipcRenderer.send('layout-changed', state),

  platform: () => process.platform,
});
