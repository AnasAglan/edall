import { readFileSync } from "node:fs";

const VIDEO_ID = "dQw4w9WgXcQ";
const MEDIA_PROXY_URL = "https://edall-video-media-proxy.anasaglan2011.workers.dev";
const INVIDIOUS_WORKER_URL = "https://edall-invidious-extractor.anasaglan2011.workers.dev";
const APP_ORIGIN = "https://edall.lovable.app";
const timeout = (ms) => AbortSignal.timeout(ms);

function isGoogleVideo(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "googlevideo.com" || parsed.hostname.endsWith(".googlevideo.com")) &&
      parsed.pathname === "/videoplayback";
  } catch {
    return false;
  }
}

async function probeMedia(url, label) {
  const target = isGoogleVideo(url)
    ? (() => { const value = new URL(MEDIA_PROXY_URL + "/media"); value.searchParams.set("url", url); return value; })()
    : new URL(url);
  const response = await fetch(target, {
    headers: { Range: "bytes=0-1023", Origin: APP_ORIGIN },
    signal: timeout(12000),
  });
  const contentRange = response.headers.get("content-range") || "";
  const allowOrigin = response.headers.get("access-control-allow-origin") || "";
  const contentType = response.headers.get("content-type") || "";
  await response.body?.cancel();
  const corsAllowed = allowOrigin === "*" || allowOrigin === APP_ORIGIN;
  const throughMediaProxy = target.origin === new URL(MEDIA_PROXY_URL).origin;
  if (response.status !== 206 || !contentRange.startsWith("bytes ") ||
      (throughMediaProxy && !corsAllowed) ||
      !/(?:video|audio)\//i.test(contentType)) {
    throw new Error(label + " media range failed: HTTP " + response.status +
      ", Content-Range=" + contentRange + ", Content-Type=" + contentType +
      ", ACAO=" + allowOrigin);
  }
  return { status: response.status, contentType, proxied: isGoogleVideo(url) };
}

