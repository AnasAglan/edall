import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PIPED_SOURCE = "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
const INVIDIOUS_SOURCE = "https://api.invidious.io/instances.json?sort_by=health";
const INVIDIOUS_DOCS_SOURCE = "https://raw.githubusercontent.com/iv-org/documentation/master/docs/instances.md";
const OUTPUT = new URL("../public/video-instances.json", import.meta.url);
export const SAMPLE_VIDEO_IDS = ["dQw4w9WgXcQ", "aqz-KE-bpKQ"];
export const CURATED_INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
].map((url) => ({
  url,
  provider: "invidious",
  official: false,
  curated: true,
  apiListed: false,
  apiProbeCandidate: true,
  source: "curated-public-clearnet",
}));
const REQUEST_TIMEOUT_MS = 7000;
const PROBE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CONCURRENCY = 8;

function cleanBase(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.port && url.port !== "443") return null;
    if (/(^|[-.])(ygg|i2p|onion)([.-]|$)/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueByUrl(items) {
  const found = new Map();
  for (const item of items) {
    const url = cleanBase(item.url);
    if (!url) continue;
    if (!found.has(url)) found.set(url, { ...item, url });
  }
  return [...found.values()];
}

export async function fetchDirectoryResponse(url, headers, fetchImpl = fetch) {
  const maxAttempts = 3;
  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) {
        const error = new Error("HTTP " + response.status + " from " + url);
        error.status = response.status;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === maxAttempts) break;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }

  const detail = lastError && lastError.message ? lastError.message : String(lastError || "unknown error");
  throw new Error("Directory fetch failed after " + attemptsMade + (attemptsMade === 1 ? " attempt: " : " attempts: ") + detail);
}

async function fetchJson(url) {
  const response = await fetchDirectoryResponse(url, {
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": PROBE_USER_AGENT,
  });
  return response.json();
}

async function fetchText(url) {
  const response = await fetchDirectoryResponse(url, {
    Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
    "User-Agent": PROBE_USER_AGENT,
  });
  return response.text();
}

export function discoverPiped(markdown) {
  const urls = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    // The published table is: instance name | API URL | location | CDN | users.
    // Search the complete row rather than relying on a brittle pipe-cell index.
    for (const match of line.matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
      const url = cleanBase(match[0]);
      if (!url) continue;
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes("piped") || hostname.startsWith("pa.")) {
        urls.push({ url, provider: "piped", official: true });
      }
    }
  }
  return uniqueByUrl(urls);
}

export function supportsInvidiousApi(instance) {
  return instance?.provider !== "invidious" ||
    instance?.apiListed === true ||
    instance?.apiProbeCandidate === true;
}

export function discoverInvidious(payload) {
  if (!Array.isArray(payload)) throw new Error("Invalid Invidious instances API response.");
  const entries = [];
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const meta = row[1] || {};
    if (String(meta.type || "").toLowerCase() !== "https") continue;
    const url = cleanBase(meta.uri || ("https://" + row[0]));
    if (!url) continue;
    const monitor = meta.monitor || {};
    entries.push({
      url,
      provider: "invidious",
      official: true,
      apiListed: meta.api === true,
      directoryApiListed: meta.api === true,
      apiProbeCandidate: true,
      cors: meta.cors === true,
      uptime: Number(monitor.uptime) || null,
      monitorDown: monitor.down === true,
      listedVersion: meta.stats && meta.stats.software ? meta.stats.software.version || null : null,
    });
  }
  return uniqueByUrl(entries);
}

