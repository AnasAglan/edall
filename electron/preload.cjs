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
    downloadOffline: (id, height, courseId, lessonId, accessToken, supabaseUrl, publishableKey) =>
      ipcRenderer.invoke('edall:download-offline', id, Number(height), courseId, lessonId, accessToken, supabaseUrl, publishableKey),
    openOfflineLibrary: (userId) =>
      ipcRenderer.invoke('edall:open-offline-library', userId),
    setOfflineAccount: (userId, accessToken, supabaseUrl, publishableKey, revision) =>
      ipcRenderer.invoke('edall:set-offline-account', userId, accessToken, supabaseUrl, publishableKey, Number(revision)),
    clearOfflineAccount: (revision) =>
      ipcRenderer.invoke('edall:clear-offline-account', Number(revision))
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
