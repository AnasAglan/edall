const WORKER_URL = "https://edall-invidious-extractor.anasaglan2011.workers.dev";
const VIDEO_ID = "dQw4w9WgXcQ";

const response = await fetch(WORKER_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ videoId: VIDEO_ID, excludeInstances: [] }),
  signal: AbortSignal.timeout(25000),
});

const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.success) {
  throw new Error(
    `Invidious Worker smoke test failed: HTTP ${response.status}: ${String(payload?.error || "invalid JSON response").slice(0, 300)}`,
  );
}

const videoStreams = Array.isArray(payload.videoStreams) ? payload.videoStreams : [];
const audioStreams = Array.isArray(payload.audioStreams) ? payload.audioStreams : [];
const diagnostics = payload.diagnostics || {};
const hasPlayablePath =
  diagnostics.playbackVerified === true &&
  diagnostics.audioAvailable === true &&
  (videoStreams.length > 0 || Boolean(payload.hls || payload.dash));

if (!payload.instance || !hasPlayablePath) {
  throw new Error(
    "Invidious Worker returned data but did not prove a browser-playable video+audio path: " +
      JSON.stringify({
        instance: payload.instance || null,
        videoStreams: videoStreams.length,
        audioStreams: audioStreams.length,
        playbackVerified: diagnostics.playbackVerified === true,
        audioAvailable: diagnostics.audioAvailable === true,
        mediaProbe: diagnostics.mediaProbe || null,
        audioProbe: diagnostics.audioProbe || null,
        manifestProbe: diagnostics.manifestProbe || null,
      }),
  );
}

const MEDIA_PROXY_URL = "https://edall-video-media-proxy.anasaglan2011.workers.dev";
async function verifyProxiedRange(stream, label) {
  if (!stream || !String(stream.url || "").includes("googlevideo.com")) {
    throw new Error("No GoogleVideo " + label + " stream was returned for the media proxy test.");
  }
  const proxyUrl = new URL(MEDIA_PROXY_URL + "/media");
  proxyUrl.searchParams.set("url", stream.url);
  const proxied = await fetch(proxyUrl, {
    headers: { Range: "bytes=0-1023" },
    signal: AbortSignal.timeout(15000),
  });
  const contentRange = proxied.headers.get("content-range") || "";
  const allowOrigin = proxied.headers.get("access-control-allow-origin") || "";
  if (proxied.status !== 206 || !contentRange.startsWith("bytes ") || allowOrigin !== "*") {
    await proxied.body?.cancel();
    throw new Error("Media proxy " + label + " range/CORS test failed: HTTP " + proxied.status +
      ", Content-Range=" + contentRange + ", ACAO=" + allowOrigin);
  }
  await proxied.body?.cancel();
}
const proxyVideoStream = videoStreams.find((stream) => String(stream.url || "").includes("googlevideo.com"));
const proxyAudioStream = audioStreams.find((stream) => String(stream.url || "").includes("googlevideo.com"));
await verifyProxiedRange(proxyVideoStream, "video");
await verifyProxiedRange(proxyAudioStream, "audio");

console.log(
  JSON.stringify({
    success: true,
    instance: payload.instance,
    videoQualities: [...new Set(videoStreams.map((stream) => stream.height).filter(Boolean))].sort((a, b) => b - a),
    videoStreams: videoStreams.length,
    audioStreams: audioStreams.length,
    playbackVerified: true,
    audioAvailable: true,
  }, null, 2),
);
