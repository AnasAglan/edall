// Cloudflare Workers version of the ED-ALL Invidious extractor.
// Playback readiness requires an actual segment response, not only a metadata or manifest response.
// Deploy as a Worker named edall-invidious-extractor.
const DEFAULT_ALLOWED_ORIGIN = "https://edall.lovable.app";
const DEFAULT_REGISTRY_URL = "https://edall.lovable.app/video-instances.json";
function buildCorsHeaders(origin: string | null, allowedOrigin: string) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin && origin === allowedOrigin) headers.set("Access-Control-Allow-Origin", allowedOrigin);
  return headers;
}
const OFFICIAL_INSTANCES_API = "https://api.invidious.io/instances.json?sort_by=health";
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 6500;
const PROBE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BATCH_SIZE = 4;

function responseJson(body: unknown, status = 200, origin: string | null = null, allowedOrigin = DEFAULT_ALLOWED_ORIGIN) {
  const headers = buildCorsHeaders(origin, allowedOrigin);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanBase(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (/(^|[-.])(ygg|i2p|onion)([.-]|$)/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9", "User-Agent": PROBE_USER_AGENT },
      cache: "no-store",
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function loadOfficialInstances(registryUrl = DEFAULT_REGISTRY_URL): Promise<Array<{
  url: string;
  score: number;
  status: string;
  official?: boolean;
  curated?: boolean;
  apiListed?: boolean;
  apiVerified?: boolean;
  apiProbeCandidate?: boolean;
}>> {
  try {
    const registryResponse = await fetchWithTimeout(registryUrl, 4500);
    if (registryResponse.ok) {
      const registry = await registryResponse.json();
      const entries = Array.isArray(registry?.sources?.invidious) ? registry.sources.invidious : [];
      const cleaned = entries.map((item: any) => ({
        url: cleanBase(item?.url),
        score: Number(item?.score) || 0,
        status: String(item?.status || "unknown"),
        official: item?.official === true,
        curated: item?.curated === true,
        apiListed: item?.apiListed === true,
        apiVerified: item?.apiVerified === true,
        apiProbeCandidate: item?.apiProbeCandidate === true,
      })).filter((item: any) =>
        item.url &&
        (item.official || item.curated) &&
        (item.apiVerified === true || item.apiListed === true)
      );
      const usable = cleaned.filter((item: any) => item.status !== "unhealthy");
      if (usable.length) return usable;
    }
  } catch (error) {
    console.warn("[extract-youtube-stream] Registry unavailable; using Invidious official directory.", error);
  }

  const response = await fetchWithTimeout(OFFICIAL_INSTANCES_API, 6500);
  if (!response.ok) throw new Error("Official Invidious instance directory returned HTTP " + response.status);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Invalid Invidious instance directory response.");
  const instances: Array<{ url: string; score: number; status: string }> = [];
  for (const row of payload as any[]) {
    const meta = row?.[1] || {};
    if (String(meta.type || "").toLowerCase() !== "https" || meta.api !== true) continue;
    const url = cleanBase(meta.uri);
    if (!url || url.toLowerCase().endsWith(".ygg")) continue;
    instances.push({
      url,
      score: Number(meta.monitor?.uptime) || 0,
      status: "unknown",
    });
  }
  return instances;
}

function parseHeight(stream: any): number {
  const raw = String(stream?.qualityLabel || stream?.resolution || stream?.quality || "");
  const dimensions = raw.match(/x(\d{3,4})\b/i);
  const label = raw.match(/(\d{3,4})p\b/i);
  const generic = raw.match(/(?:^|\D)(\d{3,4})(?:\D|$)/);
  return Number(dimensions?.[1] || label?.[1] || generic?.[1]) || 0;
}

function parseMime(stream: any): { mimeType: string; codec: string } {
  const type = String(stream?.type || stream?.mimeType || "").trim();
  const mimeType = type.split(";")[0].trim().toLowerCase();
  const codecMatch = type.match(/codecs\s*=\s*["']?([^"';]+)/i);
  const encoding = String(stream?.encoding || "");
  return {
    mimeType,
    codec: String(stream?.codec || (codecMatch?.[1] || encoding).split(",")[0].trim()),
  };
}

function normalizeInvidious(data: any) {
  const videoStreams: any[] = [];
  const audioStreams: any[] = [];
  const append = (stream: any, adaptive: boolean) => {
    if (!stream || typeof stream.url !== "string" || !stream.url.startsWith("https://")) return;
    const parsed = parseMime(stream);
    const base = {
      url: stream.url,
      mimeType: parsed.mimeType,
      codec: parsed.codec,
      format: parsed.mimeType.includes("webm") ? "WEBM" : "MPEG_4",
      bitrate: Number(stream.bitrate) || 0,
      audioTrackId: String(stream.audioTrackId || stream.audioTrackLocale || "default"),
    };
    if (parsed.mimeType.startsWith("video/")) {
      const height = parseHeight(stream);
      if (!height) return;
      videoStreams.push({
        ...base,
        quality: String(stream.qualityLabel || stream.resolution || (height + "p")),
        height,
        width: Number(String(stream.resolution || "").split("x")[0]) || Number(stream.width) || 0,
        videoOnly: adaptive,
        itag: stream.itag || stream.id || "",
      });
    } else if (parsed.mimeType.startsWith("audio/")) {
      audioStreams.push({
        ...base,
        audioTrackLocale: stream.audioTrackLocale || "und",
        audioSamplingRate: Number(stream.audioSampleRate) || 0,
      });
    }
  };

  if (Array.isArray(data?.formatStreams)) data.formatStreams.forEach((stream: any) => append(stream, false));
  if (Array.isArray(data?.adaptiveFormats)) data.adaptiveFormats.forEach((stream: any) => append(stream, true));

  return {
    success: true,
    provider: "invidious",
    title: String(data?.title || ""),
    duration: Number(data?.lengthSeconds) || 0,
    livestream: data?.liveNow === true,
    dash: cleanMediaUrl(data?.dashUrl),
    hls: cleanMediaUrl(data?.hlsUrl),
    proxyUrl: null,
    videoStreams,
    audioStreams,
  };
}

function cleanMediaUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function bundleScore(bundle: any, verifiedHeights: number[] = []): number {
  const heights = verifiedHeights;
  const maxHeight = Math.max(0, ...heights);
  return heights.length * 100000 +
    Math.min(maxHeight, 4320) * 10 +
    (bundle.videoStreams.some((stream: any) => stream.videoOnly) && bundle.audioStreams.length ? 500 : 0) +
    (bundle.videoStreams.some((stream: any) => !stream.videoOnly) ? 100 : 0) +
    (bundle.dash ? 50 : 0) +
    (bundle.hls ? 25 : 0);
}

async function probeMediaUrl(url: string, origin = DEFAULT_ALLOWED_ORIGIN) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Range: "bytes=0-1", Origin: origin, "User-Agent": PROBE_USER_AGENT },
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const httpOk = response.status === 206 || response.status === 200;
    const isManifest = /mpegurl|dash\+xml/i.test(contentType) || /\.m3u8?(?:[?#]|$)/i.test(url);
    const mediaTypeOk = !/(text\/html|application\/json)/i.test(contentType) && !isManifest;
    const result = {
      ok: httpOk && mediaTypeOk,
      isManifest,
      status: response.status,
      rangeSupported: response.status === 206,
      cors: response.headers.get("access-control-allow-origin"),
      corsAllowed: ["*", origin].includes(response.headers.get("access-control-allow-origin") || ""),
      contentType,
      error: !httpOk ? "Media HTTP " + response.status : isManifest ? "The URL returned a manifest, not a media segment." : !mediaTypeOk ? "Media URL returned a non-media content type: " + contentType : null,
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { ok: false, isManifest: false, status: null, rangeSupported: false, cors: null, corsAllowed: false, contentType: null, error: String((error as Error)?.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

function parseHlsAttributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const source = String(line || "").replace(/^#[^:]+:/, "");
  for (const match of source.matchAll(/([A-Z0-9-]+)=("([^"]*)"|([^,]*))/gi)) {
    result[match[1].toUpperCase()] = match[3] !== undefined ? match[3] : match[4];
  }
  return result;
}

type HlsProbeResult = {
  ok: boolean;
  audioAvailable: boolean;
  status?: number | null;
  cors?: string | null;
  corsAllowed?: boolean;
  contentType?: string | null;
  height?: number;
  heights?: number[];
  segmentVerified?: boolean;
  variantsChecked?: number;
  segmentProbe?: any;
  audioProbe?: any;
  error?: string | null;
  [key: string]: any;
};

type HlsVariant = { url: string; height: number; audioGroup: string };

function parseHlsPlaylist(body: string, baseUrl: string, fallbackHeight = 0) {
  const lines = String(body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const audioTracks: Array<{ groupId: string; url: string }> = [];
  const variants: Array<{ url: string; height: number; audioGroup: string }> = [];
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
        variants.push({ url: uri.href, height: Number(resolution && resolution[1]) || fallbackHeight || 0, audioGroup: attrs.AUDIO || "" });
      } catch {}
    }
  }
  let segmentUrl: string | null = null;
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
    const nextUri = lines.find((value) => value && !value.startsWith("#") && (/^https?:/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)));
    if (nextUri) {
      try {
        const uri = new URL(nextUri, baseUrl);
        if (uri.protocol === "https:") segmentUrl = uri.href;
      } catch {}
    }
  }
  return { variants, audioTracks, segmentUrl };
}

async function probeHlsPlaylist(url: string, expectedHeight = 0, depth = 0, initial?: { body: string; cors: string | null; status: number; contentType: string | null }, origin = DEFAULT_ALLOWED_ORIGIN): Promise<HlsProbeResult> {
  if (depth > 3) return { ok: false, format: "hls", height: expectedHeight, audioAvailable: false, error: "HLS playlist nesting limit reached." };
  let body = initial?.body;
  let cors = initial?.cors || null;
  let status = initial?.status || 0;
  let contentType = initial?.contentType || null;
  if (typeof body !== "string") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*", Origin: origin },
        cache: "no-store",
      });
      status = response.status;
      contentType = response.headers.get("content-type");
      cors = response.headers.get("access-control-allow-origin");
      body = response.ok ? await response.text() : "";
    } finally {
      clearTimeout(timer);
    }
  }
  const corsAllowed = cors === "*" || cors === origin;
  if (status < 200 || status >= 300 || !/#EXTM3U/i.test(body) || !corsAllowed) {
    return { ok: false, format: "hls", status, cors, corsAllowed, contentType, height: expectedHeight, audioAvailable: false, error: status < 200 || status >= 300 ? "Playlist HTTP " + status : !corsAllowed ? "Playlist CORS is not allowed." : "Response is not an HLS playlist." };
  }
  const parsed = parseHlsPlaylist(body, url, expectedHeight);
  if (parsed.variants.length) {
    const bestVariants: HlsVariant[] = parsed.variants.sort((a: HlsVariant, b: HlsVariant) => b.height - a.height).slice(0, 3);
    const checks: HlsProbeResult[] = await Promise.all(bestVariants.map(async (variant: HlsVariant): Promise<HlsProbeResult> => {
      const video: HlsProbeResult = await probeHlsPlaylist(variant.url, variant.height, depth + 1, undefined, origin);
      if (!video.ok) return { ...video, height: variant.height, audioAvailable: false };
      if (!variant.audioGroup) return { ...video, height: variant.height, audioAvailable: true };
      const audioTrack = parsed.audioTracks.find((track) => track.groupId === variant.audioGroup);
      if (!audioTrack) return { ...video, ok: false, height: variant.height, audioAvailable: false, error: "HLS variant needs a separate audio group without a URI." };
      const audio: HlsProbeResult = await probeHlsPlaylist(audioTrack.url, 0, depth + 1, undefined, origin);
      return { ...video, ok: video.ok && audio.ok, height: variant.height, audioAvailable: audio.ok, audioProbe: { ok: audio.ok, status: audio.status || null, error: audio.error || null }, error: video.ok && audio.ok ? null : audio.error || video.error };
    }));
    const usable: HlsProbeResult[] = checks.filter((check: HlsProbeResult) => check.ok && check.audioAvailable);
    const heights: number[] = [...new Set<number>(usable.map((check: HlsProbeResult) => Number(check.height) || 0).filter((height: number) => height > 0))].sort((a: number, b: number) => b - a);
    return { ok: usable.length > 0, format: "hls", status, cors, corsAllowed: true, contentType, heights, audioAvailable: usable.length > 0, variantsChecked: checks.length, segmentVerified: usable.length > 0, error: usable.length ? null : checks.map((check: HlsProbeResult) => check.error).filter(Boolean).join(" | ") || "No HLS variant passed segment/audio verification." };
  }
  if (!parsed.segmentUrl) {
    return { ok: false, format: "hls", status, cors, corsAllowed: true, contentType, heights: [], audioAvailable: false, error: "HLS media playlist contained no testable segment." };
  }
  const segmentProbe = await probeMediaUrl(parsed.segmentUrl, origin);
  const ok = segmentProbe.ok && segmentProbe.corsAllowed;
  const heights = ok && expectedHeight > 0 ? [expectedHeight] : [];
  return { ok, format: "hls", status: segmentProbe.status, cors, corsAllowed: true, contentType, heights, audioAvailable: ok, segmentVerified: ok, segmentProbe, error: ok ? null : segmentProbe.error || "HLS segment did not pass media/range/CORS verification." };
}

async function probeManifestUrl(url: string, origin = DEFAULT_ALLOWED_ORIGIN) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/dash+xml, application/vnd.apple.mpegurl, application/x-mpegURL, */*", Origin: origin, "Accept-Language": "en-US,en;q=0.9", "User-Agent": PROBE_USER_AGENT },
      cache: "no-store",
    });
    const cors = response.headers.get("access-control-allow-origin");
    const corsAllowed = cors === "*" || cors === origin;
    const contentType = response.headers.get("content-type");
    const body = response.ok ? await response.text() : "";
    const isDash = /<MPD\b/i.test(body);
    const isHls = /#EXTM3U/i.test(body);
    if (isHls && response.ok && corsAllowed) {
      const verified = await probeHlsPlaylist(url, 0, 0, { body, cors, status: response.status, contentType }, origin);
      return { ...verified, cors, corsAllowed, contentType, format: "hls" };
    }
    if (isDash && response.ok && corsAllowed) {
      const baseMatch = body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
      if (baseMatch) {
        const baseUrl = new URL(baseMatch[1].trim(), response.url || url).href;
        const mediaProbe = await probeMediaUrl(baseUrl, origin);
        const ok = mediaProbe.ok && mediaProbe.corsAllowed;
        return { ok, status: mediaProbe.status, cors, corsAllowed, contentType, format: "dash", heights: [], audioAvailable: ok, segmentVerified: ok, mediaProbe, error: ok ? null : mediaProbe.error || "DASH BaseURL media probe failed." };
      }
      return { ok: false, status: response.status, cors, corsAllowed, contentType, format: "dash", heights: [], audioAvailable: false, error: "DASH MPD was reached, but no direct BaseURL segment could be verified." };
    }
    return { ok: false, status: response.status, cors, corsAllowed, contentType, format: isDash ? "dash" : isHls ? "hls" : null, heights: [], audioAvailable: false, error: !response.ok ? "Manifest HTTP " + response.status : !corsAllowed ? "Manifest CORS is not allowed." : "Manifest media segments could not be verified." };
  } catch (error) {
    return { ok: false, status: null, cors: null, corsAllowed: false, format: null, heights: [], audioAvailable: false, error: String((error as Error)?.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}
async function probeInstance(instance: { url: string; score: number; status: string }, videoId: string, origin = DEFAULT_ALLOWED_ORIGIN) {
  const url = instance.url + "/api/v1/videos/" + encodeURIComponent(videoId) +
    "?fields=title,lengthSeconds,liveNow,hlsUrl,dashUrl,formatStreams,adaptiveFormats";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9", "User-Agent": PROBE_USER_AGENT },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Invidious HTTP " + response.status);
    const payload = await response.json();
    const bundle = normalizeInvidious(payload);
    const videoCandidates = bundle.videoStreams
      .filter((stream: any) => typeof stream.url === "string")
      .sort((a: any, b: any) => Number(b.height || 0) - Number(a.height || 0))
      .slice(0, 5);
    const audioCandidates = bundle.audioStreams
      .filter((stream: any) => typeof stream.url === "string")
      .slice(0, 3);
    const [initialVideoProbes, initialAudioProbes] = await Promise.all([
      Promise.all(videoCandidates.map((stream: any) => probeMediaUrl(stream.url, origin))),
      Promise.all(audioCandidates.map((stream: any) => probeMediaUrl(stream.url, origin))),
    ]);
    const sourceManifestUrls = [bundle.dash, bundle.hls].filter(
      (manifest): manifest is string => typeof manifest === "string" && !!manifest
    );
    const discoveredManifestUrls = [
      ...sourceManifestUrls,
      ...videoCandidates.filter((stream: any, index: number) => initialVideoProbes[index]?.isManifest).map((stream: any) => stream.url),
      ...audioCandidates.filter((stream: any, index: number) => initialAudioProbes[index]?.isManifest).map((stream: any) => stream.url),
    ];
    const manifestUrls = [...new Set(discoveredManifestUrls)];
    const manifestProbes = await Promise.all(manifestUrls.map((manifest) => probeManifestUrl(manifest, origin)));
    const mediaProbes = initialVideoProbes.filter((probe: any) => !probe.isManifest);
    const audioProbes = initialAudioProbes.filter((probe: any) => !probe.isManifest);
    const verifiedDirectVideos = videoCandidates.filter((stream: any, index: number) =>
      !initialVideoProbes[index]?.isManifest && initialVideoProbes[index]?.ok
    );
    const verifiedDirectAudios = audioCandidates.filter((stream: any, index: number) =>
      !initialAudioProbes[index]?.isManifest && initialAudioProbes[index]?.ok
    );
    const manifestProbe: any = manifestProbes.find((probe: any) => probe.ok) || manifestProbes[0] || null;
    const manifestPlayable = !!(manifestProbe && manifestProbe.ok && manifestProbe.segmentVerified && manifestProbe.audioAvailable);
    const verifiedMuxedStream = verifiedDirectVideos.some((stream: any) => !stream.videoOnly);
    const verifiedAdaptivePair = verifiedDirectVideos.some((stream: any) => stream.videoOnly) && verifiedDirectAudios.length > 0;
    const directPlayable = verifiedMuxedStream || verifiedAdaptivePair;
    const playbackVerified = manifestPlayable || directPlayable;
    if (!playbackVerified) {
      const status = initialVideoProbes.find((probe: any) => !probe.ok)?.status ||
        initialAudioProbes.find((probe: any) => !probe.ok)?.status ||
        manifestProbe?.status || "none";
      throw new Error("Video/audio media segments were not verified (HTTP " + status + ").");
    }
    // Expose only directly probed stream URLs. Manifest playback remains in dash/hls.
    bundle.videoStreams = verifiedDirectVideos;
    bundle.audioStreams = verifiedDirectAudios;
    const verifiedHeights = [
      ...verifiedDirectVideos.map((stream: any) => Number(stream.height) || 0),
      ...manifestProbes.filter((probe: any) => probe.ok && probe.segmentVerified && probe.audioAvailable)
        .flatMap((probe: any) => Array.isArray(probe.heights) ? probe.heights : []),
    ].filter((height: number) => height > 0);
    const heights = [...new Set(verifiedHeights)].sort((a, b) => b - a);
    if (!heights.length && !manifestPlayable) {
      throw new Error("No video quality passed direct media or manifest segment verification.");
    }
    return {
      ...bundle,
      instance: instance.url,
      elapsedMs: Date.now() - started,
      score: bundleScore(bundle, heights) + Math.min(Number(instance.score) || 0, 200),
      heights,
      playbackVerified,
      audioAvailable: manifestPlayable || verifiedMuxedStream || verifiedAdaptivePair,
      mediaProbe: mediaProbes.find((probe: any) => probe.ok) || mediaProbes[0] || null,
      audioProbe: audioProbes.find((probe: any) => probe.ok) || audioProbes[0] || null,
      manifestProbe,
      qualityVerified: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function extract(videoId: string, excluded: string[], registryUrl = DEFAULT_REGISTRY_URL, origin = DEFAULT_ALLOWED_ORIGIN) {
  const excludedSet = new Set((excluded || []).map(cleanBase).filter(Boolean));
  const instances = (await loadOfficialInstances(registryUrl))
    .filter((item) => !excludedSet.has(item.url))
    .sort((a, b) => {
      const rank = (status: string) => status === "healthy" ? 3 : status === "degraded" ? 2 : status === "unknown" ? 1 : 0;
      return rank(b.status) - rank(a.status) || b.score - a.score || a.url.localeCompare(b.url);
    });

  if (!instances.length) throw new Error("No official HTTPS Invidious instances currently advertise API access.");
  const failures: Array<{ instance: string; error: string }> = [];
  let best: any = null;

  for (let offset = 0; offset < instances.length; offset += BATCH_SIZE) {
    const batch = instances.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((instance) => probeInstance(instance, videoId, origin)));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "fulfilled") {
        if (!best || result.value.score > best.score) best = result.value;
      } else {
        failures.push({
          instance: batch[index].url,
          error: String(result.reason?.message || result.reason).slice(0, 180),
        });
      }
    }
    const heights = best?.heights || [];
    // Evaluate every currently advertised official instance; a 720p result is not
    // proof that a later instance cannot supply a higher selectable quality.
  }

  if (!best) throw new Error("All Invidious candidates failed: " + failures.slice(0, 8).map((item) => item.instance + " — " + item.error).join(" | "));
  return {
    success: true,
    provider: "invidious",
    instance: best.instance,
    title: best.title,
    duration: best.duration,
    livestream: best.livestream,
    dash: best.dash,
    hls: best.hls,
    proxyUrl: null,
    videoStreams: best.videoStreams,
    audioStreams: best.audioStreams,
    qualities: best.heights,
    diagnostics: {
      testedInstances: instances.length,
      selectedInstanceMs: best.elapsedMs,
      selectedScore: best.score,
      failedInstances: failures.length,
      failedInstanceDetails: failures.slice(0, 12),
      playbackVerified: best.playbackVerified === true,
      audioAvailable: best.audioAvailable === true,
      mediaProbe: best.mediaProbe || null,
      audioProbe: best.audioProbe || null,
      manifestProbe: best.manifestProbe || null,
    },
  };
}

export default { async fetch(req: Request, env: Record<string, string> = {}) {
  const allowedOrigin = env.EDALL_ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
  const registryUrl = env.EDALL_REGISTRY_URL || `${allowedOrigin}/video-instances.json`;
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && origin !== allowedOrigin) return new Response("Origin is not allowed.", { status: 403 });
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin, allowedOrigin) });
  }
  if (req.method !== "POST") return responseJson({ success: false, error: "Method not allowed." }, 405, origin, allowedOrigin);
  if (origin && origin !== allowedOrigin) return responseJson({ success: false, error: "Origin is not allowed." }, 403, origin, allowedOrigin);
  try {
    const body = await req.json();
    const videoId = String(body?.videoId || "");
    if (!VIDEO_ID_PATTERN.test(videoId)) return responseJson({ success: false, error: "A valid YouTube video ID is required." }, 400, origin, allowedOrigin);
    const excluded = Array.isArray(body?.excludeInstances) ? body.excludeInstances.map(String).slice(0, 30) : [];
    const result = await extract(videoId, excluded, registryUrl, allowedOrigin);
    return responseJson(result, 200, origin, allowedOrigin);
  } catch (error) {
    console.error("[extract-youtube-stream]", error);
    return responseJson({
      success: false,
      error: String((error as Error)?.message || error || "Unknown extractor error").slice(0, 500),
    }, 502, origin, allowedOrigin);
  }
} };
