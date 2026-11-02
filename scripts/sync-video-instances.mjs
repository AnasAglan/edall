import { readFile, writeFile } from "node:fs/promises";

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
    if (url.hostname.toLowerCase().endsWith(".ygg")) return null;
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

function discoverPiped(markdown) {
  const urls = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const cells = line.split("|");
    const apiCell = cells[2] || "";
    for (const match of apiCell.matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
      const url = cleanBase(match[0]);
      if (url && /piped|(^|\/\/)pa\./i.test(url)) {
        urls.push({ url, provider: "piped", official: true });
      }
    }
  }
  // Keep compatibility with formatting changes in the upstream Markdown table.
  if (!urls.length) {
    for (const match of String(markdown || "").matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
      const url = cleanBase(match[0]);
      if (url && /piped/i.test(url)) urls.push({ url, provider: "piped", official: true });
    }
  }
  return uniqueByUrl(urls);
}

function discoverInvidious(payload) {
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
    const responseMs = Date.now() - started;
    const score = 1000 +
      Math.min(inspected.heights.length, 10) * 45 +
      Math.min(Math.max(...inspected.heights, 0), 2160) / 4 +
      (inspected.audioCount ? 100 : 0) +
      (instance.uptime || 0) * 2 -
      Math.min(responseMs, 10000) / 20;
    return {
      ...instance,
      status: "healthy",
      score: Math.round(score),
      responseMs,
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

  console.log(JSON.stringify({
    piped: { total: checkedPiped.length, healthy: checkedPiped.filter((x) => x.status === "healthy").length },
    invidious: { total: checkedInvidious.length, healthy: checkedInvidious.filter((x) => x.status === "healthy").length },
    sourceErrors,
  }, null, 2));

  if (sourceErrors.length === 2) {
    throw new Error("Both official directories failed; kept the previous registry but did not claim a successful refresh.");
  }
}

main().catch((error) => {
  console.error("[video-instances-sync] " + String(error && error.stack || error));
  process.exitCode = 1;
});
