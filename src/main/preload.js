const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenScope', {
  getSources: () => ipcRenderer.invoke('get-sources'),

  startRegionSelect: (sourceId) =>
    ipcRenderer.invoke('start-region-select', sourceId),

  onRegionSelected: (callback) => {
    ipcRenderer.on('region-selected', (_event, region) => callback(region));
  },

  // Used by the region selector window
  confirmRegion: (region) => ipcRenderer.send('region-confirmed', region),
  cancelRegionSelect: () => ipcRenderer.send('region-cancelled'),

  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),

  platform: () => process.platform,
});
