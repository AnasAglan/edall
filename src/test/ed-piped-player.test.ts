import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { TextEncoder } from "node:util";

const playerSource = readFileSync(resolve(process.cwd(), "public/ed_piped_player.js"), "utf8");
const platformHtml = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");

function loadHelpers(canPlayTypeResult = "probably") {
  const sandbox = {
    window: {},
    document: {
      createElement: () => ({
        canPlayType: () => canPlayTypeResult,
        setAttribute() {},
        removeAttribute() {},
      }),
    },
    URL,
    TextEncoder,
    Buffer,
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
  };

  new Script(playerSource, { filename: "ed_piped_player.js" });
  runInNewContext(playerSource, sandbox);
  return sandbox.window.EDPipedPlayer.__test;
}

const videoOnly1080 = {
  url: "https://pipedproxy.example/videoplayback?itag=137",
  mimeType: "video/mp4",
  format: "MPEG_4",
  codec: "avc1.640028",
  quality: "1080p",
  height: 1080,
  width: 1920,
  bitrate: 4000000,
  videoOnly: true,
  audioTrackId: "default",
  initStart: 0,
  initEnd: 799,
  indexStart: 800,
  indexEnd: 1199,
};

const videoOnly720 = {
  ...videoOnly1080,
  url: "https://pipedproxy.example/videoplayback?itag=136",
  quality: "720p",
  height: 720,
  width: 1280,
  bitrate: 2500000,
};

const audioTrack = {
  url: "https://pipedproxy.example/videoplayback?itag=140",
  mimeType: "audio/mp4",
  format: "M4A",
  codec: "mp4a.40.2",
  bitrate: 128000,
  audioTrackId: "default",
  initStart: 0,
  initEnd: 699,
  indexStart: 700,
  indexEnd: 999,
};

describe("ED ALL Piped player", () => {

  it("loads the same Piped engine for browser, Android WebView and Electron playback", () => {
    expect(platformHtml).toContain("_edLoadExternalScript('_edpiped', '/ed_piped_player.js'");
    expect(platformHtml).toContain("window.EDPipedPlayer.open");
    expect(platformHtml).toContain("same Piped + Shaka engine in browsers, Android WebView and Electron");
    expect(platformHtml).not.toContain("edall.anasaglan.deno.net");
  });

  it("parses the player script without syntax errors", () => {
    expect(() => new Script(playerSource)).not.toThrow();
  });

  it("accepts only browser-supported media types", () => {
    const helpers = loadHelpers("no");
    expect(helpers.browserSupports({ canPlayType: () => "no" }, "video/mp4", "avc1.640028")).toBe(false);
    expect(helpers.browserSupports({ canPlayType: () => "" }, "audio/mp4")).toBe(false);
    expect(helpers.browserSupports({ canPlayType: () => "maybe" }, "video/mp4")).toBe(true);
    expect(helpers.browserSupports({ canPlayType: () => "probably" }, "audio/mp4")).toBe(true);
    expect(helpers.browserSupports({
      canPlayType: type => type.includes("codecs=") ? "" : "probably",
    }, "video/mp4", "avc1.640028")).toBe(false);
  });

  it("normalizes Piped video-only and audio streams into selectable qualities", () => {
    const helpers = loadHelpers();
    const bundle = helpers.normalize({
      title: "ED ALL quality test",
      duration: 120,
      videoStreams: [
        videoOnly1080,
        videoOnly720,
        {
          ...videoOnly720,
          url: "http://insecure.example/video.mp4",
          height: 480,
          quality: "480p",
        },
      ],
      audioStreams: [audioTrack],
      dash: null,
      hls: null,
      proxyUrl: "https://pipedproxy.example",
    });

    expect(bundle).not.toBeNull();
    expect(bundle.videoOnly.map(stream => stream.height)).toEqual([1080, 720]);
    expect(bundle.audioStreams).toHaveLength(1);
    expect(bundle.videoOnly[0].url).toContain("https://");
    expect(bundle.title).toBe("ED ALL quality test");
  });

  it("rejects placeholder DASH byte ranges instead of building a broken manifest", () => {
    const helpers = loadHelpers();
    expect(helpers.validRange({
      initStart: 0, initEnd: 0, indexStart: 0, indexEnd: 0,
    })).toBe(false);
    expect(helpers.validRange({
      initStart: 0, initEnd: 799, indexStart: 800, indexEnd: 1199,
    })).toBe(true);
  });

  it("builds a DASH manifest containing independent video and audio adaptations", () => {
    const helpers = loadHelpers();
    const bundle = helpers.normalize({
      title: "DASH manifest test",
      duration: 120,
      videoStreams: [videoOnly1080, videoOnly720],
      audioStreams: [audioTrack],
    });
    const dataUri = helpers.buildDashDataUri(bundle);
    expect(dataUri).toMatch(/^data:application\/dash\+xml;base64,/);
    const manifest = Buffer.from(dataUri.split(",")[1], "base64").toString("utf8");
    expect(manifest).toContain('contentType="video"');
    expect(manifest).toContain('contentType="audio"');
    expect(manifest).toContain("itag=137");
    expect(manifest).toContain("itag=140");
  });

  it("keeps video-only and audio streams available when DASH ranges are absent", () => {
    const helpers = loadHelpers();
    const bundle = helpers.normalize({
      duration: 120,
      videoStreams: [{ ...videoOnly1080, initEnd: 0, indexStart: 0, indexEnd: 0 }],
      audioStreams: [{ ...audioTrack, initEnd: 0, indexStart: 0, indexEnd: 0 }],
    });
    expect(bundle.videoOnly).toHaveLength(1);
    expect(bundle.audioStreams).toHaveLength(1);
    expect(helpers.buildDashDataUri(bundle)).toBeNull();
  });

  it("selects the nearest available quality at or below the requested height", () => {
    const helpers = loadHelpers();
    expect(helpers.getPreferredHeight([1080, 720, 360], 850)).toBe(720);
    expect(helpers.getPreferredHeight([1080, 720, 360], 1080)).toBe(1080);
    expect(helpers.getPreferredHeight([720, 360], 144)).toBe(720);
  });

  it("cleans and deduplicates only secure Piped API instance URLs", () => {
    const helpers = loadHelpers();
    expect(helpers.cleanBase("https://pipedapi.example")).toBe("https://pipedapi.example");
    expect(helpers.cleanBase("http://pipedapi.example")).toBeNull();
    expect(helpers.cleanBase("https://example.com")).toBeNull();
    expect(helpers.mergeInstances([
      "https://pipedapi.example",
      "https://pipedapi.example/",
      "http://pipedapi.example",
    ])).toHaveLength(1);
  });
});
