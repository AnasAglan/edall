const DOCS_URL = "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
const VIDEO_IDS = ["dQw4w9WgXcQ", "aqz-KE-bpKQ", "jNQXAC9IVRw"];
const ORIGIN = "https://edymaster.lovable.app";
const FALLBACKS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi-libre.kavin.rocks",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://pipedapi.owo.si",
  "https://pipedapi.ducks.party",
  "https://piped-api.codespace.cz",
  "https://pipedapi.reallyaweso.me",
  "https://api.piped.private.coffee",
  "https://pipedapi.darkness.services",
  "https://pipedapi.orangenet.cc",
];

function normalizeBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.hostname.includes("piped") || url.hostname.startsWith("pa.") ? url.origin : null;
  } catch {
    return null;
  }
}

async function getInstances() {
  const found = [];
  try {
    const response = await fetch(DOCS_URL, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const markdown = await response.text();
      for (const line of markdown.split(/\r?\n/)) {
        for (const match of line.matchAll(/https:\/\/[a-z0-9.-]+/gi)) found.push(match[0]);
      }
    }
  } catch (error) {
    console.warn("Could not load official instance list; trying the fallback list:", error.message);
  }
  return [...new Set([...found, ...FALLBACKS].map(normalizeBase).filter(Boolean))];
}

function hasCorsAccess(response) {
  const value = response.headers.get("access-control-allow-origin");
  return value === "*" || value === ORIGIN;
}

