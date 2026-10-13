const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame && location.origin === 'https://edall.lovable.app') {
  contextBridge.exposeInMainWorld('edallDesktop', Object.freeze({
    isDesktop: true,
    version: '2.0.0',
    getYoutubeFormats: (id, force = false) => ipcRenderer.invoke('edall:formats', id, force === true)
  }));
}