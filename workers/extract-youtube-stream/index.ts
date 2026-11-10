// Cloudflare Workers version of the ED-ALL Invidious extractor.
// Deploy as a Worker named edall-invidious-extractor.
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://edall.lovable.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const REGISTRY_URL = "https://edall.lovable.app/video-instances.json";
const OFFICIAL_INSTANCES_API = "https://api.invidious.io/instances.json?sort_by=health";
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 6500;
const BATCH_SIZE = 4;

function responseJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function loadOfficialInstances(): Promise<Array<{ url: string; score: number; status: string }>> {
  try {
    const registryResponse = await fetchWithTimeout(REGISTRY_URL, 4500);
    if (registryResponse.ok) {
      const registry = await registryResponse.json();
      const entries = Array.isArray(registry?.sources?.invidious) ? registry.sources.invidious : [];
      const cleaned = entries.map((item) => ({
        url: cleanBase(item?.url),
        score: Number(item?.score) || 0,
        status: String(item?.status || "unknown"),
        official: item?.official === true,
      })).filter((item: any) => item.url && item.official);
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
    if (String(meta.type || "").toLowerCase() !== "https") continue;
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

function bundleScore(bundle: any): number {
  const heights: number[] = [...new Set<number>(bundle.videoStreams.map((stream: any) => Number(stream.height)).filter((height: number) => height > 0))];
  const maxHeight = Math.max(0, ...heights);
  return heights.length * 100000 +
    Math.min(maxHeight, 4320) * 10 +
    (bundle.videoStreams.some((stream: any) => stream.videoOnly) && bundle.audioStreams.length ? 500 : 0) +
    (bundle.videoStreams.some((stream: any) => !stream.videoOnly) ? 100 : 0) +
    (bundle.dash ? 50 : 0) +
    (bundle.hls ? 25 : 0);
}

async function probeMediaUrl(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Range: "bytes=0-1", Origin: "https://edall.lovable.app" },
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const httpOk = response.status === 206 || response.status === 200;
    const mediaTypeOk = !/(text\\/html|application\\/json)/i.test(contentType);
    const result = {
      ok: httpOk && mediaTypeOk,
      status: response.status,
      rangeSupported: response.status === 206,
      cors: response.headers.get("access-control-allow-origin"),
      contentType,
      error: !httpOk ? "Media HTTP " + response.status : !mediaTypeOk ? "Media URL returned a non-media content type: " + contentType : null,
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { ok: false, status: null, rangeSupported: false, cors: null, contentType: null, error: String((error as Error)?.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeManifestUrl(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/dash+xml, application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        Origin: "https://edall.lovable.app",
      },
      cache: "no-store",
    });
    const cors = response.headers.get("access-control-allow-origin");
    const corsAllowed = cors === "*" || cors === "https://edall.lovable.app";
    const body = response.ok ? await response.text() : "";
    const format = /<MPD\\b/i.test(body) ? "dash" : /#EXTM3U/i.test(body) ? "hls" : null;
    return {
      ok: response.ok && !!format && corsAllowed,
      status: response.status,
      cors,
      corsAllowed,
      format,
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    return { ok: false, status: null, cors: null, corsAllowed: false, format: null, contentType: null, error: String((error as Error)?.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeInstance(instance: { url: string; score: number; status: string }, videoId: string) {
  const url = instance.url + "/api/v1/videos/" + encodeURIComponent(videoId) +
    "?fields=title,lengthSeconds,liveNow,hlsUrl,dashUrl,formatStreams,adaptiveFormats";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Invidious HTTP " + response.status);
    const payload = await response.json();
    const bundle = normalizeInvidious(payload);
    const videoCandidates = bundle.videoStreams
      .filter((stream: any) => typeof stream.url === "string")
      .sort((a: any, b: any) => Number(b.height || 0) - Number(a.height || 0))
      .slice(0, 3);
    const audioCandidates = bundle.audioStreams
      .filter((stream: any) => typeof stream.url === "string")
      .slice(0, 2);
    const manifestUrls = [bundle.dash, bundle.hls].filter(Boolean);
    const [mediaProbes, audioProbes, manifestProbes] = await Promise.all([
      Promise.all(videoCandidates.map((stream: any) => probeMediaUrl(stream.url))),
      Promise.all(audioCandidates.map((stream: any) => probeMediaUrl(stream.url))),
      Promise.all(manifestUrls.map((manifest: string) => probeManifestUrl(manifest))),
    ]);
    const mediaProbe: any = mediaProbes.find((probe: any) => probe.ok) || mediaProbes[0] || null;
    const audioProbe: any = audioProbes.find((probe: any) => probe.ok) || audioProbes[0] || null;
    const manifestProbe: any = manifestProbes.find((probe: any) => probe.ok) || manifestProbes[0] || null;
    const hasMuxedAudio = bundle.videoStreams.some((stream: any) => !stream.videoOnly);
    const manifestPlayable = !!(manifestProbe && manifestProbe.ok);
    const hasAudioPath = hasMuxedAudio || (!!(mediaProbe && mediaProbe.ok) && !!(audioProbe && audioProbe.ok)) || manifestPlayable;
    const playbackVerified = manifestPlayable || (!!(mediaProbe && mediaProbe.ok) && hasAudioPath);
    if ((!bundle.videoStreams.length && !manifestPlayable) || !playbackVerified) {
      const status = mediaProbe?.status || audioProbe?.status || manifestProbe?.status || "none";
      throw new Error("Video/audio playback verification failed (HTTP " + status + ").");
    }
    const heights = [...new Set(bundle.videoStreams.map((stream: any) => Number(stream.height)).filter((height: number) => height > 0))];
    return {
      ...bundle,
      instance: instance.url,
      elapsedMs: Date.now() - started,
      score: bundleScore(bundle) + Math.min(Number(instance.score) || 0, 200),
      heights,
      playbackVerified,
      audioAvailable: hasAudioPath,
      mediaProbe,
      audioProbe,
      manifestProbe,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function extract(videoId: string, excluded: string[]) {
  const excludedSet = new Set((excluded || []).map(cleanBase).filter(Boolean));
  const instances = (await loadOfficialInstances())
    .filter((item) => !excludedSet.has(item.url))
    .sort((a, b) => {
      const rank = (status: string) => status === "healthy" ? 3 : status === "degraded" ? 2 : status === "unknown" ? 1 : 0;
      return rank(b.status) - rank(a.status) || b.score - a.score || a.url.localeCompare(b.url);
    });

  if (!instances.length) throw new Error("No official HTTPS Invidious instances are available.");
  const failures: string[] = [];
  let best: any = null;

  for (let offset = 0; offset < instances.length; offset += BATCH_SIZE) {
    const batch = instances.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((instance) => probeInstance(instance, videoId)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (!best || result.value.score > best.score) best = result.value;
      } else {
        failures.push(String(result.reason?.message || result.reason).slice(0, 180));
      }
    }
    const heights = best?.heights || [];
    // Evaluate every currently advertised official instance; a 720p result is not
    // proof that a later instance cannot supply a higher selectable quality.
  }

  if (!best) throw new Error("All official Invidious instances failed: " + failures.slice(0, 5).join(" | "));
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
      playbackVerified: best.playbackVerified === true,
      audioAvailable: best.audioAvailable === true,
      mediaProbe: best.mediaProbe || null,
      audioProbe: best.audioProbe || null,
      manifestProbe: best.manifestProbe || null,
    },
  };
}

export default { async fetch(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return responseJson({ success: false, error: "Method not allowed." }, 405);

  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== "https://edall.lovable.app") {
      return responseJson({ success: false, error: "Origin is not allowed." }, 403);
    }
    const body = await req.json();
    const videoId = String(body?.videoId || "");
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      return responseJson({ success: false, error: "A valid YouTube video ID is required." }, 400);
    }
    const excluded = Array.isArray(body?.excludeInstances) ? body.excludeInstances.map(String).slice(0, 30) : [];
    const result = await extract(videoId, excluded);
    return responseJson(result);
  } catch (error) {
    console.error("[extract-youtube-stream]", error);
    return responseJson({
      success: false,
      error: String((error as Error)?.message || error || "Unknown extractor error").slice(0, 500),
    }, 502);
  }
} };
