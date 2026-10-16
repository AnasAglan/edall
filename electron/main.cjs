const { app, BrowserWindow, ipcMain, Menu, protocol, net, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ORIGIN = 'https://edall.lovable.app';
const HOME = ORIGIN + '/ed_master.html';
const streams = new Map(), jobs = new Map(), cache = new Map();
let windowRef, toolReady;
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
async function prepareTools() {
  const dir = path.join(app.getPath('userData'), 'tools');
  await fs.mkdir(dir, { recursive: true });
  for (const name of ['yt-dlp.exe', 'deno.exe']) {
    const dest = path.join(dir, name);
    try { await fs.access(dest); } catch { await fs.copyFile(path.join(__dirname, 'bin', name), dest); }
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
  streams.set(token, { url: url.href, headers, expire });
  return { url: 'edmedia://stream/' + token, expire };
}
async function extract(id, force) {
  const previous = cache.get(id);
  if (!force && previous && previous.expiresAt > Date.now() + 180000) return previous;
  if (jobs.has(id)) return jobs.get(id);
  const task = (async () => {
    const dir = await toolReady;
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
  ipcMain.handle('edall:formats', (event, id, force) => {
    if (!windowRef || event.sender !== windowRef.webContents || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== ORIGIN || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('Access denied');
    return extract(id, force === true);
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
    try { const u = new URL(raw); if (u.origin !== ORIGIN || /\.pdf$/i.test(u.pathname)) { event.preventDefault(); openOutside(raw); } } catch { event.preventDefault(); }
  });
  windowRef.webContents.on('will-frame-navigate', (event, details) => { if (!frameAllowed(details.url)) event.preventDefault(); });
  windowRef.webContents.on('will-attach-webview', event => event.preventDefault());
  windowRef.webContents.on('before-input-event', (event, input) => { if (input.key === 'F12' || (input.control && input.shift && ['i','j','c'].includes(input.key.toLowerCase()))) event.preventDefault(); });
  windowRef.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
  if (permission === 'fullscreen') return callback(true);
  callback(false);
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
