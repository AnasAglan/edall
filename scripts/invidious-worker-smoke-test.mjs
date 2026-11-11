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

const proxiedVideo = videoStreams.some((stream) => String(stream.url || "").startsWith(WORKER_URL + "/media?url="));
const proxiedAudio = audioStreams.some((stream) => String(stream.url || "").startsWith(WORKER_URL + "/media?url="));
if (!payload.proxyUrl || !proxiedVideo || !proxiedAudio) {
  throw new Error("Invidious Worker did not return CORS-proxied video and audio stream URLs.");
}
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
