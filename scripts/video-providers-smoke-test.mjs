import { readFileSync } from "node:fs";

const VIDEO_ID = "dQw4w9WgXcQ";
const MEDIA_PROXY_URL = "https://edall-video-media-proxy.anasaglan2011.workers.dev";
const INVIDIOUS_WORKER_URL = "https://edall-invidious-extractor.anasaglan2011.workers.dev";
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
    headers: { Range: "bytes=0-1023" },
    signal: timeout(12000),
  });
  const contentRange = response.headers.get("content-range") || "";
  const allowOrigin = response.headers.get("access-control-allow-origin") || "";
  const contentType = response.headers.get("content-type") || "";
  await response.body?.cancel();
  if (response.status !== 206 || !contentRange.startsWith("bytes ") ||
      (isGoogleVideo(url) && allowOrigin !== "*") ||
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

let invidiousResult = null;
let invidiousError = null;
try { invidiousResult = await testInvidiousWorker(); }
catch (error) { invidiousError = String(error?.message || error); }

if (!pipedResults.length && !invidiousResult) {
  throw new Error("No live video provider passed a real range/media test. Piped: " +
    (piped.length ? "all configured instances failed" : "no instances") +
    "; Invidious: " + (invidiousError || "unavailable"));
}

console.log(JSON.stringify({
  success: true,
  videoId: VIDEO_ID,
  mediaProxy: "healthy",
  piped: pipedResults,
  invidious: invidiousResult,
  invidiousWarning: invidiousError,
}, null, 2));
