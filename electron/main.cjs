const { app, BrowserWindow, ipcMain, Menu, protocol, net, shell, safeStorage } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { fileURLToPath } = require('node:url');
const { OfflineLibrary } = require('./offline-library.cjs');
const { assertSafeStorageAvailable } = require('./safe-storage-adapter.cjs');
const ORIGIN = 'https://edall.lovable.app';
const HOME = ORIGIN + '/ed_master.html';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const streams = new Map(), jobs = new Map(), cache = new Map();
let windowRef, toolReady, offlineLibrary, activeOfflineUserId = null;
protocol.registerSchemesAsPrivileged([{ scheme: 'edmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
if (!app.requestSingleInstanceLock()) { app.quit(); }
// Lets the website open the app through edall:// links.
app.setAsDefaultProtocolClient('edall');
const run = (exe, args, timeout = 90000) => new Promise((resolve, reject) => {
  execFile(exe, args, { timeout, maxBuffer: 24 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
    if (err) reject(new Error('Video extraction unavailable; YouTube may require verification.'));
    else resolve(stdout);
  });
});
const mediaHost = hostname => hostname === 'googlevideo.com' || hostname.endsWith('.googlevideo.com');
const frameAllowed = raw => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && [
      'edall.lovable.app', 'youtube.com', 'youtube-nocookie.com', 'dailymotion.com'
    ].some(host => url.hostname === host || (host !== 'edall.lovable.app' && url.hostname.endsWith('.' + host)));
  } catch { return false; }
};
function isOfflineUiUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'file:' &&
      path.resolve(fileURLToPath(url)) === path.resolve(__dirname, 'offline.html');
  } catch { return false; }
}
function assertMainFrame(event, allowOfflineUi = false) {
  if (
    !windowRef ||
    windowRef.isDestroyed() ||
    event.sender !== windowRef.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) throw new Error('Access denied');
  try {
    if (new URL(event.senderFrame.url).origin === ORIGIN) return;
  } catch {}
  if (allowOfflineUi && isOfflineUiUrl(event.senderFrame.url)) return;
  throw new Error('Access denied');
}
function getRegisteredStream(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Offline source is invalid.'); }
  if (url.protocol !== 'edmedia:' || url.hostname !== 'stream') {
    throw new Error('Only the active desktop yt-dlp stream can be saved.');
  }
  const stream = streams.get(url.pathname.slice(1));
  if (!stream || stream.expire < Date.now()) throw new Error('The media source expired; reopen the lesson and try again.');
  return stream;
}
async function authorizeOfflineDownload({ courseId, lessonId, videoId, accessToken, supabaseUrl, publishableKey }) {
  if (!UUID_PATTERN.test(String(courseId || '')) || !UUID_PATTERN.test(String(lessonId || ''))) {
    throw new Error('A valid course and lesson are required for offline authorization.');
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) {
    throw new Error('Invalid video ID.');
  }
  if (typeof accessToken !== 'string' || accessToken.length < 40 || accessToken.length > 8192) {
    throw new Error('Sign in to ED-ALL before saving this lesson.');
  }
  if (typeof publishableKey !== 'string' || !publishableKey.trim() || publishableKey.length > 2048) {
    throw new Error('The platform public backend key is unavailable.');
  }
  // Never accept a privileged service-role key from the renderer.
  if (publishableKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') throw new Error('Privileged backend keys are not accepted.');
    } catch (error) {
      if (error && error.message === 'Privileged backend keys are not accepted.') throw error;
    }
  }
  let backend;
  try { backend = new URL(String(supabaseUrl || '')); }
  catch { throw new Error('The platform backend URL is invalid.'); }
  const host = backend.hostname.toLowerCase();
  if (
    backend.protocol !== 'https:' ||
    backend.username || backend.password ||
    !(host.endsWith('.supabase.co') || host.endsWith('.lovable.cloud')) ||
    backend.search || backend.hash
  ) throw new Error('The platform backend URL is not an approved HTTPS Supabase endpoint.');

  const endpoint = new URL('/functions/v1/authorize-offline-download', backend.origin);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: publishableKey,
        Origin: ORIGIN,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        course_id: courseId,
        lesson_id: lessonId,
        video_id: videoId
      })
    });
  } catch {
    throw new Error('Could not contact ED-ALL to authorize this offline download.');
  }

  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.authorized !== true) {
    const message = result && typeof result.error === 'string' ? result.error : '';
    throw new Error(message || 'This lesson is not authorized for offline download by the current account.');
  }
  if (
    !UUID_PATTERN.test(String(result.user_id || '')) ||
    result.course_id !== courseId ||
    result.lesson_id !== lessonId ||
    result.video_id !== videoId
  ) throw new Error('The authorization service returned an invalid account or lesson binding.');
  return result.user_id;
}

