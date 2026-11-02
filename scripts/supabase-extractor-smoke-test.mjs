import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const urlMatch = html.match(/const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = html.match(/const SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
if (!urlMatch || !keyMatch) throw new Error("Could not find the public Supabase project URL/anon key in the platform HTML.");

const projectUrl = urlMatch[1].replace(/\/$/, "");
const anonKey = keyMatch[1];
const endpoint = projectUrl + "/functions/v1/extract-youtube-stream";
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": anonKey,
    "Authorization": "Bearer " + anonKey,
    "Origin": "https://edymaster.lovable.app",
  },
  body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
  signal: AbortSignal.timeout(22000),
});
const responseText = await response.text();
let payload;
try { payload = JSON.parse(responseText); }
catch { payload = { raw: responseText.slice(0, 600) }; }

if (response.status === 404) {
  console.warn("SUPABASE EXTRACTOR NOT DEPLOYED: the project returned HTTP 404 for /functions/v1/extract-youtube-stream. The repository source file is not a live function until it is deployed to Supabase.");
} else if (!response.ok) {
  throw new Error("Supabase Edge Function returned HTTP " + response.status + ": " +
    String(payload && (payload.message || payload.error) || responseText).slice(0, 500));
}

if (response.status === 404) process.exit(0);

const qualities = Array.isArray(payload.qualities)
  ? payload.qualities.filter(item => item && Number(item.height) > 0 && /^https:\/\//i.test(String(item.url || "")))
  : [];
const videoStreams = Array.isArray(payload.videoStreams) ? payload.videoStreams : [];
const audioStreams = Array.isArray(payload.audioStreams) ? payload.audioStreams : [];
const result = {
  endpoint,
  status: response.status,
  cors: response.headers.get("access-control-allow-origin") || "(not returned)",
  success: payload.success,
  title: String(payload.title || "").slice(0, 100),
  qualities: qualities.map(item => Number(item.height)).sort((a, b) => b - a),
  pipedVideoStreams: videoStreams.length,
  pipedAudioStreams: audioStreams.length,
  hlsAvailable: !!payload.hlsUrl,
  responseKeys: Object.keys(payload || {}),
};
console.log("SUPABASE EDGE EXTRACTOR CHECK");
console.log(JSON.stringify(result, null, 2));

if (!payload.success || (!qualities.length && !videoStreams.length && !payload.hlsUrl)) {
  throw new Error("The deployed Supabase extractor did not return playable stream URLs.");
}

const sampleUrl = qualities[0]?.url || videoStreams[0]?.url;
if (sampleUrl) {
  const media = await fetch(sampleUrl, {
    headers: { Range: "bytes=0-1", Origin: "https://edymaster.lovable.app" },
    signal: AbortSignal.timeout(10000),
  });
  const mediaSummary = {
    status: media.status,
    cors: media.headers.get("access-control-allow-origin") || "(not returned)",
    contentType: media.headers.get("content-type") || "(not returned)",
  };
  if (media.body) await media.body.cancel().catch(() => {});
  console.log("SUPABASE EXTRACTOR MEDIA URL CHECK");
  console.log(JSON.stringify(mediaSummary, null, 2));
  if (!media.ok) throw new Error("Supabase extractor returned a media URL that answered HTTP " + media.status);
}
