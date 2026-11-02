(function () {
  'use strict';

  const DOCS_URL = 'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md';
  const CACHE_KEY = 'ed_piped_instances_v2';
  const LAST_KEY = 'ed_piped_last_instance_v2';
  const QUALITY_KEY = 'ed_piped_quality_v2';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const REGISTRY_URL = '/video-instances.json';
  const HEALTH_KEY = 'ed_video_instance_health_v1';
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

  function readInstanceHealth() {
    try {
      const value = JSON.parse(localStorage.getItem(HEALTH_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
  }

  function rememberInstanceOutcome(base, succeeded, elapsedMs) {
    try {
      const health = readInstanceHealth();
      const previous = health[base] || { successes: 0, failures: 0, averageMs: 0 };
      if (succeeded) {
        previous.successes = Math.min(100, Number(previous.successes || 0) + 1);
        previous.failures = Math.max(0, Number(previous.failures || 0) - 1);
        previous.lastSuccessAt = Date.now();
        const oldAverage = Number(previous.averageMs) || Number(elapsedMs) || 0;
        previous.averageMs = oldAverage ? Math.round(oldAverage * 0.7 + Number(elapsedMs || 0) * 0.3) : Number(elapsedMs) || 0;
      } else {
        previous.failures = Math.min(100, Number(previous.failures || 0) + 1);
        previous.lastFailureAt = Date.now();
      }
      health[base] = previous;
      const entries = Object.entries(health);
      if (entries.length > 80) {
        entries.sort((a, b) => Number(b[1].lastSuccessAt || 0) - Number(a[1].lastSuccessAt || 0));
        for (const [key] of entries.slice(80)) delete health[key];
      }
      localStorage.setItem(HEALTH_KEY, JSON.stringify(health));
    } catch (_) {}
  }

  async function getInstances() {
    const now = Date.now();
    let registry = null;
    try {
      const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (data && data.registry && now - Number(data.savedAt) < CACHE_TTL) registry = data.registry;
    } catch (_) {}

    if (!registry) {
      try {
        const response = await fetch(REGISTRY_URL, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout ? AbortSignal.timeout(6500) : undefined
        });
        if (response.ok) {
          const payload = await response.json();
          if (payload && payload.schemaVersion === 1 && payload.sources) {
            registry = payload;
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: now, registry })); } catch (_) {}
          }
        }
      } catch (error) {
        console.warn('[ED-ALL] Daily instance registry unavailable; using last known/fallback Piped list.', error);
      }
    }

    let discovered = [];
    const registryHealth = new Map();
    if (registry && Array.isArray(registry.sources && registry.sources.piped)) {
      const registered = registry.sources.piped.filter(item => item && item.official !== false);
      registered.forEach(item => {
        const url = typeof item === 'string' ? item : item.url;
        if (url) registryHealth.set(url, typeof item === 'string' ? { status: 'unknown', score: 0, responseMs: 999999 } : {
          status: item.status || 'unknown',
          score: Number(item.score) || 0,
          responseMs: Number(item.responseMs) || 999999
        });
      });
      discovered = registered
        .sort((a, b) => {
          const ah = typeof a === 'string' ? {} : a;
          const bh = typeof b === 'string' ? {} : b;
          const rank = value => value === 'healthy' ? 3 : value === 'degraded' ? 2 : value === 'unknown' ? 1 : 0;
          return rank(bh.status) - rank(ah.status) ||
            Number(bh.score || 0) - Number(ah.score || 0) ||
            Number(ah.responseMs || 999999) - Number(bh.responseMs || 999999);
        })
        .map(item => typeof item === 'string' ? item : item.url);
    }

    if (!discovered.length) {
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
        // The last known registry and hard-coded compatibility list remain available.
      } finally { clearTimeout(timer); }
    }

    const last = (() => { try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; } })();
    const health = readInstanceHealth();
    const list = mergeInstances([...discovered, ...FALLBACKS]);
    list.sort((a, b) => {
      const ah = health[a] || {};
      const bh = health[b] || {};
      const ar = registryHealth.get(a) || {};
      const br = registryHealth.get(b) || {};
      const aLocalScore = Number(ah.successes || 0) * 25 - Number(ah.failures || 0) * 100 - Number(ah.averageMs || 0) / 100;
      const bLocalScore = Number(bh.successes || 0) * 25 - Number(bh.failures || 0) * 100 - Number(bh.averageMs || 0) / 100;
      const rank = value => value === 'healthy' ? 3 : value === 'degraded' ? 2 : value === 'unknown' ? 1 : value === 'unhealthy' ? 0 : 1;
      const aRegistryRank = rank(ar.status);
      const bRegistryRank = rank(br.status);
      if (aRegistryRank !== bRegistryRank) return bRegistryRank - aRegistryRank;
      if (aLocalScore !== bLocalScore) return bLocalScore - aLocalScore;
      if (Number(ar.score || 0) !== Number(br.score || 0)) return Number(br.score || 0) - Number(ar.score || 0);
      if (Number(ar.responseMs || 999999) !== Number(br.responseMs || 999999)) return Number(ar.responseMs || 999999) - Number(br.responseMs || 999999);
      // The last successful server is only the final tie-breaker.
      if (a === last) return -1;
      if (b === last) return 1;
      return 0;
    });
    return list;
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
    const contentType = codec ? mime + '; codecs="' + codec + '"' : mime;
    const supported = value => value === 'probably' || value === 'maybe';

    // Prefer the native media element result when it explicitly accepts the codec.
    try {
      if (probe && typeof probe.canPlayType === 'function' && supported(probe.canPlayType(contentType))) {
        return true;
      }
    } catch (_) {}

    // MSE/Shaka can support codecs that HTMLMediaElement.canPlayType does not report.
    // Do not reject those streams solely because canPlayType returned an empty string.
    try {
      const mediaSource = window.MediaSource || window.ManagedMediaSource;
      if (mediaSource && typeof mediaSource.isTypeSupported === 'function' &&
          mediaSource.isTypeSupported(contentType)) {
        return true;
      }
    } catch (_) {}

    return false;
  }

  function normalizeInvidiousData(data) {
    if (!data || (!Array.isArray(data.formatStreams) && !Array.isArray(data.adaptiveFormats))) return data;
    const videoStreams = [];
    const audioStreams = [];

    const parseStream = (stream, adaptive) => {
      if (!stream || !stream.url) return;
      const type = String(stream.type || stream.mimeType || '');
      const mimeType = type.split(';')[0].trim().toLowerCase();
      const codecMatch = type.match(/codecs\s*=\s*["']?([^"';]+)/i);
      const codec = String(stream.codec || codecMatch && codecMatch[1] || stream.encoding || '').split(',')[0].trim();
      const rawQuality = String(stream.qualityLabel || stream.resolution || stream.quality || '');
      const dimension = rawQuality.match(/x(\d{3,4})\b/i);
      const label = rawQuality.match(/(\d{3,4})p\b/i);
      const generic = rawQuality.match(/(?:^|\D)(\d{3,4})(?:\D|$)/);
      const height = Number(dimension && dimension[1] || label && label[1] || generic && generic[1]) || 0;
      const base = {
        url: stream.url,
        mimeType,
        codec,
        format: /webm/i.test(mimeType) ? 'WEBM' : (/mp4/i.test(mimeType) ? 'MPEG_4' : ''),
        bitrate: Number(stream.bitrate) || 0,
        audioTrackId: stream.audioTrackId || stream.audioTrackLocale || 'default',
        itag: stream.itag || stream.id || ''
      };

      if (mimeType.indexOf('video/') === 0) {
        if (!height) return;
        videoStreams.push({
          ...base,
          quality: rawQuality || (height + 'p'),
          height,
          width: Number(String(stream.resolution || '').split('x')[0]) || Number(stream.width) || 0,
          videoOnly: !!adaptive
        });
      } else if (mimeType.indexOf('audio/') === 0) {
        audioStreams.push({
          ...base,
          audioTrackLocale: stream.audioTrackLocale || 'und',
          audioSamplingRate: Number(stream.audioSampleRate) || 0
        });
      }
    };

    (Array.isArray(data.formatStreams) ? data.formatStreams : []).forEach(stream => parseStream(stream, false));
    (Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : []).forEach(stream => parseStream(stream, true));

    return {
      ...data,
      provider: 'invidious',
      title: data.title || '',
      duration: Number(data.duration) || Number(data.lengthSeconds) || 0,
      livestream: data.livestream === true || data.liveNow === true,
      dash: data.dash || data.dashUrl || null,
      hls: data.hls || data.hlsUrl || null,
      videoStreams,
      audioStreams
    };
  }

  function normalize(data) {
    if (data && !Array.isArray(data.videoStreams) &&
        (Array.isArray(data.formatStreams) || Array.isArray(data.adaptiveFormats))) {
      data = normalizeInvidiousData(data);
    }
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
        videoOnly: stream.videoOnly === true || stream.videoOnly === 'true',
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
      provider: String(data.provider || 'piped'),
      title: String(data.title || ''),
      duration: Number(data.duration) || 0,
      proxyUrl,
      dash,
      hls,
      livestream: data.livestream === true,
      videoStreams,
      videos: videoStreams,
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
    if (!stream) return false;
    const values = ['indexStart', 'indexEnd', 'initStart', 'initEnd'].map(key => Number(stream[key]));
    return values.every(value => Number.isSafeInteger(value) && value >= 0) &&
      values[1] > values[0] && values[3] > values[2];
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

  function scoreBundle(bundle) {
    const videos = (bundle && (bundle.videoStreams || bundle.videos)) || [];
    const heights = Array.from(new Set(videos.map(item => Number(item.height)).filter(Number.isFinite)));
    const maxHeight = heights.length ? Math.max(...heights) : 0;
    return heights.length * 100000 +
      Math.min(maxHeight, 4320) * 10 +
      (bundle.videoOnly && bundle.videoOnly.length && bundle.audioStreams && bundle.audioStreams.length ? 500 : 0) +
      (bundle.muxedVideos && bundle.muxedVideos.length ? 100 : 0) +
      (bundle.dash ? 50 : 0) +
      (bundle.hls ? 25 : 0);
  }

  function readErrorMessage(error) {
    return String(error && error.message || error || 'Unknown extraction error');
  }

  async function fetchPipedBundle(videoId, excluded) {
    const instances = (await getInstances()).filter(base => !excluded.has(base));
    const batchSize = 8;
    let best = null;
    let bestScore = -1;
    for (let offset = 0; offset < instances.length; offset += batchSize) {
      const controllers = [];
      const requests = instances.slice(offset, offset + batchSize).map(base => {
        const controller = new AbortController();
        controllers.push(controller);
        let timer = null;
        const started = Date.now();
        return new Promise((resolve, reject) => {
          timer = setTimeout(() => controller.abort(), 4500);
          fetch(base + '/streams/' + encodeURIComponent(videoId), {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
            headers: { Accept: 'application/json' }
          }).then(async response => {
            if (!response.ok) throw new Error('Piped HTTP ' + response.status);
            const data = await response.json();
            const bundle = normalize(data);
            if (!bundle) throw new Error('No compatible video streams');
            const elapsed = Date.now() - started;
            resolve({ ...bundle, instance: base, provider: 'piped', requestElapsedMs: elapsed });
          }).catch(error => {
            rememberInstanceOutcome(base, false, Date.now() - started);
            reject(error);
          }).finally(() => clearTimeout(timer));
        });
      });
      const results = await Promise.allSettled(requests);
      controllers.forEach(controller => { try { controller.abort(); } catch (_) {} });
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const candidate = result.value;
        const score = scoreBundle(candidate);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }

      const bestHeights = best
        ? Array.from(new Set((best.videoStreams || best.videos || []).map(item => Number(item.height)))).filter(height => height > 0)
        : [];
      if (bestHeights.length >= 3 && Math.max(...bestHeights) >= 720) break;
    }
    if (!best) throw new Error('All public Piped API instances failed or returned no compatible streams.');
    try { localStorage.setItem(LAST_KEY, best.instance); } catch (_) {}
    console.info('[ED-ALL] Selected Piped instance:', {
      instance: best.instance,
      qualities: (best.videoStreams || []).map(item => item.height),
      videoOnly: best.videoOnly.length,
      muxed: best.muxedVideos.length,
      audio: best.audioStreams.length
    });
    return best;
  }

  async function fetchInvidiousBundle(videoId, excluded, extractorConfig) {
    const requestStartedAt = Date.now();
    const config = extractorConfig || {};
    if (!config.supabaseUrl || !config.anonKey) {
      throw new Error('Invidious extraction is not configured for this page.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18500);
    try {
      const response = await fetch(String(config.supabaseUrl).replace(/\/$/, '') + '/functions/v1/extract-youtube-stream', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.anonKey,
          'Authorization': 'Bearer ' + config.anonKey,
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          videoId,
          excludeInstances: Array.from(excluded).filter(value => /^https:\/\/[a-z0-9.-]+$/i.test(String(value)))
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error('Invidious extractor HTTP ' + response.status + ': ' + readErrorMessage(payload.error || payload.message));
      }
      const bundle = normalize(payload);
      if (!bundle) throw new Error('Invidious returned no browser-compatible streams.');
      if (!payload.instance) throw new Error('Invidious response omitted the selected instance.');
      return { ...bundle, instance: payload.instance, provider: 'invidious', requestElapsedMs: Date.now() - requestStartedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchBundle(videoId, excluded, extractorConfig) {
    const pipedPromise = fetchPipedBundle(videoId, excluded)
      .then(bundle => ({ provider: 'piped', bundle }))
      .catch(error => ({ provider: 'piped', error }));
    const invidiousPromise = fetchInvidiousBundle(videoId, excluded, extractorConfig)
      .then(bundle => ({ provider: 'invidious', bundle }))
      .catch(error => ({ provider: 'invidious', error }));

    const first = await Promise.race([pipedPromise, invidiousPromise]);
    if (first.error) {
      const other = await (first.provider === 'piped' ? invidiousPromise : pipedPromise);
      if (other.error) {
        throw new Error('Piped and Invidious extraction failed. ' +
          first.provider + ': ' + readErrorMessage(first.error) + ' | ' +
          other.provider + ': ' + readErrorMessage(other.error));
      }
      try { localStorage.setItem(LAST_KEY, other.bundle.instance); } catch (_) {}
      return other.bundle;
    }

    const firstBundle = first.bundle;
    const heights = Array.from(new Set((firstBundle.videoStreams || []).map(item => Number(item.height)).filter(height => height > 0)));
    const hasPlayablePath = firstBundle.muxedVideos.length > 0 ||
      (firstBundle.videoOnly.length > 0 && firstBundle.audioStreams.length > 0) ||
      !!firstBundle.dash || !!firstBundle.hls;
    const alreadyStrong = hasPlayablePath && heights.length >= 2 && Math.max(...heights) >= 720;

    let candidates = [firstBundle];
    if (!alreadyStrong) {
      const otherPromise = first.provider === 'piped' ? invidiousPromise : pipedPromise;
      const second = await Promise.race([
        otherPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
      ]);
      if (second && second.bundle) candidates.push(second.bundle);
    }

    candidates.sort((a, b) => {
      const score = scoreBundle(b) - scoreBundle(a);
      if (score) return score;
      return a.provider === 'piped' ? -1 : 1;
    });
    const best = candidates[0];
    try { localStorage.setItem(LAST_KEY, best.instance); } catch (_) {}
    console.info('[ED-ALL] Unified extractor selected a source:', {
      provider: best.provider,
      instance: best.instance,
      qualities: (best.videoStreams || []).map(item => item.height),
      videoOnly: best.videoOnly.length,
      muxed: best.muxedVideos.length,
      audio: best.audioStreams.length
    });
    return best;
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
      if (video.src === url && video.readyState >= 3) {
        resolve();
        return;
      }
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
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.hidden = true;
    audio.setAttribute('aria-hidden', 'true');
    wrap.append(video, audio);
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
    let separateAudioStream = null;
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
      try { video.pause(); audio.pause(); } catch (_) {}
      if (engine) { const old = engine; engine = null; old.destroy().catch(() => {}); }
      try { video.removeAttribute('src'); video.load(); } catch (_) {}
      try { audio.removeAttribute('src'); audio.load(); } catch (_) {}
      separateAudioStream = null;
    };
    container._desktopCleanup = cleanup;

    const resetEngine = async () => {
      if (engine) {
        const old = engine;
        engine = null;
        try { await old.destroy(); } catch (_) {}
      }
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
      separateAudioStream = null;
      mode = '';
      variantTracks = [];
      muxedVideos = [];
    };

    const createManifest = current => {
      if (current.dash) {
        try {
          // Keep Piped's DASH URL untouched. Piped Proxy rewrites manifest media URLs
          // by default; forcing rewrite=false can expose direct GoogleVideo URLs and
          // make playback fail in browsers that cannot reach those hosts.
          const url = new URL(current.dash);
          if (url.protocol === 'https:') return { uri: url.toString(), mime: 'application/dash+xml' };
        } catch (_) {}
      }
      if (current.hls) return { uri: current.hls, mime: 'application/x-mpegurl' };
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

    const waitForShakaVariant = (shakaPlayer, requestedTrack) => new Promise((resolve, reject) => {
      if (!shakaPlayer || !requestedTrack) {
        reject(new Error('A valid Shaka video variant was not selected.'));
        return;
      }
      const current = shakaPlayer.getVariantTracks().find(item => item.active);
      if (current && String(current.id) === String(requestedTrack.id)) {
        resolve();
        return;
      }
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (typeof shakaPlayer.removeEventListener === 'function') {
          shakaPlayer.removeEventListener('variantchanged', onVariantChanged);
        }
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Shaka did not confirm the requested quality within 15 seconds.')), 15000);
      const onVariantChanged = event => {
        const nextTrack = event && event.newTrack
          ? event.newTrack
          : (event && event.detail && event.detail.newTrack ? event.detail.newTrack : null);
        // Shaka's variantchanged event is the confirmation for an explicit
        // selectVariantTrack call. Do not require a second active-track snapshot,
        // which may lag behind the event in some WebViews.
        if (nextTrack && String(nextTrack.id) === String(requestedTrack.id)) finish();
      };
      if (typeof shakaPlayer.addEventListener !== 'function') {
        finish(new Error('Shaka cannot confirm video quality changes.'));
        return;
      }
      shakaPlayer.addEventListener('variantchanged', onVariantChanged);
      try {
        shakaPlayer.selectVariantTrack(requestedTrack, true, 5);
        const activeAfterSelection = shakaPlayer.getVariantTracks().find(item => item.active);
        if (activeAfterSelection && String(activeAfterSelection.id) === String(requestedTrack.id)) finish();
      } catch (error) {
        finish(error);
      }
    });

    const loadProgressiveFallback = async (current, preferredHeight) => {
      muxedVideos = current.muxedVideos.slice().sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

      // If MSE/DASH is unavailable, play the adaptive video-only MP4/WebM file
      // together with its matching audio stream. This keeps 1080p/1440p/2160p
      // available on browsers and Android WebViews that cannot load Shaka DASH.
      const videoOnlyStreams = current.videoOnly.slice().sort((a, b) =>
        b.height - a.height || Number(b.mimeType === 'video/mp4') - Number(a.mimeType === 'video/mp4') || b.bitrate - a.bitrate
      );
      if (videoOnlyStreams.length && current.audioStreams.length) {
        mode = 'separate';
        qualityHeights = Array.from(new Set(videoOnlyStreams.map(item => Number(item.height)))).sort((a, b) => b - a);
        selectedHeight = getPreferredHeight(qualityHeights, preferredHeight);
        const initial = chooseMuxed(videoOnlyStreams, selectedHeight);
        const matchingAudio = initial && current.audioStreams.find(item =>
          initial.audioTrackId && initial.audioTrackId !== 'default' &&
          item.audioTrackId && item.audioTrackId === initial.audioTrackId
        );
        separateAudioStream = matchingAudio || current.audioStreams[0];
        if (!initial || !separateAudioStream) throw new Error('Piped returned adaptive video without a compatible audio stream.');
        try {
          await Promise.all([
            waitForCanPlay(video, initial.url, 18000),
            waitForCanPlay(audio, separateAudioStream.url, 18000)
          ]);
          audio.volume = video.volume;
          audio.muted = video.muted;
          audio.playbackRate = video.playbackRate;
          return;
        } catch (adaptiveError) {
          console.warn('[ED-ALL] Adaptive video/audio pair failed; trying muxed streams from the same response:', adaptiveError);
          try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
          try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
          separateAudioStream = null;
          mode = '';
          qualityHeights = [];
          selectedHeight = 0;
        }
      }

      qualityHeights = Array.from(new Set(muxedVideos.map(item => Number(item.height)))).sort((a, b) => b - a);
      if (qualityHeights.length) {
        mode = 'direct';
        selectedHeight = getPreferredHeight(qualityHeights, preferredHeight);
        const initial = chooseMuxed(muxedVideos, selectedHeight);
        if (!initial) throw new Error('No compatible progressive stream matched the selected quality.');
        await waitForCanPlay(video, initial.url, 18000);
        return;
      }

      if (current.hls && video.canPlayType('application/vnd.apple.mpegurl')) {
        mode = 'native-hls';
        qualityHeights = [];
        await waitForCanPlay(video, current.hls, 18000);
        return;
      }

      throw new Error('No compatible DASH, HLS or progressive video stream was returned.');
    };

    const loadBundle = async (next, restoreState, preferredHeight) => {
      await resetEngine();
      bundle = next;
      const manifest = createManifest(next);
      const hasShaka = !!(window.shaka && window.shaka.Player);
      const supported = hasShaka && !!(window.MediaSource || window.ManagedMediaSource) &&
        (!window.shaka.Player.isBrowserSupported || window.shaka.Player.isBrowserSupported());

      let loadedWithShaka = false;
      if (manifest && supported) {
        const shakaPlayer = new window.shaka.Player();
        engine = shakaPlayer;
        try {
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
          if (!qualityHeights.length) throw new Error('The DASH manifest contains no selectable video qualities.');
          mode = 'shaka';
          selectedHeight = getPreferredHeight(qualityHeights, preferredHeight);
          const selectedTrack = chooseVariant(variantTracks, selectedHeight);
          if (!selectedTrack) throw new Error('The requested initial video quality is not present in the DASH manifest.');
          await waitForShakaVariant(shakaPlayer, selectedTrack);
          loadedWithShaka = true;
        } catch (shakaError) {
          if (disposed) throw shakaError;
          console.warn('[ED-ALL] Piped DASH/Shaka load failed; trying direct streams from the same API response:', shakaError);
          if (engine === shakaPlayer) engine = null;
          try { await shakaPlayer.destroy(); } catch (_) {}
          try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
          variantTracks = [];
          qualityHeights = [];
          mode = '';
          if (!next.muxedVideos.length && !next.hls && !(next.videoOnly.length && next.audioStreams.length)) throw shakaError;
        }
      }

      if (!loadedWithShaka) {
        if (manifest && !supported) {
          console.warn('[ED-ALL] Shaka/MSE is unavailable; using progressive or native HLS Piped streams.');
        }
        await loadProgressiveFallback(next, preferredHeight);
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
      const previousHeight = selectedHeight;
      const previousAudioStream = separateAudioStream;
      const savedState = captureState();
      switching = true;
      try {
        if (mode === 'shaka' && engine) {
          const activeEngine = engine;
          const track = chooseVariant(variantTracks, requested);
          if (!track) throw new Error('The selected quality is not present in the loaded DASH manifest.');

          // Shaka schedules a manual variant change; wait for its confirmation event
          // instead of assuming that calling selectVariantTrack means it was applied.
          await waitForShakaVariant(activeEngine, track);
          selectedHeight = requested;
        } else if (mode === 'direct') {
          const target = chooseMuxed(muxedVideos, requested);
          if (!target) throw new Error('The selected progressive quality is unavailable.');
          video.pause();
          await waitForCanPlay(video, target.url, 18000);
          if (savedState.time > 0) await seekVideo(video, savedState.time);
          video.playbackRate = savedState.rate;
          video.volume = savedState.volume;
          video.muted = savedState.muted;
          selectedHeight = requested;
          if (savedState.playing) await video.play();
        } else if (mode === 'separate') {
          const target = chooseMuxed(bundle.videoOnly, requested);
          if (!target || !separateAudioStream) throw new Error('The selected adaptive video/audio pair is unavailable.');
          const matchingAudio = bundle.audioStreams.find(item =>
            target.audioTrackId && target.audioTrackId !== 'default' &&
            item.audioTrackId && item.audioTrackId === target.audioTrackId
          );
          const nextAudioStream = matchingAudio || separateAudioStream;
          video.pause();
          audio.pause();
          await Promise.all([
            waitForCanPlay(video, target.url, 18000),
            waitForCanPlay(audio, nextAudioStream.url, 18000)
          ]);
          if (savedState.time > 0) {
            await Promise.all([seekVideo(video, savedState.time), seekVideo(audio, savedState.time)]);
          }
          separateAudioStream = nextAudioStream;
          video.playbackRate = savedState.rate;
          video.volume = savedState.volume;
          video.muted = savedState.muted;
          audio.playbackRate = savedState.rate;
          audio.volume = savedState.volume;
          audio.muted = savedState.muted;
          selectedHeight = requested;
          if (savedState.playing) await video.play();
        }
        try { localStorage.setItem(QUALITY_KEY, String(selectedHeight)); } catch (_) {}
      } catch (error) {
        console.warn('[ED-ALL] Piped quality selection failed:', error);
        // Restore the previous visible choice as well as the previous stream when using direct files.
        if (previousHeight && player) {
          try { player.quality = previousHeight; } catch (_) {}
        }
        let restored = false;
        if (mode === 'direct' && previousHeight) {
          const previousStream = chooseMuxed(muxedVideos, previousHeight);
          if (previousStream) {
            try {
              await waitForCanPlay(video, previousStream.url, 18000);
              if (savedState.time > 0) await seekVideo(video, savedState.time);
              video.playbackRate = savedState.rate;
              video.volume = savedState.volume;
              video.muted = savedState.muted;
              selectedHeight = previousHeight;
              if (savedState.playing) await video.play();
              restored = true;
            } catch (restoreError) {
              console.warn('[ED-ALL] Could not restore the previous Piped quality:', restoreError);
            }
          }
        } else if (mode === 'separate' && previousHeight && previousAudioStream) {
          const previousStream = chooseMuxed(bundle.videoOnly, previousHeight);
          if (previousStream) {
            try {
              await waitForCanPlay(video, previousStream.url, 18000);
              await waitForCanPlay(audio, previousAudioStream.url, 18000);
              if (savedState.time > 0) {
                await Promise.all([seekVideo(video, savedState.time), seekVideo(audio, savedState.time)]);
              }
              separateAudioStream = previousAudioStream;
              video.playbackRate = audio.playbackRate = savedState.rate;
              video.volume = audio.volume = savedState.volume;
              video.muted = audio.muted = savedState.muted;
              selectedHeight = previousHeight;
              if (savedState.playing) await video.play();
              restored = true;
            } catch (restoreError) {
              console.warn('[ED-ALL] Could not restore the previous Piped video/audio pair:', restoreError);
            }
          }
        } else if (mode === 'shaka' && engine && previousHeight) {
          const previousTrack = chooseVariant(variantTracks, previousHeight);
          if (previousTrack) {
            try {
              await waitForShakaVariant(engine, previousTrack);
              selectedHeight = previousHeight;
              restored = true;
            } catch (restoreError) {
              console.warn('[ED-ALL] Could not restore the previous Shaka variant:', restoreError);
            }
          }
        }
        toast(options.language === 'ar' ? 'تعذر تطبيق الجودة المختارة؛ تمت محاولة استعادة الجودة السابقة.' : 'The selected quality failed; the previous quality was restored when possible.', 'error');
        if (!restored && bundle && bundle.instance) void recover(error, savedState);
        else if (restored) selectedHeight = previousHeight;
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
      if (typeof options.onReady === 'function') options.onReady({ player, video, audio, wrap, mode, qualities: qualityHeights.slice() });
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

    let watchedEngine = null;
    const watchEngineErrors = () => {
      if (!engine || watchedEngine === engine || typeof engine.addEventListener !== 'function') return;
      watchedEngine = engine;
      listen(engine, 'error', event => {
        const detail = event && event.detail;
        const critical = window.shaka && window.shaka.util && window.shaka.util.Error &&
          window.shaka.util.Error.Severity && detail &&
          detail.severity === window.shaka.util.Error.Severity.CRITICAL;
        if (critical && !switching && !recovering) void recover(detail);
      });
    };

    const recover = async (cause, restoreOverride) => {
      if (disposed || recovering || !bundle || recoveryCount >= 4) return;
      recovering = true;
      recoveryCount++;
      const state = restoreOverride || captureState();
      const preferred = selectedHeight;
      if (bundle.instance) excluded.add(bundle.instance);
      try {
        for (let attempt = 0; attempt < 6 && !disposed; attempt++) {
          const next = await fetchBundle(videoId, excluded, options.extractorConfig);
          excluded.add(next.instance);
          try {
            const heights = await loadBundle(next, state, preferred);
            if (disposed) return;
            rememberInstanceOutcome(next.instance, true, Number(next.requestElapsedMs || (next.diagnostics && next.diagnostics.selectedInstanceMs) || 0));
            watchEngineErrors();
            try { localStorage.setItem(LAST_KEY, next.instance); } catch (_) {}
            if (heights.join(',') !== qualityHeights.join(',')) installPlyr();
            else if (player && mode === 'shaka') {
              // Track references belong to the new Shaka instance; the visible choices stay the same.
            }
            recoveryCount = 0;
            toast(options.language === 'ar' ? 'تم الانتقال إلى خادم فيديو بديل.' : 'Switched to a backup video server.', 'success');
            return;
          } catch (error) {
            rememberInstanceOutcome(next.instance, false, Number(next.requestElapsedMs || 0));
            console.warn('[ED-ALL] Backup video instance failed during playback:', next.instance, error);
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
        const next = await fetchBundle(videoId, excluded, options.extractorConfig);
        excluded.add(next.instance);
        try {
          await loadBundle(next, null, preferred);
          if (!qualityHeights.length && mode !== 'native-hls') throw new Error('The API returned no selectable qualities.');
          rememberInstanceOutcome(next.instance, true, Number(next.requestElapsedMs || (next.diagnostics && next.diagnostics.selectedInstanceMs) || 0));
          bundle = next;
          try { localStorage.setItem(LAST_KEY, next.instance); } catch (_) {}
          loaded = true;
          break;
        } catch (error) {
          rememberInstanceOutcome(next.instance, false, Number(next.requestElapsedMs || 0));
          console.warn('[ED-ALL] Video instance did not provide playable streams:', next.instance, error);
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
      watchEngineErrors();

      const syncSeparateAudio = force => {
        if (mode !== 'separate' || !separateAudioStream || audio.readyState < 1) return;
        audio.playbackRate = video.playbackRate;
        audio.volume = video.volume;
        audio.muted = video.muted;
        const drift = Math.abs((Number(audio.currentTime) || 0) - (Number(video.currentTime) || 0));
        if (force || drift > 0.6) {
          try { audio.currentTime = Math.max(0, Number(video.currentTime) || 0); } catch (_) {}
        }
      };
      const startSeparateAudio = () => {
        if (mode !== 'separate' || !separateAudioStream || disposed || video.paused) return;
        syncSeparateAudio(true);
        if (!audio.paused) return;
        audio.play().catch(error => {
          if (!disposed && mode === 'separate' && !video.paused) {
            console.warn('[ED-ALL] Separate Piped audio could not start:', error);
            const state = captureState();
            video.pause();
            void recover(error, state);
          }
        });
      };
      // Start the companion audio as soon as the media element receives play,
      // while the user's play gesture is still active; keep playing as a retry.
      listen(video, 'play', startSeparateAudio);
      listen(video, 'playing', startSeparateAudio);
      listen(video, 'pause', () => { if (mode === 'separate') audio.pause(); });
      listen(video, 'waiting', () => { if (mode === 'separate') audio.pause(); });
      listen(video, 'seeking', () => { if (mode === 'separate') audio.pause(); });
      listen(video, 'seeked', () => { if (mode === 'separate') { syncSeparateAudio(true); startSeparateAudio(); } });
      listen(video, 'timeupdate', () => { if (mode === 'separate' && !audio.paused) syncSeparateAudio(false); });
      listen(video, 'ratechange', () => { if (mode === 'separate') audio.playbackRate = video.playbackRate; });
      listen(video, 'volumechange', () => {
        if (mode === 'separate') { audio.volume = video.volume; audio.muted = video.muted; }
      });
      listen(video, 'ended', () => { if (mode === 'separate') audio.pause(); });
      listen(audio, 'error', () => {
        if (!disposed && mode === 'separate' && !switching && !recovering && !video.paused) {
          const state = captureState();
          void recover(new Error('The separate Piped audio stream failed.'), state);
        }
      });

      return { player, video, audio, wrap, mode, qualities: qualityHeights.slice(), cleanup };
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
    __test: Object.freeze({ cleanBase, mergeInstances, normalize, normalizeInvidiousData, buildDashDataUri, validRange, getPreferredHeight, browserSupports, chooseMuxed, scoreBundle })
  });
})();