async function testPipedInstance(instance) {
  const response = await fetch(instance.url.replace(/\/$/, "") + "/streams/" + encodeURIComponent(VIDEO_ID), {
    headers: { Accept: "application/json" },
    signal: timeout(9000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(instance.url + " API HTTP " + response.status);
  const data = await response.json();
  const videos = Array.isArray(data.videoStreams) ? data.videoStreams : [];
  const audios = Array.isArray(data.audioStreams) ? data.audioStreams : [];
  const heights = [...new Set(videos.map(item => Number(item.height) ||
    Number((String(item.quality || "").match(/(\d{3,4})p/i) || [])[1])).filter(Number.isFinite))].sort((a,b)=>b-a);
  if (!videos.length || !heights.length) throw new Error(instance.url + " returned no selectable video qualities.");
  const candidates = videos.slice().sort((a,b)=>(Number(b.height)||0)-(Number(a.height)||0));
  let playable = false;
  let lastError = "";
  for (const stream of candidates.slice(0,3)) {
    try {
      await probeMedia(stream.url, "Piped " + instance.url + " video");
      playable = true;
      break;
    } catch (error) { lastError = String(error?.message || error); }
  }
  if (!playable) throw new Error(lastError || instance.url + " has no verified playable stream.");
  if (audios.length) {
    try { await probeMedia(audios[0].url, "Piped " + instance.url + " audio"); }
    catch (error) { throw new Error(String(error?.message || error)); }
  } else if (!videos.some(stream => stream.videoOnly !== true && stream.videoOnly !== "true") && !data.hls && !data.dash) {
    throw new Error(instance.url + " has video-only streams without a verified audio path.");
  }
  return { provider: "piped", instance: instance.url, heights, videoStreams: videos.length, audioStreams: audios.length, path: "range-verified" };
}

async function testInvidiousWorker() {
  const response = await fetch(INVIDIOUS_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ videoId: VIDEO_ID, excludeInstances: [] }),
    signal: timeout(26000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error("Invidious extractor HTTP " + response.status + ": " + String(payload?.error || "invalid response").slice(0, 300));
  const videos = Array.isArray(payload.videoStreams) ? payload.videoStreams : [];
  const audios = Array.isArray(payload.audioStreams) ? payload.audioStreams : [];
  const heights = [...new Set(videos.map(item => Number(item.height)).filter(Number.isFinite))].sort((a,b)=>b-a);
  if (!videos.length || !heights.length) throw new Error("Invidious returned no selectable qualities.");
  await probeMedia(videos[0].url, "Invidious video");
  if (audios.length) await probeMedia(audios[0].url, "Invidious audio");
  else if (!videos.some(stream => stream.videoOnly !== true && stream.videoOnly !== "true")) throw new Error("Invidious returned video-only streams without audio.");
  return { provider: "invidious", instance: payload.instance, heights, videoStreams: videos.length, audioStreams: audios.length, path: "range-verified" };
}


async function testDirectInvidiousBrowserApi(registry) {
  const listed = Array.isArray(registry.sources?.invidious) ? registry.sources.invidious : [];
  const candidates = listed.filter(item => item?.official === true && item?.apiListed === true &&
    item?.cors === true && item?.status !== "unhealthy");
  if (!candidates.length) return null;

  const failures = [];
  for (const instance of candidates) {
    const base = new URL(instance.url).origin;
    try {
      const endpoint = base + "/api/v1/videos/" + encodeURIComponent(VIDEO_ID) +
        "?fields=title,lengthSeconds,liveNow,hlsUrl,dashUrl,formatStreams,adaptiveFormats";
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json", Origin: APP_ORIGIN },
        signal: timeout(10000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("API HTTP " + response.status);
      const allowOrigin = response.headers.get("access-control-allow-origin") || "";
      if (allowOrigin !== "*" && allowOrigin !== APP_ORIGIN) {
        throw new Error("API CORS did not allow " + APP_ORIGIN);
      }
      const data = await response.json();
      const formats = [
        ...(Array.isArray(data.formatStreams) ? data.formatStreams.map(stream => ({ ...stream, sourceKind: "muxed" })) : []),
        ...(Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats.map(stream => ({ ...stream, sourceKind: "adaptive" })) : []),
      ];
      const videos = formats.filter(stream => String(stream.type || stream.mimeType || "").split(";")[0].trim().toLowerCase().startsWith("video/"));
      const audios = formats.filter(stream => String(stream.type || stream.mimeType || "").split(";")[0].trim().toLowerCase().startsWith("audio/"));
      const heights = [...new Set(videos.map(stream => {
        const raw = String(stream.qualityLabel || stream.resolution || stream.quality || "");
        const match = raw.match(/(?:x|^|\D)(\d{3,4})(?:p|\b)/i);
        return Number(match?.[1]) || 0;
      }).filter(Boolean))].sort((a,b)=>b-a);
      if (!videos.length || !heights.length) throw new Error("API returned no selectable video qualities.");

      const rankedVideos = videos.slice().sort((a,b) => {
        const getHeight = stream => Number((String(stream.qualityLabel || stream.resolution || stream.quality || "").match(/(?:x|^|\D)(\d{3,4})(?:p|\b)/i) || [])[1]) || 0;
        return getHeight(b) - getHeight(a);
      });
      let playableVideo = false;
      let lastVideoError = "";
      for (const stream of rankedVideos.slice(0,4)) {
        try { await probeMedia(stream.url, "Invidious browser API video"); playableVideo = true; break; }
        catch (error) { lastVideoError = String(error?.message || error); }
      }
      if (!playableVideo) throw new Error(lastVideoError || "No media range-verified video stream.");

      const hasMuxed = videos.some(stream => stream.sourceKind === "muxed" &&
        /(?:mp4a|opus|vorbis|aac)/i.test(String(stream.type || stream.mimeType || "")));
      let audioAvailable = hasMuxed;
      if (!audioAvailable && audios.length) {
        let lastAudioError = "";
        for (const stream of audios.slice(0,3)) {
          try { await probeMedia(stream.url, "Invidious browser API audio"); audioAvailable = true; break; }
          catch (error) { lastAudioError = String(error?.message || error); }
        }
        if (!audioAvailable) throw new Error(lastAudioError || "No range-verified audio stream.");
      }
      if (!audioAvailable) throw new Error("API returned no verified audio path.");

      return { provider: "invidious", instance: base, heights, videoStreams: videos.length,
        audioStreams: audios.length, path: "browser-direct-api+range-verified", cors: allowOrigin };
    } catch (error) {
      failures.push(base + ": " + String(error?.message || error).slice(0,180));
    }
  }
  throw new Error("All official browser-accessible Invidious API instances failed: " + failures.join(" | "));
}

const mediaHealthResponse = await fetch(MEDIA_PROXY_URL + "/health", { signal: timeout(10000) });
const mediaHealth = await mediaHealthResponse.json().catch(() => null);
if (!mediaHealthResponse.ok || mediaHealth?.status !== "ok") {
  throw new Error("ED-ALL media proxy Worker is not healthy.");
}

const registry = JSON.parse(readFileSync(new URL("../public/video-instances.json", import.meta.url), "utf8"));
const piped = Array.isArray(registry.sources?.piped) ? registry.sources.piped : [];
const pipedResults = [];
for (let offset = 0; offset < piped.length && !pipedResults.length; offset += 8) {
  const batch = piped.slice(offset, offset + 8);
  const results = await Promise.allSettled(batch.map(testPipedInstance));
  pipedResults.push(...results.filter(item => item.status === "fulfilled").map(item => item.value));
}

let invidiousWorkerResult = null;
let invidiousWorkerError = null;
try { invidiousWorkerResult = await testInvidiousWorker(); }
catch (error) { invidiousWorkerError = String(error?.message || error); }

let invidiousBrowserResult = null;
let invidiousBrowserError = null;
try { invidiousBrowserResult = await testDirectInvidiousBrowserApi(registry); }
catch (error) { invidiousBrowserError = String(error?.message || error); }

const eligibleInvidious = (registry.sources?.invidious || []).some(item =>
  item?.official === true && item?.apiListed === true && item?.cors === true && item?.status !== "unhealthy");
const invidiousResult = invidiousWorkerResult || invidiousBrowserResult;
if (!pipedResults.length && !invidiousResult) {
  throw new Error("No live video provider passed a real range/media test. Piped: " +
    (piped.length ? "all configured instances failed" : "no instances") +
    "; Invidious Worker: " + (invidiousWorkerError || "unavailable") +
    "; Invidious browser API: " + (invidiousBrowserError || "unavailable"));
}
const invidiousUnavailable = !invidiousWorkerResult && !invidiousBrowserResult;
if (eligibleInvidious && invidiousUnavailable) {
  console.warn("INVIDIOUS UNAVAILABLE: its listed public API/CORS candidate did not pass the real media test. " +
    "This remains a provider-specific warning; a verified Piped result is still a valid platform playback path.");
}

console.log(JSON.stringify({
  success: true,
  videoId: VIDEO_ID,
  mediaProxy: "healthy",
  providers: {
    piped: pipedResults.length ? "playable" : "unavailable",
    invidious: invidiousUnavailable ? "unavailable" : "playable",
  },
  piped: pipedResults,
  invidious: invidiousResult,
  invidiousWorker: invidiousWorkerResult,
  invidiousWorkerWarning: invidiousWorkerError,
  invidiousBrowserFallbackWarning: invidiousBrowserError,
}, null, 2));
