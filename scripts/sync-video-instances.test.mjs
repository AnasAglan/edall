import test from "node:test";
import assert from "node:assert/strict";
import { discoverPiped, discoverInvidious, assessSamplePlayback, SAMPLE_VIDEO_IDS } from "./sync-video-instances.mjs";

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

test("rejects a server when every media path is blocked", () => {
  const result = assessSamplePlayback({
    mediaProbes: [{ ok: false, status: 403 }],
    audioProbes: [{ ok: false, status: 403 }],
    muxedAudio: false,
  });
  assert.equal(result.playable, false);
});
