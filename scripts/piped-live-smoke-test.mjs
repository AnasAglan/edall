const DOCS_URL = "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
const VIDEO_IDS = ["dQw4w9WgXcQ", "aqz-KE-bpKQ", "jNQXAC9IVRw"];
const ORIGIN = "https://edall.lovable.app";
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
  const timer = setTimeout(() => controller.abort(), 26000);
  try {
    const candidates = [];
    const sampleErrors = [];

    for (const videoId of VIDEO_IDS) {
      try {
        const response = await fetch(base + "/streams/" + videoId, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json", Origin: ORIGIN },
          signal: controller.signal,
        });
        if (!response.ok) {
          sampleErrors.push(videoId + ": HTTP " + response.status);
          continue;
        }
        if (!hasCorsAccess(response)) {
          sampleErrors.push(videoId + ": CORS header did not allow " + ORIGIN);
          continue;
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.videoStreams)) {
          sampleErrors.push(videoId + ": response omitted videoStreams");
          continue;
        }

        const videos = data.videoStreams.map(stream => {
          const mimeType = String(stream && stream.mimeType || (
            stream && stream.format === "MPEG_4" ? "video/mp4" :
            stream && stream.format === "WEBM" ? "video/webm" : ""
          )).split(";")[0].trim();
          const height = Number(stream && stream.height) ||
            Number((String(stream && stream.quality || "").match(/(\d{3,4})p/i) || [])[1]);
          return { ...stream, mimeType, height };
        }).filter(stream =>
          stream && typeof stream.url === "string" && /^https:\/\//i.test(stream.url) &&
          Number(stream.height) > 0 && /^video\/(mp4|webm)$/i.test(stream.mimeType)
        );

        if (!videos.length) {
          const sample = data.videoStreams.slice(0, 2).map(stream => ({
            height: stream && stream.height,
            quality: stream && stream.quality,
            format: stream && stream.format,
            mimeType: stream && stream.mimeType,
          }));
          sampleErrors.push(videoId + ": no usable video streams; raw=" +
            data.videoStreams.length + "; sample=" + JSON.stringify(sample));
          continue;
        }

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

        videos.sort((a, b) =>
          Number(b.height) - Number(a.height) ||
          Number(b.mimeType === "video/mp4") - Number(a.mimeType === "video/mp4")
        );
        const adaptiveVideos = videos.filter(stream => stream.videoOnly === true || stream.videoOnly === "true");
        const muxedVideo = videos.find(stream => stream.videoOnly !== true && stream.videoOnly !== "true");
        if (adaptiveVideos.length && !audios.length && !muxedVideo) {
          sampleErrors.push(videoId + ": video-only formats returned without audio");
          continue;
        }
        const heights = [...new Set(videos.map(stream => Number(stream.height)))].sort((a, b) => b - a);
        candidates.push({
          data,
          videoId,
          videos,
          audios,
          heights,
          adaptiveVideos,
          muxedVideo,
        });
      } catch (error) {
        sampleErrors.push(videoId + ": " + String(error && error.message || error));
        if (controller.signal.aborted) break;
      }
    }

    if (!candidates.length) {
      throw new Error(sampleErrors.join(" | ") || "No sample video returned usable streams");
    }

    candidates.sort((a, b) =>
      b.heights.length - a.heights.length ||
      Math.max(...b.heights) - Math.max(...a.heights) ||
      Number(b.adaptiveVideos.length > 0 && b.audios.length > 0) -
        Number(a.adaptiveVideos.length > 0 && a.audios.length > 0)
    );

    const best = candidates[0];
    const video = best.adaptiveVideos[0] || best.muxedVideo || best.videos[0];
    const matchingAudio = best.adaptiveVideos.length && video.audioTrackId
      ? best.audios.find(stream => stream.audioTrackId && stream.audioTrackId === video.audioTrackId)
      : null;
    const audio = best.adaptiveVideos.length && best.audios.length
      ? (matchingAudio || best.audios[0])
      : null;

    const [videoProbe, audioProbe] = await Promise.all([
      probeRange(video, "Video", controller),
      audio ? probeRange(audio, "Audio", controller) : Promise.resolve(null),
    ]);

    return {
      instance: base,
      videoId: best.videoId,
      title: String(best.data.title || ""),
      videoCount: best.videos.length,
      audioCount: best.audios.length,
      heights: best.heights,
      usedSeparateAudio: !!audio,
      videoOnlyAvailable: best.adaptiveVideos.length > 0,
      testedSamples: candidates.map(item => ({
        videoId: item.videoId,
        heights: item.heights,
      })),
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
const healthyResults = [];
for (let offset = 0; offset < instances.length; offset += 4) {
  const batch = instances.slice(offset, offset + 4);
  const controllers = [];
  const attempts = batch.map(base => inspectInstance(base, controllers).then(result => ({ ...result, base })));
  const results = await Promise.allSettled(attempts);
  controllers.forEach(controller => controller.abort());
  for (const result of results) {
    if (result.status === "fulfilled") {
      healthyResults.push(result.value);
    } else {
      failures.push(String(result.reason && result.reason.message || result.reason));
    }
  }
}

healthyResults.sort((a, b) =>
  b.heights.length - a.heights.length ||
  Math.max(...b.heights) - Math.max(...a.heights) ||
  Number(b.usedSeparateAudio) - Number(a.usedSeparateAudio)
);

if (healthyResults.length) {
  console.log("LIVE PIPED CHECK PASSED: " + healthyResults.length + " instance(s) returned playable streams.");
  console.log(JSON.stringify({
    bestInstance: healthyResults[0],
    otherHealthyInstances: healthyResults.slice(1),
    failedInstances: failures.slice(0, 20),
  }, null, 2));
} else {
  console.error("No public Piped instance passed API, CORS, stream-shape and byte-range checks.");
  console.error(failures.slice(0, 20).join("\\n"));
  process.exitCode = 1;
}
