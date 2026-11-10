import test from "node:test";
import assert from "node:assert/strict";
import { discoverPiped, discoverInvidious, assessSamplePlayback, SAMPLE_VIDEO_IDS, parseHlsPlaylist, verifiedSampleHeights } from "./sync-video-instances.mjs";

test("discovers Piped API hosts from the current public directory table only", () => {
  const markdown = [
    "Instance Name | Instance API URL | Location | CDN | Registered Users",
    "Official | https://pipedapi.example | US | Yes | ![](https://pipedapi.example/registered/badge)",
    "Wrong | https://example.com | US | No | -",
    "HTTP | http://pipedapi.insecure.example | US | No | -",
    "Path | https://pipedapi.example/path | US | No | -",
  ].join("\n");
  assert.deepEqual(discoverPiped(markdown).map((item) => item.url), ["https://pipedapi.example"]);
});

test("keeps only HTTPS entries in the official Invidious list", () => {
  const rows = [
    ["inv.example", { type: "https", uri: "https://inv.example", api: true, cors: true }],
    ["http.example", { type: "http", uri: "http://http.example", api: true }],
    ["path.example", { type: "https", uri: "https://path.example/path", api: true }],
  ];
  assert.deepEqual(discoverInvidious(rows).map((item) => item.url), ["https://inv.example"]);
});

test("probes more than one public sample so one video's restricted formats do not define an instance", () => {
  assert.equal(SAMPLE_VIDEO_IDS.length >= 2, true);
  assert.equal(new Set(SAMPLE_VIDEO_IDS).size, SAMPLE_VIDEO_IDS.length);
});

test("does not mark video-only media as playback-ready without audio", () => {
  const result = assessSamplePlayback({
    mediaProbes: [{ ok: true, status: 206 }],
    audioProbes: [{ ok: false, status: 403 }],
    muxedAudio: false,
  });
  assert.equal(result.playable, false);
  assert.equal(result.audioAvailable, false);
});

test("accepts separate audio/video when both actual media URLs respond", () => {
  const result = assessSamplePlayback({
    mediaProbes: [{ ok: true, status: 206 }],
    audioProbes: [{ ok: true, status: 206 }],
    muxedAudio: false,
  });
  assert.equal(result.playable, true);
  assert.equal(result.audioAvailable, true);
});

test("accepts one verified muxed stream or a valid manifest", () => {
  assert.equal(assessSamplePlayback({
    mediaProbes: [{ ok: true, status: 206 }],
    muxedAudio: true,
  }).playable, true);
  assert.equal(assessSamplePlayback({
    manifestProbes: [{ ok: true, format: "dash", corsAllowed: true }],
  }).playable, true);
});

test("parses HLS master variants and separate audio groups", () => {
  const body = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",URI="audio/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160,AUDIO="aud"',
    "video/2160/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="aud"',
    "video/1080/index.m3u8",
  ].join("\n");
  const parsed = parseHlsPlaylist(body, "https://media.example/master.m3u8");
  assert.equal(parsed.variants.length, 2);
  assert.equal(parsed.variants[0].height, 2160);
  assert.equal(parsed.variants[0].url, "https://media.example/video/2160/index.m3u8");
  assert.equal(parsed.audioTracks[0].url, "https://media.example/audio/index.m3u8");
  assert.equal(parsed.variants[0].audioGroup, "aud");
});

test("parses an HLS media playlist to its first actual segment", () => {
  const parsed = parseHlsPlaylist(
    ["#EXTM3U", "#EXT-X-TARGETDURATION:6", "#EXTINF:6,", "segments/0001.ts", "#EXTINF:6,", "segments/0002.ts"].join("\n"),
    "https://media.example/course/index.m3u8",
    720
  );
  assert.equal(parsed.segmentUrl, "https://media.example/course/segments/0001.ts");
});

test("counts only directly probed or manifest-segment-verified resolutions", () => {
  const heights = verifiedSampleHeights({
    videoCandidates: [{ height: 2160 }, { height: 1080 }],
    mediaProbes: [{ ok: false, status: 403 }, { ok: true, status: 206 }],
    manifestProbes: [{ ok: true, format: "hls", heights: [720, 480] }, { ok: false, heights: [4320] }],
  });
  assert.deepEqual(heights, [1080, 720, 480]);
});

test("rejects a server when every media path is blocked", () => {
  const result = assessSamplePlayback({
    mediaProbes: [{ ok: false, status: 403 }],
    audioProbes: [{ ok: false, status: 403 }],
    muxedAudio: false,
  });
  assert.equal(result.playable, false);
});
