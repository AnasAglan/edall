'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('electron/main.cjs', 'utf8');
const preload = fs.readFileSync('electron/preload.cjs', 'utf8');
const html = fs.readFileSync('public/ed_master.html', 'utf8');
const library = fs.readFileSync('electron/offline-library.cjs', 'utf8');

test('the desktop verifies the current Supabase account before trusting an offline account ID', () => {
  expect(main).toContain("new URL('/auth/v1/user', backend.origin)");
  expect(main).toContain("profile.id !== userId");
  expect(main).toContain("Authorization: 'Bearer ' + accessToken");
  expect(main).toContain("ipcMain.handle('edall:set-offline-account'");
  expect(main).toContain("offlineLibrary.rememberAccount(verifiedUserId)");
  expect(main).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
});

test('offline account changes are ordered and logout clears remembered ownership', () => {
  expect(main).toContain('revision <= offlineAccountSyncRevision');
  expect(main).toContain("ipcMain.handle('edall:clear-offline-account'");
  expect(main).toContain('await offlineLibrary.clearRememberedAccount()');
  expect(main).toContain('activeOfflineUserId = null');
  expect(main).toContain('activeOfflineUserId = await offlineLibrary.getRememberedAccount()');
});

test('the page syncs sign-in and sign-out without persisting the bearer token', () => {
  expect(html).toContain('sb.auth.onAuthStateChange');
  expect(html).toContain('sb.auth.getSession()');
  expect(html).toContain('bridge.setOfflineAccount(');
  expect(html).toContain('bridge.clearOfflineAccount(revision)');
  expect(preload).toContain("ipcRenderer.invoke('edall:set-offline-account'");
  expect(preload).toContain("ipcRenderer.invoke('edall:clear-offline-account'");
  expect(library).toContain('await safeStorageEncryptString(this.safeStorage, String(userId))');
  expect(library).toContain('await safeStorageDecryptString(this.safeStorage');
  expect(library).not.toContain('accessToken');
});

test('each Windows download sends the exact course, lesson, video and current session token', () => {
  expect(html).toContain('_edDesktopOpen(container, vid, courseId, lessonId)');
  expect(html).toContain('renderVideoToggle(video, vidIdx, courseId, lessonId)');
  expect(html).toContain('bridge.downloadOffline(\n                                vid, quality, courseId, lessonId, session.access_token');
  expect(main).toContain('authorizeOfflineDownload({');
  expect(main).toContain('course_id: courseId');
  expect(main).toContain('lesson_id: lessonId');
  expect(main).toContain('video_id: videoId');
});

test('offline list, delete and playback are restricted to the manifest owner', () => {
  expect(library).toContain('manifest.version !== 2');
  expect(library).toContain('manifest.userId === userId');
  expect(library).toContain('manifest.userId !== userId');
  expect(main).toContain('offlineLibrary.list(activeOfflineUserId)');
  expect(main).toContain('offlineLibrary.remove(id, activeOfflineUserId)');
  expect(main).toContain("offlineLibrary.createResponse(id, offlineRole, request.headers.get('range'), activeOfflineUserId)");
});
