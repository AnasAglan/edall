import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { TextEncoder } from "node:util";
import { discoverPiped, discoverInvidious } from "../../scripts/sync-video-instances.mjs";

const playerSource = readFileSync(resolve(process.cwd(), "public/ed_piped_player.js"), "utf8");
const platformHtml = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const electronMain = readFileSync(resolve(process.cwd(), "electron/main.cjs"), "utf8");

function loadHelpers(canPlayTypeResult = "probably", mseSupports = false) {
  const sandbox = {
    window: mseSupports ? { MediaSource: { isTypeSupported: () => true } } : {},
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


describe("Daily extractor instance discovery", () => {
  it("discovers API hosts from the official Piped table and ignores badge URLs", () => {
    const markdown = [
      "Instance Name | Instance API URL | Instance Location(s) | CDN | Registered Users",
      "kavin.rocks (Official) | https://pipedapi.kavin.rocks | 🇺🇸 | Yes | ![](https://pipedapi.kavin.rocks/registered/badge)",
      "new-instance.example | https://new-piped-api.example | 🇩🇪 | No | ![](https://new-piped-api.example/registered/badge)",
      "Other site | https://example.com | 🇫🇷 | No | -",
    ].join("\\n");
    expect(discoverPiped(markdown).map(item => item.url)).toEqual([
      "https://pipedapi.kavin.rocks",
      "https://new-piped-api.example",
    ]);
  });

  it("only discovers HTTPS hosts in the official Invidious API response", () => {
    const instances = discoverInvidious([
      ["inv.nadeko.net", { type: "https", uri: "https://inv.nadeko.net", monitor: { uptime: 99.5 } }],
      ["legacy.example", { type: "http", uri: "http://legacy.example" }],
      ["onion.example", { type: "https", uri: "https://onion.example/path" }],
      ["inv-ygg.nadeko.net", { type: "https", uri: "https://inv-ygg.nadeko.net" }],
    ]);
    expect(instances.map(item => item.url)).toEqual(["https://inv.nadeko.net"]);
  });
});

describe("ED ALL Piped player", () => {

  it("keeps Piped playback exclusive to ordinary browsers", () => {
    expect(platformHtml).toContain("_edLoadExternalScript('_edpiped', '/ed_piped_player.js'");
    expect(platformHtml).toContain("window.EDPipedPlayer.open");
    expect(platformHtml).toContain("_edLoadLib({ nativeOnly: isDesktop || isAndroidApp });");
    expect(platformHtml).toContain("if (nativeOnly) return;");
    expect(platformHtml).toContain("if (!isAndroidApp && window.EDPipedPlayer && window.Plyr)");
    expect(platformHtml).toContain("await _edDesktopOpen(container, vid);");
    expect(platformHtml).toContain("Native apps use their own extractors: yt-dlp on desktop and NewPipe");
    expect(platformHtml).not.toContain("same Piped + Shaka engine in browsers, Android WebView and Electron");
    expect(electronMain).not.toMatch(/piped/i);
    expect(electronMain).toContain("yt-dlp.exe");
    expect(electronMain).toContain("The desktop yt-dlp extractor is not installed.");
    expect(platformHtml).not.toContain("edall.anasaglan.deno.net");
    expect(platformHtml).toContain("The YouTube fallback will use automatic quality.");
    expect(platformHtml).toContain("www.youtube-nocookie.com/embed/");
    expect(platformHtml).toContain("Plyr dependency failed to load:");
    expect(platformHtml).toContain("سيتم استخدام مشغل YouTube الاحتياطي بجودته التلقائية.");
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
    const mseHelpers = loadHelpers("no", true);
    expect(mseHelpers.browserSupports({ canPlayType: () => "" }, "video/mp4", "avc1.640028")).toBe(true);
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
    expect(bundle.videos.map(stream => stream.height)).toEqual([1080, 720]);
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


  it("normalizes Invidious formatStreams and adaptiveFormats into the unified stream model", () => {
    const helpers = loadHelpers();
    const bundle = helpers.normalize({
      title: "Invidious quality test",
      lengthSeconds: 180,
      formatStreams: [{
        url: "https://media.example/video-360.mp4",
        type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        qualityLabel: "360p",
        resolution: "640x360",
        bitrate: "500000",
      }],
      adaptiveFormats: [
        {
          url: "https://media.example/video-1080.mp4",
          type: 'video/mp4; codecs="avc1.640028"',
          qualityLabel: "1080p",
          resolution: "1920x1080",
          bitrate: "4000000",
        },
        {
          url: "https://media.example/audio.m4a",
          type: 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: "128000",
          audioQuality: "AUDIO_QUALITY_MEDIUM",
        },
      ],
    });

    expect(bundle).not.toBeNull();
    expect(bundle.provider).toBe("invidious");
    expect(bundle.videos.map(stream => stream.height).sort((a, b) => b - a)).toEqual([1080, 360]);
    expect(bundle.videoOnly.map(stream => stream.height)).toEqual([1080]);
    expect(bundle.muxedVideos.map(stream => stream.height)).toEqual([360]);
    expect(bundle.audioStreams).toHaveLength(1);
    expect(bundle.duration).toBe(180);
    expect(helpers.scoreBundle(bundle)).toBeGreaterThan(0);
  });

  it("allows the slower secondary extractor time to provide higher resolutions", () => {
    expect(playerSource).toContain("setTimeout(() => resolve(null), 7000)");
  });

  it("prioritizes registry health before last-instance stickiness", () => {
    const source = playerSource;
    expect(source).toContain("const aRegistryRank = rank(ar.status);");
    expect(source).toContain("if (aRegistryRank !== bRegistryRank) return bRegistryRank - aRegistryRank;");
    expect(source).toContain("The last successful server is only the final tie-breaker.");
  });

  it("scores normalized Piped bundles using their actual videoStreams field", () => {
    const helpers = loadHelpers();
    const bundle = helpers.normalize({
      videoStreams: [{
        url: "https://media.example/360.mp4",
        mimeType: "video/mp4",
        format: "MPEG_4",
        quality: "360p",
        height: 360,
        videoOnly: false,
      }],
      audioStreams: [],
    });
    expect(bundle).not.toBeNull();
    expect(bundle.videos).toHaveLength(1);
    expect(helpers.scoreBundle(bundle)).toBeGreaterThan(0);
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

  it("prefers the Piped instance with the richest selectable quality set", () => {
    const helpers = loadHelpers();
    const limited = {
      videos: [{ height: 360 }],
      videoOnly: [],
      muxedVideos: [{ height: 360 }],
      audioStreams: [],
      dash: null,
      hls: null,
    };
    const adaptive = {
      videos: [{ height: 1080 }, { height: 720 }, { height: 360 }],
      videoOnly: [{ height: 1080 }, { height: 720 }],
      muxedVideos: [{ height: 360 }],
      audioStreams: [{ mimeType: "audio/mp4" }],
      dash: null,
      hls: null,
    };
    expect(helpers.scoreBundle(adaptive)).toBeGreaterThan(helpers.scoreBundle(limited));
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