export function discoverInvidiousFromMarkdown(markdown) {
  const entries = [];
  let inPublicInstances = false;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^#{2,6}\s+List of public Invidious Instances\b/i.test(trimmed)) {
      inPublicInstances = true;
      continue;
    }
    if (inPublicInstances && /^#{1,6}\s+/.test(trimmed)) break;
    if (!inPublicInstances) continue;

    const match = trimmed.match(/^[*-]\s+\[[^\]]+\]\((https:\/\/[^)\s]+)\)/i);
    if (!match) continue;
    const url = cleanBase(match[1]);
    if (!url) continue;
    entries.push({
      url,
      provider: "invidious",
      official: true,
      apiListed: false,
      directoryApiListed: false,
      apiProbeCandidate: true,
      source: "official-documentation-fallback",
    });
  }
  return uniqueByUrl(entries);
}

export async function fetchInvidiousDirectory({
  fetchApi = () => fetchJson(INVIDIOUS_SOURCE),
  fetchDocs = () => fetchText(INVIDIOUS_DOCS_SOURCE),
} = {}) {
  let apiError;
  try {
    const instances = discoverInvidious(await fetchApi());
    if (instances.length) return instances;
    throw new Error("Invidious instances API returned no validated public HTTPS endpoints.");
  } catch (error) {
    apiError = error;
  }

  try {
    const instances = discoverInvidiousFromMarkdown(await fetchDocs());
    if (!instances.length) {
      throw new Error("Official Invidious documentation contained no validated public HTTPS instances.");
    }
    console.warn(
      "[video-registry] Invidious API unavailable; using the official documentation list as fallback:",
      String(apiError?.message || apiError)
    );
    return instances;
  } catch (docsError) {
    throw new Error(
      "Invidious API failed (" + String(apiError?.message || apiError) +
      "); official documentation fallback failed (" + String(docsError?.message || docsError) + ")."
    );
  }
}

function parseQuality(stream) {
  const raw = String(stream.height || stream.qualityLabel || stream.resolution || stream.quality || "");
  const dimension = raw.match(/x(\d{3,4})\b/i);
  const label = raw.match(/(\d{3,4})p\b/i);
  const number = raw.match(/(?:^|\D)(\d{3,4})(?:\D|$)/);
  return Number(dimension && dimension[1] || label && label[1] || number && number[1]) || 0;
}

