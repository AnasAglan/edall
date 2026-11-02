(function () {
  'use strict';

  const DOCS_URL = 'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md';
  const CACHE_KEY = 'ed_piped_instances_v2';
  const LAST_KEY = 'ed_piped_last_instance_v2';
  const QUALITY_KEY = 'ed_piped_quality_v2';
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const FALLBACKS = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.nosebs.ru',
    'https://pipedapi-libre.kavin.rocks',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
    'https://pipedapi.drgns.space',
    'https://pipedapi.owo.si',
    'https://pipedapi.ducks.party',
    'https://piped-api.codespace.cz',
    'https://pipedapi.reallyaweso.me',
    'https://api.piped.private.coffee',
    'https://pipedapi.darkness.services',
    'https://pipedapi.orangenet.cc'
  ];

  function cleanBase(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
      if (url.pathname !== '/' && url.pathname !== '') return null;
      const host = url.hostname.toLowerCase();
      return host.includes('piped') || host.startsWith('pa.') ? url.origin : null;
    } catch (_) { return null; }
  }

  function mergeInstances(values) {
    const result = [];
    const seen = new Set();
    (values || []).forEach(value => {
      const base = cleanBase(value);
      if (base && !seen.has(base)) { seen.add(base); result.push(base); }
    });
    return result;
  }

  async function getInstances() {
    const now = Date.now();
    let cached = [];
    try {
      const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (data && Array.isArray(data.instances) && now - Number(data.savedAt) < CACHE_TTL) {
        cached = mergeInstances(data.instances);
      }
    } catch (_) {}

    const last = (() => { try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; } })();
    if (cached.length) return mergeInstances([last, ...cached, ...FALLBACKS]);

    let discovered = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(DOCS_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'text/plain' }
      });
      if (response.ok) {
        const markdown = await response.text();
        markdown.split(/\r?\n/).forEach(line => {
          if (!line.includes('|')) return;
          line.split('|').forEach(cell => {
            const match = String(cell || '').match(/https:\/\/[a-z0-9.-]+/i);
            if (match && /piped|:\/\/pa\./i.test(match[0])) discovered.push(match[0]);
          });
        });
      }
    } catch (_) {
      // The official instance list may be unavailable; use the known public fallback list.
    } finally { clearTimeout(timer); }

    const instances = mergeInstances([...discovered, ...FALLBACKS]);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: now, instances })); } catch (_) {}
    return mergeInstances([last, ...instances]);
  }

  function safeHttps(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) { return null; }
  }

  function inferMime(stream, type) {
    if (stream && stream.mimeType) return String(stream.mimeType).split(';')[0].trim().toLowerCase();
    const format = String(stream && stream.format || '').toUpperCase();
    if (type === 'video') {
      if (format === 'MPEG_4' || format === 'MP4') return 'video/mp4';
      if (format === 'WEBM') return 'video/webm';
    } else {
      if (format === 'M4A' || format === 'MP4') return 'audio/mp4';
      if (format === 'WEBMA' || format === 'WEBM' || format === 'WEBMA_OPUS') return 'audio/webm';
      if (format === 'OPUS' || format === 'OGG') return 'audio/ogg';
    }
    return '';
  }

  function browserSupports(probe, mime, codec) {
    if (!mime) return false;
    try {
      if (codec && probe.canPlayType(mime + '; codecs="' + codec + '"')) return true;
      return !!probe.canPlayType(mime);
    } catch (_) { return false; }
  }

  function normalize(data) {
    if (!data || !Array.isArray(data.videoStreams)) return null;
    const videoProbe = document.createElement('video');
    const audioProbe = document.createElement('audio');

    const audioStreams = (Array.isArray(data.audioStreams) ? data.audioStreams : [])
      .map(stream => {
        if (!stream) return null;
        const url = safeHttps(stream.url);
        const mimeType = inferMime(stream, 'audio');
        const codec = String(stream.codec || '');
        if (!url || !/^audio\/(mp4|webm|ogg|mpeg)/i.test(mimeType) || !browserSupports(audioProbe, mimeType, codec)) return null;
        return {
          ...stream,
          url,
          mimeType,
          codec,
          bitrate: Number(stream.bitrate) || 0,
          audioTrackId: stream.audioTrackId || 'default'
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aMp4 = a.mimeType === 'audio/mp4' ? 1 : 0;
        const bMp4 = b.mimeType === 'audio/mp4' ? 1 : 0;
        return bMp4 - aMp4 || b.bitrate - a.bitrate;
      });

    const videoStreams = data.videoStreams.map(stream => {
      if (!stream) return null;
      const url = safeHttps(stream.url);
      const mimeType = inferMime(stream, 'video');
      const codec = String(stream.codec || '');
      const height = Number(stream.height) || Number((String(stream.quality || '').match(/(\d{3,4})p/i) || [])[1]);
      if (!url || !Number.isFinite(height) || height < 1) return null;
      if (!/^video\/(mp4|webm)/i.test(mimeType) || !browserSupports(videoProbe, mimeType, codec)) return null;
      return {
        ...stream,
        url,
        mimeType,
        codec,
        height,
        bitrate: Number(stream.bitrate) || 0,
        videoOnly: stream.videoOnly === true,
        audioTrackId: stream.audioTrackId || 'default'
      };
    }).filter(Boolean);

    const videoOnly = videoStreams.filter(stream => stream.videoOnly);
    const muxedVideos = videoStreams.filter(stream => !stream.videoOnly);
    const proxyUrl = safeHttps(data.proxyUrl);
    const dash = safeHttps(data.dash);
    const hls = safeHttps(data.hls);

    if (!videoOnly.length && !muxedVideos.length && !dash && !hls) return null;
    if (videoOnly.length && !audioStreams.length && !dash && !hls && !muxedVideos.length) return null;

    return {
      title: String(data.title || ''),
      duration: Number(data.duration) || 0,
      proxyUrl,
      dash,
      hls,
      livestream: data.livestream === true,
      videoStreams,
      videoOnly,
      muxedVideos,
      audioStreams
    };
  }

  function xmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function validRange(stream) {
    const values = ['indexStart', 'indexEnd', 'initStart', 'initEnd'].map(key => Number(stream[key]));
    return values.every(Number.isFinite) && values[1] >= values[0] && values[3] >= values[2];
  }

  function toRepresentation(stream, type, index) {
    if (!validRange(stream)) return '';
    const id = xmlEscape(stream.itag || stream.id || (type + '-' + index));
    const codec = stream.codec ? ' codecs="' + xmlEscape(stream.codec) + '"' : '';
    const bandwidth = Math.max(1, Number(stream.bitrate) || 1);
    const dimensions = type === 'video'
      ? ' width="' + Math.max(1, Number(stream.width) || 1) + '" height="' + Math.max(1, Number(stream.height) || 1) + '"'
      : '';
    const frameRate = type === 'video' && Number(stream.fps) > 0
      ? ' frameRate="' + Number(stream.fps) + '"'
      : '';
    const sampleRate = type === 'audio' && Number(stream.audioSamplingRate) > 0
      ? ' audioSamplingRate="' + Number(stream.audioSamplingRate) + '"'
      : '';
    return '<Representation id="' + id + '" bandwidth="' + bandwidth + '"' + codec + dimensions + frameRate + sampleRate + '>' +
      '<BaseURL>' + xmlEscape(stream.url) + '</BaseURL>' +
      '<SegmentBase indexRange="' + Number(stream.indexStart) + '-' + Number(stream.indexEnd) + '">' +
      '<Initialization range="' + Number(stream.initStart) + '-' + Number(stream.initEnd) + '"/>' +
      '</SegmentBase></Representation>';
  }

  function groupByMime(streams) {
    const groups = new Map();
    streams.forEach(stream => {
      const key = String(stream.audioTrackId || 'default') + '|' + stream.mimeType;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stream);
    });
    return Array.from(groups.values());
  }

  function buildDashDataUri(bundle) {
    if (!(bundle.duration > 0) || !bundle.videoOnly.length || !bundle.audioStreams.length) return null;
    const videoStreams = bundle.videoOnly.filter(validRange);
    const audioStreams = bundle.audioStreams.filter(validRange);
    if (!videoStreams.length || !audioStreams.length) return null;

    const adaptations = [];
    let counter = 0;
    groupByMime(videoStreams).forEach(group => {
      const mime = group[0].mimeType;
      const reps = group.map(stream => toRepresentation(stream, 'video', ++counter)).join('');
      if (!reps) return;
      adaptations.push('<AdaptationSet id="video-' + adaptations.length + '" contentType="video" mimeType="' +
        xmlEscape(mime) + '" startWithSAP="1" subsegmentAlignment="true" scanType="progressive">' + reps + '</AdaptationSet>');
    });
    groupByMime(audioStreams).forEach(group => {
      const mime = group[0].mimeType;
      const reps = group.map(stream => toRepresentation(stream, 'audio', ++counter)).join('');
      if (!reps) return;
      const lang = String(group[0].audioTrackLocale || group[0].audioTrackId || 'und').slice(0, 2);
      adaptations.push('<AdaptationSet id="audio-' + adaptations.length + '" contentType="audio" lang="' +
        xmlEscape(lang || 'und') + '" mimeType="' + xmlEscape(mime) + '" startWithSAP="1" subsegmentAlignment="true">' +
        '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>' +
        reps + '</AdaptationSet>');
    });

    if (!adaptations.some(item => item.includes('contentType="video"')) ||
        !adaptations.some(item => item.includes('contentType="audio"'))) return null;

    const duration = Math.max(1, bundle.duration);
    const mpd = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:full:2011" minBufferTime="PT1.5S" type="static" mediaPresentationDuration="PT' +
      duration + 'S"><Period>' + adaptations.join('') + '</Period></MPD>';

    const bytes = new TextEncoder().encode(mpd);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    }
    return 'data:application/dash+xml;base64,' + btoa(binary);
  }

  async function fetchBundle(videoId, excluded) {
    const instances = (await getInstances()).filter(base => !excluded.has(base));
    const batchSize = 4;
    for (let offset = 0; offset < instances.length; offset += batchSize) {
      const controllers = [];
      const requests = instances.slice(offset, offset + batchSize).map(base => {
        const controller = new AbortController();
        controllers.push(controller);
        const timer = setTimeout(() => controller.abort(), 7500);
        return fetch(base + '/streams/' + encodeURIComponent(videoId), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        }).then(async response => {
          if (!response.ok) throw new Error('Piped HTTP ' + response.status);
          const data = await response.json();
          const bundle = normalize(data);
          if (!bundle) throw new Error('No compatible video streams');
          return { ...bundle, instance: base };
        }).finally(() => clearTimeout(timer));
      });
      try {
        const winner = await Promise.any(requests);
        controllers.forEach(controller => { try { controller.abort(); } catch (_) {} });
        return winner;
      } catch (_) {
        controllers.forEach(controller => { try { controller.abort(); } catch (_) {} });
      }
    }
    throw new Error('All public Piped API instances failed or returned no compatible streams.');
  }

  function getPreferredHeight(heights, preferred) {
    const sorted = heights.slice().sort((a, b) => b - a);
    if (!sorted.length) return 0;
    const target = Number(preferred) || 720;
    return sorted.find(height => height === target) ||
      sorted.find(height => height <= target) ||
      sorted[0];
  }

  function chooseVariant(tracks, height) {
    const choices = tracks.filter(track => Number(track.height) === Number(height));
    if (!choices.length) return null;
    choices.sort((a, b) => {
      const aRate = (Number(a.videoBandwidth) || Number(a.bandwidth) || 0) + (Number(a.audioBandwidth) || 0);
      const bRate = (Number(b.videoBandwidth) || Number(b.bandwidth) || 0) + (Number(b.audioBandwidth) || 0);
      return bRate - aRate;
    });
    return choices[0];
  }

  function chooseMuxed(videos, height) {
    const choices = videos.filter(item => Number(item.height) === Number(height));
    if (!choices.length) return null;
    choices.sort((a, b) => {
      const aMp4 = a.mimeType === 'video/mp4' ? 1 : 0;
      const bMp4 = b.mimeType === 'video/mp4' ? 1 : 0;
      return bMp4 - aMp4 || b.bitrate - a.bitrate;
    });
    return choices[0];
  }

  function waitForCanPlay(video, url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('canplay', ready);
        video.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const ready = () => finish();
      const failed = () => finish(new Error('The selected Piped media URL could not be played.'));
      const timer = setTimeout(() => finish(new Error('Timed out while loading the selected Piped media URL.')), timeoutMs || 15000);
      video.addEventListener('canplay', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.src = url;
      video.load();
      if (video.readyState >= 3) setTimeout(ready, 0);
    });
  }

  function seekVideo(video, time) {
    return new Promise(resolve => {
      const duration = Number(video.duration);
      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(Math.max(0, time), Math.max(0, duration - 0.25))
        : Math.max(0, time);
      if (Math.abs((Number(video.currentTime) || 0) - target) < 0.15) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      };
      const timer = setTimeout(finish, 5000);
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = target; } catch (_) { finish(); }
    });
  }

  async function open(options) {
    const container = options.container;
    const videoId = String(options.videoId || '');
    if (!container || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
    if (!window.Plyr) throw new Error('The Plyr video controls did not load.');

    const wrap = document.createElement('div');
    wrap.className = 'edv-wrap ed-desktop-player';
    wrap.style.cssText = 'position:relative;border-radius:var(--radius);overflow:hidden;background:#000;';
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.controls = false;
    video.setAttribute('playsinline', '');
    wrap.appendChild(video);
    container.replaceChildren(wrap);
    container.style.display = 'block';

    let disposed = false;
    let engine = null;
    let player = null;
    let bundle = null;
    let mode = '';
    let selectedHeight = 0;
    let qualityHeights = [];
    let variantTracks = [];
    let muxedVideos = [];
    let switching = false;
    let recovering = false;
    let recoveryCount = 0;
    let stallTimer = null;
    let desktopFullscreen = false;
    const excluded = new Set();
    const cleanupFns = [];
    const originalBodyOverflow = document.body.style.overflow;
    const listen = (element, event, handler, capture) => {
      element.addEventListener(event, handler, !!capture);
      cleanupFns.push(() => element.removeEventListener(event, handler, !!capture));
    };
    const toast = (message, type) => {
      if (typeof options.toast === 'function') options.toast(message, type || 'info');
      else console.info('[ED-ALL] ' + message);
    };
    const captureState = () => ({
      time: Number(video.currentTime) || 0,
      playing: !video.paused,
      rate: Number(video.playbackRate) || 1,
      volume: Number(video.volume),
      muted: !!video.muted
    });

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(stallTimer);
      cleanupFns.splice(0).forEach(fn => { try { fn(); } catch (_) {} });
      if (desktopFullscreen) {
        desktopFullscreen = false;
        wrap.classList.remove('plyr--fullscreen-fallback', 'ed-desktop-fullscreen');
        document.body.style.overflow = originalBodyOverflow;
        try {
          if (options.desktopBridge && typeof options.desktopBridge.setVideoFullscreen === 'function') {
            options.desktopBridge.setVideoFullscreen(false).catch(() => {});
          }
        } catch (_) {}
      }
      try { video.pause(); } catch (_) {}
      if (engine) { const old = engine; engine = null; old.destroy().catch(() => {}); }
      try { video.removeAttribute('src'); video.load(); } catch (_) {}
    };
    container._desktopCleanup = cleanup;

    const resetEngine = async () => {
      if (engine) {
        const old = engine;
        engine = null;
        try { await old.destroy(); } catch (_) {}
      }
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
      mode = '';
      variantTracks = [];
      muxedVideos = [];
    };

    const createManifest = current => {
      if (current.livestream && current.hls) return { uri: current.hls, mime: 'application/x-mpegurl' };
      if (current.dash) {
        try {
          const url = new URL(current.dash);
          url.searchParams.set('rewrite', 'false');
          return { uri: url.toString(), mime: 'application/dash+xml' };
        } catch (_) {}
      }
      const generated = buildDashDataUri(current);
      return generated ? { uri: generated, mime: 'application/dash+xml' } : null;
    };

    const configureProxy = (shakaPlayer, current) => {
      if (!current.proxyUrl) return;
      try {
        const proxy = new URL(current.proxyUrl);
        let prefix = proxy.pathname || '';
        if (prefix.endsWith('/')) prefix = prefix.slice(0, -1);
        shakaPlayer.getNetworkingEngine().registerRequestFilter((_type, request) => {
          try {
            const url = new URL(request.uris[0]);
            const headers = request.headers || {};
            if (url.hostname.endsWith('.googlevideo.com') ||
                (url.hostname.endsWith('.lbryplayer.xyz') && headers.Range)) {
              const upstreamHost = url.host;
              url.searchParams.set('host', upstreamHost);
              url.protocol = proxy.protocol;
              url.host = proxy.host;
              url.pathname = prefix + url.pathname;
              if (url.pathname === prefix + '/videoplayback' && headers.Range) {
                const range = String(headers.Range).replace(/^bytes=/i, '');
                url.searchParams.set('range', range);
                request.headers = {};
              }
              request.uris[0] = url.toString();
            }
          } catch (_) {}
        });
      } catch (_) {}
    };

    const loadBundle = async (next, restoreState, preferredHeight) => {
      await resetEngine();
      bundle = next;
      const manifest = createManifest(next);
      const hasShaka = !!(window.shaka && window.shaka.Player);
      const supported = hasShaka && !!(window.MediaSource || window.ManagedMediaSource) &&
        (!window.shaka.Player.isBrowserSupported || window.shaka.Player.isBrowserSupported());

      if (manifest && supported) {
        const shakaPlayer = new window.shaka.Player();
        engine = shakaPlayer;
        await shakaPlayer.attach(video);
        shakaPlayer.configure({
          abr: { enabled: false },
          streaming: {
            bufferingGoal: 20,
            rebufferingGoal: 3,
            bufferBehind: 45,
            retryParameters: {
              maxAttempts: 4,
              baseDelay: 500,
              backoffFactor: 2,
              fuzzFactor: 0.25,
              timeout: 20000
            }
          }
        });
        configureProxy(shakaPlayer, next);
        await shakaPlayer.load(manifest.uri, null, manifest.mime);
        if (disposed || engine !== shakaPlayer) throw new Error('Playback was closed while loading.');
        variantTracks = shakaPlayer.getVariantTracks().filter(track => Number(track.height) > 0);
        qualityHeights = Array.from(new Set(variantTracks.map(track => Number(track.height)))).sort((a, b) => b - a);
        if (!qualityHeights.length) throw new Error('Piped returned a DASH stream without selectable video qualities.');
        mode = 'shaka';
        selectedHeight = getPreferredHeight(qualityHeights, preferredHeight);
        const selectedTrack = chooseVariant(variantTracks, selectedHeight);
        if (selectedTrack) shakaPlayer.selectVariantTrack(selectedTrack, true);
      } else {
        muxedVideos = next.muxedVideos.slice().sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
        qualityHeights = Array.from(new Set(muxedVideos.map(item => Number(item.height)))).sort((a, b) => b - a);
        if (!qualityHeights.length) {
          if (next.hls && video.canPlayType('application/vnd.apple.mpegurl')) {
            mode = 'native-hls';
            qualityHeights = [];
            video.src = next.hls;
            video.load();
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => finish(new Error('HLS stream timed out.')), 15000);
              const finish = error => {
                clearTimeout(timer);
                video.removeEventListener('canplay', ready);
                video.removeEventListener('error', failed);
                error ? reject(error) : resolve();
              };
              const ready = () => finish();
              const failed = () => finish(new Error('HLS stream could not be played.'));
              video.addEventListener('canplay', ready, { once: true });
              video.addEventListener('error', failed, { once: true });
            });
          } else {
            throw new Error('No compatible DASH or progressive video stream was returned.');
          }
        } else {
          mode = 'direct';
          selectedHeight = getPreferredHeight(qualityHeights, preferredHeight);
          const initial = chooseMuxed(muxedVideos, selectedHeight);
          await waitForCanPlay(video, initial.url, 18000);
        }
      }

      if (restoreState) {
        if (restoreState.time > 0) await seekVideo(video, restoreState.time);
        video.playbackRate = restoreState.rate;
        video.volume = Number.isFinite(restoreState.volume) ? restoreState.volume : 1;
        video.muted = restoreState.muted;
        if (restoreState.playing) await video.play().catch(() => {});
      } else {
        video.volume = 1;
        video.muted = false;
      }
      return qualityHeights.slice();
    };

    const selectQuality = async height => {
      if (disposed || switching || recovering || !height) return;
      const requested = Number(height);
      if (!qualityHeights.includes(requested) || requested === selectedHeight) return;
      switching = true;
      try {
        if (mode === 'shaka' && engine) {
          const track = chooseVariant(variantTracks, requested);
          if (!track) throw new Error('The selected quality is not present in the loaded DASH manifest.');
          engine.selectVariantTrack(track, true);
          selectedHeight = requested;
        } else if (mode === 'direct') {
          const state = captureState();
          const target = chooseMuxed(muxedVideos, requested);
          if (!target) throw new Error('The selected progressive quality is unavailable.');
          video.pause();
          await waitForCanPlay(video, target.url, 18000);
          if (state.time > 0) await seekVideo(video, state.time);
          video.playbackRate = state.rate;
          video.volume = state.volume;
          video.muted = state.muted;
          selectedHeight = requested;
          if (state.playing) await video.play();
        }
        try { localStorage.setItem(QUALITY_KEY, String(selectedHeight)); } catch (_) {}
      } catch (error) {
        console.warn('[ED-ALL] Piped quality selection failed:', error);
        toast(options.language === 'ar' ? 'تعذر تطبيق الجودة المختارة من هذا الخادم.' : 'The selected quality could not be applied by this server.', 'error');
        if (bundle && bundle.instance) void recover(error);
      } finally { switching = false; }
    };

    const installPlyr = () => {
      if (player) { try { player.destroy(); } catch (_) {} player = null; }
      const settings = [];
      if (qualityHeights.length > 1) settings.push('quality');
      settings.push('speed');
      const config = {
        controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
        settings,
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
        fullscreen: { enabled: true, fallback: true, iosNative: false, container: '.edv-wrap.ed-desktop-player' },
        storage: { enabled: false }
      };
      if (qualityHeights.length > 1) {
        config.quality = {
          default: selectedHeight,
          options: qualityHeights.slice(),
          forced: true,
          onChange: value => { void selectQuality(value); }
        };
      }
      player = new window.Plyr(video, config);
      container._p = player;
      installDesktopFullscreen();
      if (typeof options.onReady === 'function') options.onReady({ player, video, wrap, mode, qualities: qualityHeights.slice() });
    };

    const installDesktopFullscreen = () => {
      const bridge = options.desktopBridge;
      if (!bridge || typeof bridge.setVideoFullscreen !== 'function' || !player) return;
      const button = player.elements && player.elements.buttons && player.elements.buttons.fullscreen;
      if (!button) return;
      const toggleFullscreen = async event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        desktopFullscreen = !desktopFullscreen;
        wrap.classList.toggle('plyr--fullscreen-fallback', desktopFullscreen);
        wrap.classList.toggle('ed-desktop-fullscreen', desktopFullscreen);
        if (player.elements.container) player.elements.container.classList.toggle('plyr--fullscreen-active', desktopFullscreen);
        document.body.style.overflow = desktopFullscreen ? 'hidden' : originalBodyOverflow;
        try { await bridge.setVideoFullscreen(desktopFullscreen); }
        catch (error) { console.error('[ED-ALL] Desktop fullscreen failed:', error); }
      };
      listen(button, 'click', toggleFullscreen, true);
      const escape = event => {
        if (event.key === 'Escape' && desktopFullscreen) {
          event.preventDefault();
          desktopFullscreen = false;
          wrap.classList.remove('plyr--fullscreen-fallback', 'ed-desktop-fullscreen');
          if (player && player.elements.container) player.elements.container.classList.remove('plyr--fullscreen-active');
          document.body.style.overflow = originalBodyOverflow;
          bridge.setVideoFullscreen(false).catch(() => {});
        }
      };
      listen(document, 'keydown', escape, true);
    };

    const recover = async cause => {
      if (disposed || recovering || !bundle || recoveryCount >= 4) return;
      recovering = true;
      recoveryCount++;
      const state = captureState();
      const preferred = selectedHeight;
      if (bundle.instance) excluded.add(bundle.instance);
      try {
        for (let attempt = 0; attempt < 6 && !disposed; attempt++) {
          const next = await fetchBundle(videoId, excluded);
          excluded.add(next.instance);
          try {
            const heights = await loadBundle(next, state, preferred);
            if (disposed) return;
            try { localStorage.setItem(LAST_KEY, next.instance); } catch (_) {}
            if (heights.join(',') !== qualityHeights.join(',')) installPlyr();
            else if (player && mode === 'shaka') {
              // Track references belong to the new Shaka instance; the visible choices stay the same.
            }
            recoveryCount = 0;
            toast(options.language === 'ar' ? 'تم الانتقال إلى خادم فيديو بديل.' : 'Switched to a backup video server.', 'success');
            return;
          } catch (error) {
            console.warn('[ED-ALL] Backup Piped instance failed:', next.instance, error);
            excluded.add(next.instance);
          }
        }
        throw cause || new Error('No remaining Piped instance could play this video.');
      } catch (error) {
        if (!disposed) toast(options.language === 'ar' ? 'تعذر استكمال الفيديو من خوادم Piped المتاحة.' : 'The available Piped servers could not continue this video.', 'error');
        console.error('[ED-ALL] Piped recovery failed:', error);
      } finally { recovering = false; }
    };

    try {
      const shaka = window.shaka;
      if (shaka && shaka.polyfill && shaka.polyfill.installAll) shaka.polyfill.installAll();
      if (shaka && shaka.Player && shaka.Player.isBrowserSupported && !shaka.Player.isBrowserSupported()) {
        console.warn('[ED-ALL] Shaka MSE playback is not supported; progressive Piped streams will be used when available.');
      }

      let preferred = 720;
      try { preferred = Number(localStorage.getItem(QUALITY_KEY)) || 720; } catch (_) {}
      let loaded = false;
      for (let attempt = 0; attempt < 10 && !disposed; attempt++) {
        const next = await fetchBundle(videoId, excluded);
        excluded.add(next.instance);
        try {
          await loadBundle(next, null, preferred);
          if (!qualityHeights.length && mode !== 'native-hls') throw new Error('The API returned no selectable qualities.');
          bundle = next;
          try { localStorage.setItem(LAST_KEY, next.instance); } catch (_) {}
          loaded = true;
          break;
        } catch (error) {
          console.warn('[ED-ALL] Piped instance did not provide playable streams:', next.instance, error);
          excluded.add(next.instance);
          await resetEngine();
        }
      }
      if (!loaded) throw new Error('No public Piped instance returned a playable DASH/HLS or progressive stream.');

      installPlyr();

      const onPlayerError = () => {
        if (!disposed && !switching && !recovering) void recover(new Error('Media playback error.'));
      };
      listen(video, 'error', onPlayerError);
      listen(video, 'waiting', () => {
        clearTimeout(stallTimer);
        if (!video.paused && !switching && !recovering) {
          stallTimer = setTimeout(() => {
            if (!disposed && !video.paused && video.readyState < 3) onPlayerError();
          }, 18000);
        }
      });
      listen(video, 'playing', () => { clearTimeout(stallTimer); });
      if (engine && typeof engine.addEventListener === 'function') {
        listen(engine, 'error', event => {
          const detail = event && event.detail;
          const critical = window.shaka && window.shaka.util && window.shaka.util.Error &&
            window.shaka.util.Error.Severity && detail &&
            detail.severity === window.shaka.util.Error.Severity.CRITICAL;
          if (critical && !switching && !recovering) void recover(detail);
        });
      }

      return { player, video, wrap, mode, qualities: qualityHeights.slice(), cleanup };
    } catch (error) {
      cleanup();
      if (player) { try { player.destroy(); } catch (_) {} }
      container._p = null;
      container._desktopCleanup = null;
      try { container.replaceChildren(); container.style.display = 'none'; } catch (_) {}
      throw error;
    }
  }

  window.EDPipedPlayer = Object.freeze({
    open,
    __test: Object.freeze({ cleanBase, mergeInstances, normalize, buildDashDataUri, validRange, getPreferredHeight })
  });
})();