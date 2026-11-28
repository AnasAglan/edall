'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('electron/main.cjs', 'utf8');
const preload = fs.readFileSync('electron/preload.cjs', 'utf8');
const html = fs.readFileSync('public/ed_master.html', 'utf8');
const library = fs.readFileSync('electron/offline-library.cjs', 'utf8');

test('the desktop verifies the current Supabase account before trusting an offline account ID', () => {
  assert.ok(main.includes("new URL('/auth/v1/user', backend.origin)"));
  assert.ok(main.includes("profile.id !== userId"));
  assert.ok(main.includes("Authorization: 'Bearer ' + accessToken"));
  assert.ok(main.includes("ipcMain.handle('edall:set-offline-account'"));
  assert.ok(main.includes("offlineLibrary.rememberAccount(verifiedUserId)"));
  assert.equal(main.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
});

test('offline account changes are ordered and logout clears remembered ownership', () => {
  assert.ok(main.includes('revision <= offlineAccountSyncRevision'));
  assert.ok(main.includes("ipcMain.handle('edall:clear-offline-account'"));
  assert.ok(main.includes('await offlineLibrary.clearRememberedAccount()'));
  assert.ok(main.includes('activeOfflineUserId = null'));
  assert.ok(main.includes('activeOfflineUserId = await offlineLibrary.getRememberedAccount()'));
});

test('the page syncs sign-in and sign-out without persisting the bearer token', () => {
  assert.ok(html.includes('sb.auth.onAuthStateChange'));
  assert.ok(html.includes('sb.auth.getSession()'));
  assert.ok(html.includes('bridge.setOfflineAccount('));
  assert.ok(html.includes('bridge.clearOfflineAccount(revision)'));
  assert.ok(preload.includes("ipcRenderer.invoke('edall:set-offline-account'"));
  assert.ok(preload.includes("ipcRenderer.invoke('edall:clear-offline-account'"));
  assert.ok(library.includes('await safeStorageEncryptString(this.safeStorage, String(userId))'));
  assert.ok(library.includes('await safeStorageDecryptString(this.safeStorage'));
  assert.equal(library.includes('accessToken'), false);
});

test('each Windows download sends the exact course, lesson, video and current session token', () => {
  assert.ok(html.includes('_edDesktopOpen(container, vid, courseId, lessonId)'));
  assert.ok(html.includes('renderVideoToggle(video, vidIdx, courseId, lessonId)'));
  assert.match(
    html,
    /bridge\.downloadOffline\(\s*vid,\s*quality,\s*courseId,\s*lessonId,\s*session\.access_token/
  );
  assert.ok(main.includes('authorizeOfflineDownload({'));
  assert.ok(main.includes('course_id: courseId'));
  assert.ok(main.includes('lesson_id: lessonId'));
  assert.ok(main.includes('video_id: videoId'));
});

test('offline list, delete and playback are restricted to the manifest owner', () => {
  assert.ok(library.includes('manifest.version !== 2'));
  assert.ok(library.includes('manifest.userId === userId'));
  assert.ok(library.includes('manifest.userId !== userId'));
  assert.ok(main.includes('offlineLibrary.list(activeOfflineUserId)'));
  assert.ok(main.includes('offlineLibrary.remove(id, activeOfflineUserId)'));
  assert.ok(main.includes("offlineLibrary.createResponse(id, offlineRole, request.headers.get('range'), activeOfflineUserId)"));
});