function pipedHasStreams(data) {
  const videos = Array.isArray(data && data.videoStreams) ? data.videoStreams : [];
  const audios = Array.isArray(data && data.audioStreams) ? data.audioStreams : [];
  const heights = [...new Set(videos.map(parseQuality).filter(Boolean))];
  return {
    valid: videos.some((s) => s && /^https:\/\//i.test(String(s.url || ""))) || !!(data && (data.dash || data.hls)),
    videoCount: videos.length,
    audioCount: audios.length,
    heights,
  };
}

function invidiousHasStreams(data) {
  const formats = Array.isArray(data && data.formatStreams) ? data.formatStreams : [];
  const adaptive = Array.isArray(data && data.adaptiveFormats) ? data.adaptiveFormats : [];
  const all = formats.concat(adaptive);
  const videos = all.filter((s) => String(s && s.type || "").startsWith("video/"));
  const audios = all.filter((s) => String(s && s.type || "").startsWith("audio/"));
  const heights = [...new Set(videos.map(parseQuality).filter(Boolean))];
  return {
    valid: all.some((s) => s && /^https:\/\//i.test(String(s.url || ""))) || !!(data && (data.dashUrl || data.hlsUrl)),
    videoCount: videos.length,
    audioCount: audios.length,
    heights,
  };
}

async function probeMediaRange(url) {
  if (!url) return { ok: false, status: null, cors: null, error: "No direct media URL was returned." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1", Origin: "https://edall.lovable.app", "User-Agent": PROBE_USER_AGENT },
      signal: controller.signal,
      cache: "no-store",
    });
    const cors = response.headers.get("access-control-allow-origin");
    const contentType = response.headers.get("content-type") || "";
    const httpOk = response.status === 206 || response.status === 200;
    const isManifest = /mpegurl|dash\+xml/i.test(contentType) || /\.m3u8?(?:[?#]|$)/i.test(url);
    const mediaTypeOk = !/(text\/html|application\/json)/i.test(contentType) && !isManifest;
    const result = {
      ok: httpOk && mediaTypeOk,
      isManifest,
      status: response.status,
      cors,
      corsAllowed: cors === "*" || cors === "https://edall.lovable.app",
      rangeSupported: response.status === 206,
      contentType,
      error: !httpOk ? "Media HTTP " + response.status : isManifest ? "The URL returned a manifest, not a media segment." : !mediaTypeOk ? "Media URL returned a non-media content type: " + contentType : null,
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { ok: false, isManifest: false, status: null, cors: null, error: String(error && error.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

function parseHlsAttributes(line) {
  const result = {};
  const source = String(line || "").replace(/^#[^:]+:/, "");
  for (const match of source.matchAll(/([A-Z0-9-]+)=("([^"]*)"|([^,]*))/gi)) {
    result[match[1].toUpperCase()] = match[3] !== undefined ? match[3] : match[4];
  }
  return result;
}

export function parseHlsPlaylist(body, baseUrl, fallbackHeight = 0) {
  const lines = String(body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const audioTracks = [];
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#EXT-X-MEDIA:/i.test(line)) {
      const attrs = parseHlsAttributes(line);
      if (String(attrs.TYPE || "").toUpperCase() === "AUDIO" && attrs.URI) {
        try {
          const uri = new URL(attrs.URI, baseUrl);
          if (uri.protocol === "https:") audioTracks.push({ groupId: attrs["GROUP-ID"] || "", url: uri.href });
        } catch {}
      }
    }
    if (/^#EXT-X-STREAM-INF:/i.test(line)) {
      const attrs = parseHlsAttributes(line);
      const nextUri = lines.slice(index + 1).find((value) => value && !value.startsWith("#"));
      if (!nextUri) continue;
      try {
        const uri = new URL(nextUri, baseUrl);
        if (uri.protocol !== "https:") continue;
        const resolution = String(attrs.RESOLUTION || "").match(/\d+x(\d+)/i);
        variants.push({
          url: uri.href,
          height: Number(resolution && resolution[1]) || Number(fallbackHeight) || 0,
          audioGroup: attrs.AUDIO || "",
        });
      } catch {}
    }
  }
  let segmentUrl = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^#EXTINF:/i.test(lines[index])) continue;
    const nextUri = lines.slice(index + 1).find((value) => value && !value.startsWith("#"));
    if (!nextUri) continue;
    try {
      const uri = new URL(nextUri, baseUrl);
      if (uri.protocol === "https:") { segmentUrl = uri.href; break; }
    } catch {}
  }
  if (!segmentUrl && !variants.length) {
    const nextUri = lines.find((value) => value && !value.startsWith("#") && /^https?:|^[^:]/i.test(value));
    if (nextUri) {
      try {
        const uri = new URL(nextUri, baseUrl);
        if (uri.protocol === "https:") segmentUrl = uri.href;
      } catch {}
    }
  }
  return { variants, audioTracks, segmentUrl };
}

async function probeHlsPlaylist(url, expectedHeight = 0, depth = 0, initial = null) {
  if (depth > 3) return { ok: false, format: "hls", height: expectedHeight, audioAvailable: false, error: "HLS playlist nesting limit reached." };
  let body = initial && initial.body;
  let corsAllowed = !!(initial && initial.corsAllowed);
  let status = initial && initial.status;
  let contentType = initial && initial.contentType;
  if (typeof body !== "string") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*", Origin: "https://edall.lovable.app" },
        cache: "no-store",
      });
      status = response.status;
      contentType = response.headers.get("content-type");
      const cors = response.headers.get("access-control-allow-origin");
      corsAllowed = cors === "*" || cors === "https://edall.lovable.app";
      body = response.ok ? await response.text() : "";
      if (!response.ok || !/#EXTM3U/i.test(body) || !corsAllowed) {
        return {
          ok: false, format: "hls", status, cors, corsAllowed, contentType,
          height: expectedHeight, audioAvailable: false,
          error: !response.ok ? "Playlist HTTP " + response.status : !corsAllowed ? "Playlist CORS is not allowed." : "Response is not an HLS playlist.",
        };
      }
    } catch (error) {
      return { ok: false, format: "hls", status: null, corsAllowed: false, contentType: null, height: expectedHeight, audioAvailable: false, error: String(error && error.message || error).slice(0, 180) };
    } finally {
      clearTimeout(timer);
    }
  }
  const parsed = parseHlsPlaylist(body, url, expectedHeight);
  if (parsed.variants.length) {
    const bestVariants = parsed.variants.sort((a, b) => b.height - a.height).slice(0, 3);
    const checks = await Promise.all(bestVariants.map(async (variant) => {
      const video = await probeHlsPlaylist(variant.url, variant.height, depth + 1);
      if (!video.ok) return { ...video, height: variant.height, audioAvailable: false };
      if (!variant.audioGroup) return { ...video, height: variant.height, audioAvailable: true };
      const audioTrack = parsed.audioTracks.find((track) => track.groupId === variant.audioGroup);
      if (!audioTrack) return { ...video, ok: false, height: variant.height, audioAvailable: false, error: "HLS variant requires a separate audio group that has no URI." };
      const audio = await probeHlsPlaylist(audioTrack.url, 0, depth + 1);
      return {
        ...video,
        ok: video.ok && audio.ok,
        height: variant.height,
        audioAvailable: audio.ok,
        audioProbe: { ok: audio.ok, status: audio.status || null, error: audio.error || null },
        error: video.ok && audio.ok ? null : audio.error || video.error,
      };
    }));
    const usable = checks.filter((check) => check.ok && check.audioAvailable);
    const heights = [...new Set(usable.map((check) => check.height).filter((height) => height > 0))].sort((a, b) => b - a);
    return {
      ok: usable.length > 0,
      format: "hls",
      status,
      contentType,
      corsAllowed: true,
      heights,
      audioAvailable: usable.length > 0,
      variantsChecked: checks.length,
      segmentVerified: usable.length > 0,
      error: usable.length ? null : checks.map((check) => check.error).filter(Boolean).join(" | ") || "No HLS variant had a verified media segment and audio path.",
    };
  }
  if (!parsed.segmentUrl) {
    return { ok: false, format: "hls", status, contentType, corsAllowed: true, height: expectedHeight, audioAvailable: false, error: "HLS media playlist contained no testable segment." };
  }
  const segmentProbe = await probeMediaRange(parsed.segmentUrl);
  const segmentCorsAllowed = segmentProbe.corsAllowed === true;
  const ok = segmentProbe.ok && segmentCorsAllowed;
  return {
    ok,
    format: "hls",
    status: segmentProbe.status,
    contentType: segmentProbe.contentType,
    corsAllowed: segmentCorsAllowed,
    height: expectedHeight,
    heights: ok && expectedHeight > 0 ? [expectedHeight] : [],
    audioAvailable: ok,
    segmentVerified: ok,
    segmentProbe,
    error: ok ? null : segmentProbe.error || "HLS segment did not pass media/range/CORS verification.",
  };
}

async function probeManifest(url) {
  if (!url) return { ok: false, status: null, cors: null, contentType: null, format: null, error: "No DASH/HLS manifest URL was returned." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/dash+xml, application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        Origin: "https://edall.lovable.app",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": PROBE_USER_AGENT,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const cors = response.headers.get("access-control-allow-origin");
    const contentType = response.headers.get("content-type");
    const body = response.ok ? await response.text() : "";
    const isDash = /<MPD\b/i.test(body);
    const isHls = /#EXTM3U/i.test(body);
    const corsAllowed = cors === "*" || cors === "https://edall.lovable.app";
    if (isHls && response.ok && corsAllowed) {
      const verified = await probeHlsPlaylist(url, 0, 0, { body, corsAllowed, status: response.status, contentType, cors });
      return { ...verified, cors, contentType, format: "hls" };
    }
    if (isDash && response.ok && corsAllowed) {
      const baseMatch = body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
      if (baseMatch) {
        const baseUrl = new URL(baseMatch[1].trim(), response.url || url).href;
        const mediaProbe = await probeMediaRange(baseUrl);
        const ok = mediaProbe.ok && mediaProbe.corsAllowed;
        return { ok, status: mediaProbe.status, cors, contentType, format: "dash", heights: [], audioAvailable: ok, segmentVerified: ok, mediaProbe, error: ok ? null : mediaProbe.error || "DASH BaseURL media probe failed." };
      }
      return { ok: false, status: response.status, cors, contentType, format: "dash", heights: [], audioAvailable: false, error: "DASH MPD was reached, but no direct BaseURL media could be verified." };
    }
    return {
      ok: false,
      status: response.status,
      cors,
      contentType,
      format: isDash ? "dash" : isHls ? "hls" : null,
      error: !response.ok
        ? "Manifest HTTP " + response.status
        : !isDash && !isHls
          ? "The response was not a DASH MPD or HLS playlist."
          : !corsAllowed
            ? "Manifest CORS does not allow https://edall.lovable.app."
            : "Manifest media segments could not be verified.",
    };
  } catch (error) {
    return { ok: false, status: null, cors: null, contentType: null, format: null, error: String(error && error.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}
function sampleStreamSet(instance, data) {
  const videoItems = instance.provider === "piped"
    ? (Array.isArray(data?.videoStreams) ? data.videoStreams : [])
    : [...(Array.isArray(data?.formatStreams) ? data.formatStreams : []), ...(Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [])]
        .filter((stream) => String(stream?.type || "").startsWith("video/"));
  const audioItems = instance.provider === "piped"
    ? (Array.isArray(data?.audioStreams) ? data.audioStreams : [])
    : [...(Array.isArray(data?.formatStreams) ? data.formatStreams : []), ...(Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [])]
        .filter((stream) => String(stream?.type || "").startsWith("audio/"));
  const heights = [...new Set(videoItems.map(parseQuality).filter(Boolean))].sort((a, b) => b - a);
  const muxedAudio = videoItems.some((stream) =>
    (instance.provider === "piped" && stream?.videoOnly !== true) ||
    /mp4a|opus|vorbis|aac/i.test(String(stream?.type || stream?.mimeType || stream?.codec || ""))
  );
  return { videoItems, audioItems, heights, muxedAudio };
}

export function assessSamplePlayback({ mediaProbes = [], audioProbes = [], manifestProbes = [], muxedAudio = false }) {
  const mediaProbe = mediaProbes.find((probe) => probe?.ok) || mediaProbes[0] || null;
  const audioProbe = audioProbes.find((probe) => probe?.ok) || audioProbes[0] || null;
  const manifestProbe = manifestProbes.find((probe) => probe?.ok) || manifestProbes[0] || null;
  const manifestPlayable = !!(manifestProbe && manifestProbe.ok);
  const audioAvailable = !!(muxedAudio || (mediaProbe && mediaProbe.ok && audioProbe && audioProbe.ok) || manifestPlayable);
  const playable = manifestPlayable || !!(mediaProbe && mediaProbe.ok && audioAvailable);
  return { playable, audioAvailable, mediaProbe, audioProbe, manifestProbe };
}

export function verifiedSampleHeights({ videoCandidates = [], mediaProbes = [], manifestProbes = [] }) {
  const heights = new Set();
  videoCandidates.forEach((stream, index) => {
    if (mediaProbes[index]?.ok) {
      const height = parseQuality(stream);
      if (height > 0) heights.add(height);
    }
  });
  for (const manifest of manifestProbes) {
    if (manifest?.ok && Array.isArray(manifest.heights)) {
      for (const value of manifest.heights) {
        const height = Number(value) || 0;
        if (height > 0) heights.add(height);
      }
    }
  }
  return [...heights].sort((a, b) => b - a);
}

export function classifyPlaybackHealth({ sampleChecks = [], heights = [] }) {
  const successfulSamples = sampleChecks.filter((sample) => sample && sample.playable && sample.audioAvailable);
  if (!successfulSamples.length) return "unhealthy";
  const allSamplesPassed = sampleChecks.length > 0 && successfulSamples.length === sampleChecks.length;
  const maxHeight = Math.max(0, ...heights.map((height) => Number(height) || 0));
  return allSamplesPassed && maxHeight >= 720 ? "healthy" : "degraded";
}

// Keep the sync probe's response fields aligned with the Worker media verification checks.
async function probeInstance(instance) {
  const started = Date.now();
  if (!supportsInvidiousApi(instance)) {
    return {
      ...instance,
      status: "unhealthy",
      score: 0,
      responseMs: 0,
      mediaProbe: null,
      manifestProbe: null,
      videoCount: 0,
      audioCount: 0,
      audioAvailable: false,
      heights: [],
      sampleChecks: [],
      testedVideoIds: SAMPLE_VIDEO_IDS,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
      apiVerified: false,
      error: "This candidate was not eligible for an API probe.",
    };
  }
  try {
    const sampleResults = await Promise.allSettled(SAMPLE_VIDEO_IDS.map(async (videoId) => {
      const endpoint = instance.provider === "piped"
        ? instance.url + "/streams/" + videoId
        : instance.url + "/api/v1/videos/" + videoId + "?fields=title,lengthSeconds,liveNow,hlsUrl,dashUrl,formatStreams,adaptiveFormats";
      const data = await fetchJson(endpoint);
      const streams = sampleStreamSet(instance, data);
      if (!streams.videoItems.some((stream) => stream && /^https:\/\//i.test(String(stream.url || ""))) &&
          !data?.hls && !data?.dash && !data?.hlsUrl && !data?.dashUrl) {
        throw new Error("API returned no HTTPS video stream or manifest.");
      }
      const mediaCandidates = streams.videoItems
        .filter((stream) => /^https:\/\//i.test(String(stream?.url || "")))
        .sort((a, b) => parseQuality(b) - parseQuality(a))
        .slice(0, 3);
      const audioCandidates = streams.audioItems
        .filter((stream) => /^https:\/\//i.test(String(stream?.url || "")))
        .slice(0, 2);
      const sourceManifestUrls = instance.provider === "piped"
        ? [data?.dash, data?.hls]
        : [data?.dashUrl, data?.hlsUrl];
      const [mediaProbes, audioProbes] = await Promise.all([
        Promise.all(mediaCandidates.map((stream) => probeMediaRange(stream.url))),
        Promise.all(audioCandidates.map((stream) => probeMediaRange(stream.url))),
      ]);
      const discoveredManifestUrls = [
        ...sourceManifestUrls.filter(Boolean),
        ...mediaCandidates.filter((stream, index) => mediaProbes[index]?.isManifest).map((stream) => stream.url),
        ...audioCandidates.filter((stream, index) => audioProbes[index]?.isManifest).map((stream) => stream.url),
      ];
      const manifestUrls = [...new Set(discoveredManifestUrls)];
      const manifestProbes = await Promise.all(manifestUrls.map(probeManifest));
      const assessment = assessSamplePlayback({
        mediaProbes,
        audioProbes,
        manifestProbes,
        muxedAudio: streams.muxedAudio,
      });
      const verifiedHeights = verifiedSampleHeights({ videoCandidates: mediaCandidates, mediaProbes, manifestProbes });
      return {
        videoId,
        playable: assessment.playable,
        audioAvailable: assessment.audioAvailable,
        heights: verifiedHeights,
        videoCount: streams.videoItems.length,
        audioCount: streams.audioItems.length,
        mediaProbe: assessment.mediaProbe,
        audioProbe: assessment.audioProbe,
        manifestProbe: assessment.manifestProbe,
      };
    }));
    const samples = sampleResults.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { videoId: SAMPLE_VIDEO_IDS[index], playable: false, audioAvailable: false, heights: [], videoCount: 0, audioCount: 0, error: String(result.reason?.message || result.reason).slice(0, 180) });
    const playableSamples = samples.filter((sample) => sample.playable && sample.audioAvailable);
    if (!playableSamples.length) {
      throw new Error("API was reachable, but no sample returned a browser-playable video+audio path: " +
        samples.map((sample) => sample.error || (sample.videoId + " " + ((sample.mediaProbe && sample.mediaProbe.error) || (sample.manifestProbe && sample.manifestProbe.error) || "playback not verified"))).join(" | "));
    }
    const heights = [...new Set(playableSamples.flatMap((sample) => sample.heights || []))].sort((a, b) => b - a);
    const maxHeight = Math.max(0, ...heights);
    const audioCount = Math.max(0, ...playableSamples.map((sample) => sample.audioCount || 0));
    const responseMs = Date.now() - started;
    const score = Math.min(maxHeight, 4320) * 100 +
      Math.min(heights.length, 12) * 400 +
      (audioCount ? 350 : 0) +
      playableSamples.length * 250 +
      (instance.uptime || 0) * 2 -
      Math.min(responseMs, 20000) / 20;
    const mediaProbe = playableSamples.find((sample) => sample.mediaProbe?.ok)?.mediaProbe || null;
    const manifestProbe = playableSamples.find((sample) => sample.manifestProbe?.ok)?.manifestProbe || null;
    return {
      ...instance,
      status: classifyPlaybackHealth({ sampleChecks: samples, heights }),
      score: Math.round(score),
      responseMs,
      mediaProbe,
      manifestProbe,
      videoCount: Math.max(...playableSamples.map((sample) => sample.videoCount || 0)),
      audioCount,
      audioAvailable: true,
      heights,
      sampleChecks: samples,
      testedVideoIds: SAMPLE_VIDEO_IDS,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      apiVerified: true,
      error: null,
    };
  } catch (error) {
    return {
      ...instance,
      status: "unhealthy",
      score: 0,
      responseMs: Date.now() - started,
      mediaProbe: null,
      manifestProbe: null,
      videoCount: 0,
      audioCount: 0,
      audioAvailable: false,
      heights: [],
      sampleChecks: [],
      testedVideoIds: SAMPLE_VIDEO_IDS,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
      apiVerified: false,
      error: String(error && error.message || error).slice(0, 500),
    };
  }
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

async function main() {
  const previousText = await readFile(OUTPUT, "utf8").catch(() => "");
  const previous = (() => {
    try { return JSON.parse(previousText); } catch { return null; }
  })();

  const [pipedResult, invidiousResult] = await Promise.allSettled([
    fetchText(PIPED_SOURCE).then((text) => { const list = discoverPiped(text); if (!list.length) throw new Error("Piped directory contained no validated API endpoints."); return list; }),
    fetchInvidiousDirectory(),
  ]);

  const sourceErrors = [];
  let piped = pipedResult.status === "fulfilled" ? pipedResult.value : null;
  let invidious = invidiousResult.status === "fulfilled" ? invidiousResult.value : null;
  if (!piped) sourceErrors.push("Piped source: " + String(pipedResult.reason));
  if (!invidious) sourceErrors.push("Invidious source: " + String(invidiousResult.reason));

  // Never replace a good registry with an empty list when an upstream directory is temporarily down.
  if (!piped && previous && Array.isArray(previous.sources && previous.sources.piped)) {
    piped = previous.sources.piped.map((item) => ({ ...item, status: item.status || "unknown" }));
  }
  if (!invidious && previous && Array.isArray(previous.sources && previous.sources.invidious)) {
    invidious = previous.sources.invidious.map((item) => ({ ...item, status: item.status || "unknown" }));
  }
  piped = piped || [];
  invidious = uniqueByUrl([...(invidious || []), ...CURATED_INVIDIOUS_INSTANCES]);

  if (!piped.length && !invidious.length) {
    throw new Error("Both official instance directories failed and there is no previous registry. " + sourceErrors.join(" | "));
  }

  console.log("Discovered " + piped.length + " official Piped and " + invidious.length + " official HTTPS Invidious instances.");
  const [checkedPiped, checkedInvidious] = await Promise.all([
    mapLimit(piped, CONCURRENCY, probeInstance),
    mapLimit(invidious, CONCURRENCY, probeInstance),
  ]);

  const order = (a, b) =>
    Number(b.status === "healthy") - Number(a.status === "healthy") ||
    Number(b.score || 0) - Number(a.score || 0) ||
    Number(a.responseMs || 999999) - Number(b.responseMs || 999999) ||
    a.url.localeCompare(b.url);

  checkedPiped.sort(order);
  checkedInvidious.sort(order);

  const registry = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    refreshedDaily: sourceErrors.length === 0,
    sourcesUpdated: {
      piped: pipedResult.status === "fulfilled",
      invidious: invidiousResult.status === "fulfilled",
    },
    sources: {
      piped: checkedPiped,
      invidious: checkedInvidious,
    },
    sourceErrors,
    policy: {
      onlyOfficialDirectories: false,
      curatedInvidiousCandidates: CURATED_INVIDIOUS_INSTANCES.map((item) => item.url),
      onlyHttps: true,
      failedInstancesAreRetained: true,
      healthyInstancesFirst: true,
      probeVideoIds: SAMPLE_VIDEO_IDS,
    },
  };

  const nextText = JSON.stringify(registry, null, 2) + "\n";
  if (nextText !== previousText) {
    await writeFile(OUTPUT, nextText, "utf8");
    console.log("Updated public/video-instances.json.");
  } else {
    console.log("The instance registry is unchanged.");
  }

  const summarizeInstances = (items) => items.map((item) => ({
    url: item.url,
    status: item.status,
    responseMs: item.responseMs,
    videoCount: item.videoCount,
    audioCount: item.audioCount,
    audioAvailable: item.audioAvailable === true,
    heights: item.heights,
    testedVideoIds: item.testedVideoIds || [],
    sampleChecks: item.sampleChecks || [],
    mediaProbe: item.mediaProbe || null,
    manifestProbe: item.manifestProbe || null,
    apiError: item.error || null,
  }));
  console.log(JSON.stringify({
    piped: {
      total: checkedPiped.length,
      healthy: checkedPiped.filter((x) => x.status === "healthy").length,
      degraded: checkedPiped.filter((x) => x.status === "degraded").length,
      unhealthy: checkedPiped.filter((x) => x.status === "unhealthy").length,
      instances: summarizeInstances(checkedPiped),
    },
    invidious: {
      total: checkedInvidious.length,
      healthy: checkedInvidious.filter((x) => x.status === "healthy").length,
      degraded: checkedInvidious.filter((x) => x.status === "degraded").length,
      unhealthy: checkedInvidious.filter((x) => x.status === "unhealthy").length,
      instances: summarizeInstances(checkedInvidious),
    },
    sourceErrors,
  }, null, 2));

  if (sourceErrors.length === 2) {
    throw new Error("Both official directories failed; kept the previous registry but did not claim a successful refresh.");
  }
  const total = checkedPiped.length + checkedInvidious.length;
  const playable = [...checkedPiped, ...checkedInvidious].filter((item) => item.status === "healthy" || item.status === "degraded");
  if (!total || !playable.length) {
    throw new Error("No candidate passed playback verification. The previous registry must not be replaced by an unusable registry.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[video-instances-sync] " + String(error && error.stack || error));
    process.exitCode = 1;
  });
}
