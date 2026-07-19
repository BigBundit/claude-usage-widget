const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  onRefresh: (cb) => ipcRenderer.on('refresh', cb),
  quit: () => ipcRenderer.send('quit'),
  resizeHeight: (h) => ipcRenderer.send('resize-height', h),
});