async function downloadOfflineVideo(id, height, courseId, lessonId, accessToken, supabaseUrl, publishableKey) {
  if (process.platform !== 'win32') {
    throw new Error('Encrypted offline downloads are currently supported on Windows only.');
  }
  if (!offlineLibrary) throw new Error('Encrypted offline storage is unavailable.');
  await assertSafeStorageAvailable(safeStorage);
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(id))) throw new Error('Invalid video ID.');
  // Server entitlement is checked before any media extraction or download begins.
  const userId = await authorizeOfflineDownload({
    courseId, lessonId, videoId: String(id), accessToken, supabaseUrl, publishableKey
  });
  const bundle = await extract(String(id), false);
  const selected = bundle.videos.find(item => item.h === Number(height));
  if (!selected) throw new Error('The selected desktop video quality is unavailable.');
  const video = getRegisteredStream(selected.url);
  const audio = selected.hasAudio ? null : (bundle.audio ? getRegisteredStream(bundle.audio.url) : null);
  if (!selected.hasAudio && !audio) throw new Error('This quality has no compatible audio stream and cannot be saved.');
  const saved = await offlineLibrary.save({
    userId,
    title: bundle.title,
    videoId: String(id),
    height: selected.h,
    video: { ...video, mimeType: selected.mimeType || video.mimeType || 'video/mp4' },
    audio: audio ? { ...audio, mimeType: bundle.audio.mimeType || audio.mimeType || 'audio/mp4' } : null
  });
  activeOfflineUserId = userId;
  return saved;
}
async function prepareTools() {
  const dir = path.join(app.getPath('userData'), 'tools');
  await fs.mkdir(dir, { recursive: true });
  try {
    for (const name of ['yt-dlp.exe', 'deno.exe']) {
      const dest = path.join(dir, name);
      try { await fs.access(dest); }
      catch { await fs.copyFile(path.join(__dirname, 'bin', name), dest); }
    }
  } catch (error) {
    // Desktop playback requires the bundled yt-dlp and Deno tools.
    // Do not switch to a remote extractor when local extraction tools are missing.
    console.error('[EdAll] yt-dlp/Deno binaries are unavailable; desktop extraction cannot start.', error);
    return null;
  }
  // yt-dlp's own updater verifies release hashes. Failed checks retain the installed binary.
  await run(path.join(dir, 'yt-dlp.exe'), ['--update', '--socket-timeout', '10'], 30000).catch(() => {});
  return dir;
}
function registerStream(format, commonHeaders) {
  const url = new URL(format.url);
  if (url.protocol !== 'https:' || !mediaHost(url.hostname)) throw new Error('Unexpected video source');
  const token = crypto.randomBytes(24).toString('hex');
  const expire = Number(url.searchParams.get('expire')) * 1000 || Date.now() + 3600000;
  const headers = {};
  for (const [key, value] of Object.entries({ ...commonHeaders, ...format.http_headers })) {
    if (['user-agent', 'referer', 'origin', 'accept', 'accept-language'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[key] = value;
  }
  const mimeType = format.vcodec === 'none'
    ? (format.ext === 'webm' ? 'audio/webm' : 'audio/mp4')
    : (format.ext === 'webm' ? 'video/webm' : 'video/mp4');
  streams.set(token, { url: url.href, headers, expire, mimeType });
  return { url: 'edmedia://stream/' + token, expire, mimeType };
}
async function extract(id, force) {
  const previous = cache.get(id);
  if (!force && previous && previous.expiresAt > Date.now() + 180000) return previous;
  if (jobs.has(id)) return jobs.get(id);
  const task = (async () => {
    const dir = await toolReady;
    if (!dir) throw new Error('The desktop yt-dlp extractor is not installed.');
    const raw = await run(path.join(dir, 'yt-dlp.exe'), [
      '--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', '--socket-timeout', '15',
      '--js-runtimes', 'deno:' + path.join(dir, 'deno.exe'), 'https://www.youtube.com/watch?v=' + id
    ]);
    const info = JSON.parse(raw);
    const usable = (info.formats || []).filter(f => f.url && /^https:\/\//.test(f.url) && !String(f.protocol || '').includes('m3u8') && !String(f.protocol || '').includes('dash'));
    const audioFormat = usable.filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && ['m4a','webm','mp4'].includes(f.ext)).sort((a,b) => (b.abr || 0) - (a.abr || 0))[0];
    const heights = new Map();
    const rank = f => (String(f.vcodec).startsWith('avc1') ? 300000 : String(f.vcodec).startsWith('vp9') ? 200000 : 0) + (f.tbr || 0);
    for (const f of usable) {
      if (!f.height || !f.vcodec || f.vcodec === 'none' || !['mp4','webm'].includes(f.ext)) continue;
      if (f.acodec === 'none' && !audioFormat) continue;
      const old = heights.get(f.height);
      if (!old || rank(f) > rank(old)) heights.set(f.height, f);
    }
    if (!heights.size) throw new Error('No playable video qualities');
    const videos = [...heights.values()].sort((a,b) => b.height - a.height).map(f => ({ h: f.height, hasAudio: !!f.acodec && f.acodec !== 'none', ...registerStream(f, info.http_headers) }));
    const audio = audioFormat ? registerStream(audioFormat, info.http_headers) : null;
    const result = { title: info.title || 'Video', videos, audio, expiresAt: Math.min(...videos.map(v => v.expire), audio ? audio.expire : Infinity) };
    cache.set(id, result);
    for (const [token, stream] of streams) if (stream.expire < Date.now()) streams.delete(token);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return result;
  })();
  jobs.set(id, task);
  try { return await task; } finally { jobs.delete(id); }
}
async function platformSnapshot() {
  const dest = path.join(app.getPath('userData'), 'platform.html');
  // 1. Fetch fresh live platform directly if online
  try {
    const liveUrl = HOME + '?live_sync=' + Date.now();
    const response = await net.fetch(liveUrl, { bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(7000), cache: 'no-store' });
    if (response.ok) {
      const next = await response.text();
      if (next.length > 100000 && next.includes('async function _edDesktopOpen') && next.includes('</html>')) {
        await fs.writeFile(dest, next);
        return next;
      }
    }
  } catch (_) {}

  // 2. Fallback to cached version if offline or slow connection
  try {
    const saved = await fs.readFile(dest, 'utf8');
    if (saved.includes('async function _edDesktopOpen')) return saved;
  } catch (_) {}

  // 3. Fallback to bundled snapshot
  return await fs.readFile(path.join(__dirname, 'platform', 'ed_master.html'), 'utf8');
}

app.whenReady().then(async () => {
const editMenu = Menu.buildFromTemplate([
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]
  }
]);
Menu.setApplicationMenu(editMenu);

  toolReady = prepareTools();
  offlineLibrary = new OfflineLibrary({
    directory: path.join(app.getPath('userData'), 'offline-media'),
    safeStorage,
    fetchMedia: async reference => {
      const upstream = await net.fetch(reference.url, {
        headers: reference.headers,
        signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
        redirect: 'error'
      });
      if (!upstream.ok || !upstream.body) {
        return { status: upstream.status, body: null, contentType: reference.mimeType };
      }
      return {
        status: upstream.status,
        contentType: upstream.headers.get('content-type') || reference.mimeType,
        body: Readable.fromWeb(upstream.body)
      };
    }
  });

  ipcMain.handle('edall:formats', (event, id, force) => {
    assertMainFrame(event);
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Access denied');
    return extract(id, force === true);
  });
  ipcMain.handle('edall:download-offline', async (event, id, height, courseId, lessonId, accessToken, supabaseUrl, publishableKey) => {
    assertMainFrame(event);
    return downloadOfflineVideo(id, height, courseId, lessonId, accessToken, supabaseUrl, publishableKey);
  });
  ipcMain.handle('edall:list-offline', async event => {
    assertMainFrame(event, true);
    if (!UUID_PATTERN.test(String(activeOfflineUserId || ''))) {
      throw new Error('Open Saved Downloads from the signed-in ED-ALL account first.');
    }
    return offlineLibrary.list(activeOfflineUserId);
  });
  ipcMain.handle('edall:delete-offline', async (event, id) => {
    assertMainFrame(event, true);
    if (!UUID_PATTERN.test(String(activeOfflineUserId || ''))) {
      throw new Error('No authenticated ED-ALL account is selected.');
    }
    return offlineLibrary.remove(id, activeOfflineUserId);
  });
  ipcMain.handle('edall:open-offline-library', async (event, userId) => {
    assertMainFrame(event);
    if (!UUID_PATTERN.test(String(userId || ''))) {
      throw new Error('Sign in to ED-ALL to open this account\'s saved downloads.');
    }
    activeOfflineUserId = userId;
    await windowRef.loadFile(path.join(__dirname, 'offline.html'), { query: { userId } });
    return true;
  });
  ipcMain.handle('edall:return-to-platform', async event => {
    assertMainFrame(event, true);
    await windowRef.loadURL(HOME);
    activeOfflineUserId = null;
    return true;
  });

ipcMain.handle('edall:video-fullscreen', (event, enabled) => {
    if (
        !windowRef ||
        windowRef.isDestroyed() ||
        event.sender !== windowRef.webContents ||
        event.senderFrame !== event.sender.mainFrame
    ) {
        throw new Error('Access denied');
    }

    const fullscreen = enabled === true;

    if (fullscreen) {
        windowRef.setMenuBarVisibility(false);
        windowRef.setAutoHideMenuBar(true);
    }

    windowRef.setFullScreen(fullscreen);

    return true;
});

  protocol.handle('https', async request => {

    const url = new URL(request.url);
    if (url.searchParams.has('desktop-update')) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (url.origin === ORIGIN && (url.pathname === '/ed_master.html' || url.pathname === '/')) {
      return new Response(await platformSnapshot(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });

  protocol.handle('edmedia', async request => {
    const url = new URL(request.url);
    const offlineRole = url.hostname === 'offline-v' ? 'video' : url.hostname === 'offline-a' ? 'audio' : null;
    if (offlineRole) {
      try {
        const id = url.pathname.slice(1);
        if (!UUID_PATTERN.test(String(activeOfflineUserId || ''))) {
          return new Response('Offline account authorization required', { status: 403 });
        }
        const saved = await offlineLibrary.createResponse(id, offlineRole, request.headers.get('range'), activeOfflineUserId);
        const headers = new Headers(saved.headers);
        const requestOrigin = request.headers.get('origin');
        if (requestOrigin && requestOrigin !== ORIGIN && requestOrigin !== 'null') {
          return new Response('Origin denied', { status: 403 });
        }
        headers.set('Access-Control-Allow-Origin', requestOrigin || ORIGIN);
        return new Response(Readable.toWeb(saved.body), { status: saved.status, headers });
      } catch (error) {
        if (error && error.statusCode === 416) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': error.contentRange || 'bytes */0',
              'Access-Control-Allow-Origin': request.headers.get('origin') === 'null' ? 'null' : ORIGIN
            }
          });
        }
        return new Response('Offline media unavailable', {
          status: 404,
          headers: { 'Access-Control-Allow-Origin': ORIGIN, 'Cache-Control': 'no-store' }
        });
      }
    }
    const stream = url.hostname === 'stream' && streams.get(url.pathname.slice(1));
    if (!stream || stream.expire < Date.now()) return new Response('Expired', { status: 410 });
    const headers = { ...stream.headers };
    const range = request.headers.get('range');
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    try {
      const upstream = await net.fetch(stream.url, { headers, signal: request.signal, redirect: 'error' });
      const out = new Headers();
      for (const key of ['content-type','content-length','content-range','accept-ranges']) { const value = upstream.headers.get(key); if (value) out.set(key, value); }
      out.set('Access-Control-Allow-Origin', ORIGIN);
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch { return new Response('Media unavailable', { status: 502 }); }
  });
  windowRef = new BrowserWindow({ width: 1280, height: 850, title: 'EdAll', icon: path.join(__dirname,'icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, devTools: false } });
  windowRef.setContentProtection(true);
  const openOutside = raw => { try { const u = new URL(raw); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch {} };
  windowRef.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  windowRef.webContents.on('will-navigate', (event, raw) => {
    if (raw.startsWith('edall-restart:')) { event.preventDefault(); app.relaunch(); app.exit(0); return; }
    if (isOfflineUiUrl(raw)) return;
    try { const u = new URL(raw); if (u.origin !== ORIGIN || /\.pdf$/i.test(u.pathname)) { event.preventDefault(); openOutside(raw); } } catch { event.preventDefault(); }
  });
  windowRef.webContents.on('will-frame-navigate', (event, details) => {
    if (!frameAllowed(details.url) && !isOfflineUiUrl(details.url)) event.preventDefault();
  });
  windowRef.webContents.on('will-attach-webview', event => event.preventDefault());
  windowRef.webContents.on('before-input-event', (event, input) => { if (input.key === 'F12' || (input.control && input.shift && ['i','j','c'].includes(input.key.toLowerCase()))) event.preventDefault(); });
  windowRef.webContents.session.setPermissionCheckHandler((_wc, permission) => {
  return permission === 'fullscreen';
});
  windowRef.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
  if (permission === 'fullscreen') return callback(true);
  callback(false);
});

  // Copy/paste context menu inside editable fields (essay answers etc.)
  windowRef.webContents.on('context-menu', (_event, params) => {
    if (!windowRef || windowRef.isDestroyed()) return;
    const menu = Menu.buildFromTemplate(params.isEditable ? [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }
    ] : [
      { role: 'copy' },
      ...(params.mediaType === 'image' ? [{ role: 'copyImage' }] : [])
    ]);
    menu.popup({ window: windowRef });
  });

  const showOffline = () => windowRef.loadFile(path.join(__dirname, 'offline.html'));
  windowRef.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3 && !String(url).startsWith('file:')) showOffline(); });
  let online = net.isOnline();
  if (online) { try { const r = await net.fetch(ORIGIN + '/robots.txt', { bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(8000), cache: 'no-store' }); online = r.ok; } catch { online = false; } }
  if (!online) return showOffline();
  await windowRef.loadURL(HOME);
}).catch(() => app.quit());
app.on('second-instance', () => { if (windowRef) { if (windowRef.isMinimized()) windowRef.restore(); windowRef.focus(); } });
app.on('window-all-closed', () => app.quit());
