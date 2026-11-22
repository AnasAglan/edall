'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const isPlatform = location.origin === 'https://edall.lovable.app';
const isOfflinePage = location.protocol === 'file:' && /\/offline\.html$/i.test(location.pathname);

if (process.isMainFrame && isPlatform) {
  contextBridge.exposeInMainWorld('edallDesktop', Object.freeze({
    isDesktop: true,
    version: '2.0.0',
    getYoutubeFormats: (id, force = false) =>
      ipcRenderer.invoke('edall:formats', id, force === true),
    setVideoFullscreen: (enabled) =>
      ipcRenderer.invoke('edall:video-fullscreen', enabled === true),
    downloadOffline: (id, height) =>
      ipcRenderer.invoke('edall:download-offline', id, Number(height)),
    openOfflineLibrary: () =>
      ipcRenderer.invoke('edall:open-offline-library')
  }));
} else if (process.isMainFrame && isOfflinePage) {
  contextBridge.exposeInMainWorld('edallDesktop', Object.freeze({
    isDesktop: true,
    version: '2.0.0',
    listOfflineDownloads: () =>
      ipcRenderer.invoke('edall:list-offline'),
    deleteOfflineDownload: (id) =>
      ipcRenderer.invoke('edall:delete-offline', id),
    returnToPlatform: () =>
      ipcRenderer.invoke('edall:return-to-platform')
  }));
}
