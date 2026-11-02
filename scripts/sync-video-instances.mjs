import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PIPED_SOURCE = "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md";
const INVIDIOUS_SOURCE = "https://api.invidious.io/instances.json?sort_by=health";
const OUTPUT = new URL("../public/video-instances.json", import.meta.url);
const SAMPLE_VIDEO_ID = "dQw4w9WgXcQ";
const REQUEST_TIMEOUT_MS = 7000;
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + url);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + url);
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
      cors: meta.cors === true,
      uptime: Number(monitor.uptime) || null,
      monitorDown: monitor.down === true,
      listedVersion: meta.stats && meta.stats.software ? meta.stats.software.version || null : null,
    });
  }
  return uniqueByUrl(entries);
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
      headers: { Range: "bytes=0-1", Origin: "https://edall.lovable.app" },
      signal: controller.signal,
      cache: "no-store",
    });
    const result = {
      ok: response.status === 206 || response.status === 200,
      status: response.status,
      cors: response.headers.get("access-control-allow-origin"),
      error: null,
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { ok: false, status: null, cors: null, error: String(error && error.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeManifest(url) {
  if (!url) return { ok: false, status: null, cors: null, contentType: null, format: null, error: "No DASH/HLS manifest URL was returned." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/dash+xml, application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        Origin: "https://edall.lovable.app",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const cors = response.headers.get("access-control-allow-origin");
    const contentType = response.headers.get("content-type");
    const body = response.ok ? await response.text() : "";
    const isDash = /<MPD\b/i.test(body);
    const isHls = /#EXTM3U/i.test(body);
    const format = isDash ? "dash" : isHls ? "hls" : null;
    const corsAllowed = cors === "*" || cors === "https://edall.lovable.app";
    return {
      ok: response.ok && !!format && corsAllowed,
      status: response.status,
      cors,
      contentType,
      format,
      error: !response.ok
        ? "Manifest HTTP " + response.status
        : !format
          ? "The response was not a DASH MPD or HLS playlist."
          : !corsAllowed
            ? "Manifest CORS does not allow https://edall.lovable.app."
            : null,
    };
  } catch (error) {
    return { ok: false, status: null, cors: null, contentType: null, format: null, error: String(error && error.message || error).slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeInstance(instance) {
  const started = Date.now();
  const endpoint = instance.provider === "piped"
    ? instance.url + "/streams/" + SAMPLE_VIDEO_ID
    : instance.url + "/api/v1/videos/" + SAMPLE_VIDEO_ID + "?fields=title,lengthSeconds,liveNow,hlsUrl,dashUrl,formatStreams,adaptiveFormats";
  try {
    const data = await fetchJson(endpoint);
    const inspected = instance.provider === "piped" ? pipedHasStreams(data) : invidiousHasStreams(data);
    if (!inspected.valid || !inspected.videoCount && !data.hlsUrl && !data.hls && !data.dashUrl && !data.dash) {
      throw new Error("API answered but returned no usable video streams.");
    }
    const videoItems = instance.provider === "piped"
      ? (Array.isArray(data.videoStreams) ? data.videoStreams : [])
      : [...(Array.isArray(data.formatStreams) ? data.formatStreams : []), ...(Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [])]
          .filter((stream) => String(stream && stream.type || "").startsWith("video/"));
    const sampleMedia = videoItems.find((stream) => stream && /^https:\/\//i.test(String(stream.url || "")));
    const manifestUrls = instance.provider === "piped"
      ? [data.dash, data.hls]
      : [data.dashUrl, data.hlsUrl];
    const [mediaProbe, ...manifestProbes] = await Promise.all([
      probeMediaRange(sampleMedia && sampleMedia.url),
      ...manifestUrls.filter(Boolean).map(probeManifest),
    ]);
    const manifestProbe = manifestProbes.find((probe) => probe.ok) || manifestProbes[0] || null;
    const playbackVerified = mediaProbe.ok || !!(manifestProbe && manifestProbe.ok);
    const responseMs = Date.now() - started;
    const score = 1000 +
      Math.min(inspected.heights.length, 10) * 45 +
      Math.min(Math.max(...inspected.heights, 0), 2160) / 4 +
      (inspected.audioCount ? 100 : 0) +
      (mediaProbe.ok ? 250 : -100) +
      (manifestProbe && manifestProbe.ok ? 300 : 0) +
      (mediaProbe.status === 206 ? 50 : 0) +
      (instance.uptime || 0) * 2 -
      Math.min(responseMs, 10000) / 20;
    return {
      ...instance,
      // Prefer endpoints whose direct media or CORS-enabled DASH/HLS path was actually verified.
      status: playbackVerified ? "healthy" : "degraded",
      score: Math.round(score),
      responseMs,
      mediaProbe,
      manifestProbe,
      videoCount: inspected.videoCount,
      audioCount: inspected.audioCount,
      heights: inspected.heights.sort((a, b) => b - a),
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      ...instance,
      status: "unhealthy",
      score: Math.max(0, Math.round((instance.uptime || 0) * 2)),
      responseMs: Date.now() - started,
      mediaProbe: null,
      manifestProbe: null,
      videoCount: 0,
      audioCount: 0,
      heights: [],
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
      error: String(error && error.message || error).slice(0, 240),
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
    fetchJson(INVIDIOUS_SOURCE).then((json) => { const list = discoverInvidious(json); if (!list.length) throw new Error("Invidious directory contained no validated public HTTPS endpoints."); return list; }),
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
  invidious = invidious || [];

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
    refreshedDaily: true,
    sources: {
      piped: checkedPiped,
      invidious: checkedInvidious,
    },
    sourceErrors,
    policy: {
      onlyOfficialDirectories: true,
      onlyHttps: true,
      failedInstancesAreRetained: true,
      healthyInstancesFirst: true,
      probeVideoId: SAMPLE_VIDEO_ID,
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
    heights: item.heights,
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[video-instances-sync] " + String(error && error.stack || error));
    process.exitCode = 1;
  });
}
