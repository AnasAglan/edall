import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const urlMatch = html.match(/const SUPABASE_URL\\s*=\\s*['"]([^'"]+)['"]/);
const keyMatch = html.match(/const SUPABASE_ANON_KEY\\s*=\\s*['"]([^'"]+)['"]/);
if (!urlMatch || !keyMatch) {
  throw new Error("Could not find the public Supabase project URL/anon key in the platform HTML.");
}

const projectUrl = urlMatch[1].replace(/\\/$/, "");
const anonKey = keyMatch[1];
const origin = "https://edall.lovable.app";
const endpoint = projectUrl + "/functions/v1/extract-youtube-stream";
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: "Bearer " + anonKey,
    Origin: origin,
  },
  body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
  signal: AbortSignal.timeout(22000),
});
const responseText = await response.text();
let payload;
try {
  payload = JSON.parse(responseText);
} catch {
  payload = { raw: responseText.slice(0, 600) };
}

if (response.status === 404) {
  throw new Error("SUPABASE EXTRACTOR NOT DEPLOYED: HTTP 404 for /functions/v1/extract-youtube-stream. Add the SUPABASE_ACCESS_TOKEN repository secret and deploy the Edge Function.");
}
if (!response.ok) {
  throw new Error("Supabase Edge Function returned HTTP " + response.status + ": " +
    String(payload && (payload.message || payload.error) || responseText).slice(0, 500));
}

const qualities = Array.isArray(payload.qualities)
  ? [...new Set(payload.qualities.map((item) =>
      Number(typeof item === "number" ? item : item && item.height)
    ).filter((height) => Number.isFinite(height) && height > 0))].sort((a, b) => b - a)
  : [];
const videoStreams = Array.isArray(payload.videoStreams) ? payload.videoStreams : [];
const audioStreams = Array.isArray(payload.audioStreams) ? payload.audioStreams : [];
const manifestUrl = payload.dash || payload.hls || payload.dashUrl || payload.hlsUrl || null;
const result = {
  endpoint,
  status: response.status,
  cors: response.headers.get("access-control-allow-origin") || "(not returned)",
  success: payload.success,
  provider: payload.provider || "(not returned)",
  instance: payload.instance || "(not returned)",
  title: String(payload.title || "").slice(0, 100),
  qualities,
  videoStreams: videoStreams.length,
  audioStreams: audioStreams.length,
  dashAvailable: !!(payload.dash || payload.dashUrl),
  hlsAvailable: !!(payload.hls || payload.hlsUrl),
};
console.log("SUPABASE EDGE EXTRACTOR CHECK");
console.log(JSON.stringify(result, null, 2));

if (!payload.success || (!videoStreams.length && !manifestUrl)) {
  throw new Error("The deployed Supabase extractor did not return playable video streams or a DASH/HLS manifest.");
}

let manifestSummary = null;
if (manifestUrl) {
  try {
    const manifestResponse = await fetch(manifestUrl, {
      headers: {
        Accept: "application/dash+xml, application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        Origin: origin,
      },
      signal: AbortSignal.timeout(12000),
    });
    const manifestBody = manifestResponse.ok ? await manifestResponse.text() : "";
    const cors = manifestResponse.headers.get("access-control-allow-origin") || "(not returned)";
    const format = /<MPD\\b/i.test(manifestBody)
      ? "dash"
      : /#EXTM3U/i.test(manifestBody)
        ? "hls"
        : null;
    const corsAllowed = cors === "*" || cors === origin;
    manifestSummary = {
      ok: manifestResponse.ok && !!format && corsAllowed,
      status: manifestResponse.status,
      cors,
      contentType: manifestResponse.headers.get("content-type") || "(not returned)",
      format,
      error: !manifestResponse.ok
        ? "Manifest HTTP " + manifestResponse.status
        : !format
          ? "The response was not a DASH MPD or HLS playlist."
          : !corsAllowed
            ? "Manifest CORS does not allow " + origin + "."
            : null,
    };
  } catch (error) {
    manifestSummary = { ok: false, error: String(error && error.message || error).slice(0, 240) };
  }
  console.log("SUPABASE EXTRACTOR MANIFEST CHECK");
  console.log(JSON.stringify(manifestSummary, null, 2));
}

let mediaSummary = null;
const sampleStream = videoStreams.find((stream) =>
  stream && typeof stream.url === "string" && /^https:\\/\\//i.test(stream.url)
);
if (sampleStream) {
  try {
    const media = await fetch(sampleStream.url, {
      headers: { Range: "bytes=0-1", Origin: origin },
      signal: AbortSignal.timeout(10000),
    });
    mediaSummary = {
      ok: media.status === 200 || media.status === 206,
      status: media.status,
      cors: media.headers.get("access-control-allow-origin") || "(not returned)",
      contentType: media.headers.get("content-type") || "(not returned)",
    };
    if (media.body) await media.body.cancel().catch(() => {});
  } catch (error) {
    mediaSummary = { ok: false, error: String(error && error.message || error).slice(0, 240) };
  }
  console.log("SUPABASE EXTRACTOR DIRECT MEDIA CHECK");
  console.log(JSON.stringify(mediaSummary, null, 2));
}

// Some Invidious instances intentionally deny direct GoogleVideo URLs while
// exposing a valid, CORS-enabled DASH/HLS manifest. Either verified path is
// sufficient; a failed direct URL must not invalidate a working manifest.
if (!(manifestSummary && manifestSummary.ok) && !(mediaSummary && mediaSummary.ok)) {
  throw new Error("The deployed extractor returned no verified playback path. Direct media and DASH/HLS manifest checks both failed.");
}

console.log("SUPABASE EXTRACTOR PLAYBACK PATH VERIFIED");