async function probeRange(stream, kind, controller) {
  const response = await fetch(stream.url, {
    method: "GET",
    headers: { Range: "bytes=0-1", Origin: ORIGIN },
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(kind + " range request returned HTTP " + response.status);
  const cors = response.headers.get("access-control-allow-origin") || "(not returned)";
  if (response.body) await response.body.cancel().catch(() => {});
  return { status: response.status, cors };
}

async function inspectInstance(base, activeControllers) {
  const controller = new AbortController();
  activeControllers.push(controller);
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    let data = null;
    let selectedVideoId = "";
    const sampleErrors = [];

    for (const videoId of VIDEO_IDS) {
      const response = await fetch(base + "/streams/" + videoId, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json", Origin: ORIGIN },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("API returned HTTP " + response.status + " for " + videoId);
      if (!hasCorsAccess(response)) {
        throw new Error("API CORS header was " +
          (response.headers.get("access-control-allow-origin") || "(missing)") +
          " for origin " + ORIGIN);
      }

      const candidate = await response.json();
      if (!candidate || !Array.isArray(candidate.videoStreams)) {
        sampleErrors.push(videoId + ": response omitted videoStreams");
        continue;
      }

      const videos = candidate.videoStreams.filter(stream => {
        if (!stream || typeof stream.url !== "string" || !/^https:\/\//i.test(stream.url)) return false;
        const mimeType = String(stream.mimeType || (
          stream.format === "MPEG_4" ? "video/mp4" :
          stream.format === "WEBM" ? "video/webm" : ""
        )).split(";")[0].trim();
        const height = Number(stream.height) ||
          Number((String(stream.quality || "").match(/(\d{3,4})p/i) || [])[1]);
        return Number(height) > 0 && /^video\/(mp4|webm)$/i.test(mimeType);
      });
      if (!videos.length) {
        const sample = candidate.videoStreams.slice(0, 2).map(stream => ({
          height: stream && stream.height,
          quality: stream && stream.quality,
          format: stream && stream.format,
          mimeType: stream && stream.mimeType,
          urlProtocol: stream && typeof stream.url === "string" ? stream.url.slice(0, 8) : "",
        }));
        sampleErrors.push(videoId + ": no usable video streams; raw=" +
          candidate.videoStreams.length + "; sample=" + JSON.stringify(sample) +
          "; apiError=" + String(candidate.error || ""));
        continue;
      }
      data = candidate;
      selectedVideoId = videoId;
      break;
    }

    if (!data) throw new Error(sampleErrors.join(" | ") || "No sample video returned usable streams");

    const videos = data.videoStreams.map(stream => {
      const mimeType = String(stream.mimeType || (
        stream.format === "MPEG_4" ? "video/mp4" :
        stream.format === "WEBM" ? "video/webm" : ""
      )).split(";")[0].trim();
      const height = Number(stream.height) ||
        Number((String(stream.quality || "").match(/(\d{3,4})p/i) || [])[1]);
      return { ...stream, mimeType, height };
    }).filter(stream =>
      typeof stream.url === "string" && /^https:\/\//i.test(stream.url) &&
      Number(stream.height) > 0 && /^video\/(mp4|webm)$/i.test(stream.mimeType)
    );

    const audios = (Array.isArray(data.audioStreams) ? data.audioStreams : []).map(stream => {
      const mimeType = String(stream && stream.mimeType || (
        stream && stream.format === "M4A" ? "audio/mp4" :
        stream && (stream.format === "OPUS" || stream.format === "OGG") ? "audio/ogg" :
        stream && stream.format === "WEBM" ? "audio/webm" : ""
      )).split(";")[0].trim();
      return { ...stream, mimeType };
    }).filter(stream =>
      stream && typeof stream.url === "string" && /^https:\/\//i.test(stream.url) &&
      /^audio\/(mp4|webm|ogg|mpeg)$/i.test(stream.mimeType)
    );

    const adaptiveVideo = videos.find(stream => stream.videoOnly === true || stream.videoOnly === "true");
    const muxedVideo = videos.find(stream => stream.videoOnly !== true && stream.videoOnly !== "true");
    if (adaptiveVideo && !audios.length && !muxedVideo) {
      throw new Error("Video-only qualities were returned without any separate audio stream");
    }
    const video = adaptiveVideo || muxedVideo || videos[0];
    const audio = adaptiveVideo && audios.length ? audios[0] : null;
    const [videoProbe, audioProbe] = await Promise.all([
      probeRange(video, "Video", controller),
      audio ? probeRange(audio, "Audio", controller) : Promise.resolve(null),
    ]);

    const heights = [...new Set(videos.map(stream => Number(stream.height)))].sort((a, b) => b - a);
    return {
      instance: base,
      videoId: selectedVideoId,
      title: String(data.title || ""),
      videoCount: videos.length,
      audioCount: audios.length,
      heights,
      usedSeparateAudio: !!audio,
      videoOnlyAvailable: !!adaptiveVideo,
      apiCors: ORIGIN,
      videoRangeStatus: videoProbe.status,
      videoCors: videoProbe.cors,
      audioRangeStatus: audioProbe && audioProbe.status,
      audioCors: audioProbe && audioProbe.cors,
    };
  } finally {
    clearTimeout(timer);
  }
}

const instances = await getInstances();
if (!instances.length) throw new Error("No secure Piped API instances were discovered.");
console.log("Checking " + instances.length + " Piped API instances against " + VIDEO_IDS.length + " public video samples...");

const failures = [];
let healthyResult = null;
for (let offset = 0; offset < instances.length; offset += 4) {
  const batch = instances.slice(offset, offset + 4);
  const controllers = [];
  const attempts = batch.map(base => inspectInstance(base, controllers).then(result => ({ ...result, base })));
  try {
    healthyResult = await Promise.any(attempts);
    controllers.forEach(controller => controller.abort());
    break;
  } catch (error) {
    controllers.forEach(controller => controller.abort());
    const reasons = error && Array.isArray(error.errors) ? error.errors : [error];
    failures.push(...reasons.map(reason => String(reason && reason.message || reason)));
    console.warn("This group had no usable instance; continuing to the next group.");
  }
}

if (healthyResult) {
  console.log("LIVE PIPED CHECK PASSED");
  console.log(JSON.stringify(healthyResult, null, 2));
} else {
  console.error("No public Piped instance passed API, CORS, stream-shape and byte-range checks.");
  console.error(failures.slice(0, 20).join("\n"));
  process.exitCode = 1;
}
