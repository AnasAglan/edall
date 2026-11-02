const DOCS_URL = "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
const VIDEO_ID = "dQw4w9WgXcQ";
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

async function inspectInstance(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(base + "/streams/" + VIDEO_ID, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json", Origin: ORIGIN },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("API returned HTTP " + response.status);
    if (!hasCorsAccess(response)) {
      throw new Error("API does not allow cross-origin fetch from " + ORIGIN);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.videoStreams) || !Array.isArray(data.audioStreams)) {
      throw new Error("API response does not contain Piped videoStreams/audioStreams arrays");
    }

    const videos = data.videoStreams.filter(stream =>
      stream && typeof stream.url === "string" &&
      /^https:\/\//i.test(stream.url) &&
      Number(stream.height) > 0 &&
      /^video\/(mp4|webm)/i.test(String(stream.mimeType || ""))
    );
    const audios = data.audioStreams.filter(stream =>
      stream && typeof stream.url === "string" &&
      /^https:\/\//i.test(stream.url) &&
      /^audio\/(mp4|webm|ogg|mpeg)/i.test(String(stream.mimeType || ""))
    );
    if (!videos.length) throw new Error("No HTTPS browser-compatible video streams were returned");

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
      title: String(data.title || ""),
      videoCount: videos.length,
      audioCount: audios.length,
      heights,
      usedSeparateAudio: !!audio,
      apiCors: response.headers.get("access-control-allow-origin"),
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
console.log("Checking " + instances.length + " Piped API instances for video " + VIDEO_ID + "...");

const failures = [];
for (let offset = 0; offset < instances.length; offset += 4) {
  const batch = instances.slice(offset, offset + 4);
  const controllers = [];
  const attempts = batch.map(base => inspectInstance(base).then(result => ({ ...result, base })));
  try {
    const healthy = await Promise.any(attempts);
    console.log("LIVE PIPED CHECK PASSED");
    console.log(JSON.stringify(healthy, null, 2));
    process.exit(0);
  } catch (error) {
    const reasons = error && Array.isArray(error.errors) ? error.errors : [error];
    failures.push(...reasons.map(reason => String(reason && reason.message || reason)));
    console.warn("This group had no usable instance; continuing to the next group.");
  }
}

console.error("No public Piped instance passed API, CORS, stream-shape and byte-range checks.");
console.error(failures.slice(0, 20).join("\n"));
process.exit(1);
