// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import extractor from "../../workers/extract-youtube-stream/index.ts";
afterEach(() => vi.unstubAllGlobals());
const STAGING_ORIGIN = "https://id-preview--c65d2fd9-1c85-479f-9347-d54b6341e6a7.lovable.app";
const STAGING_ENV = { EDALL_ALLOWED_ORIGIN: STAGING_ORIGIN, EDALL_REGISTRY_URL: STAGING_ORIGIN + "/video-instances.json" };
describe("Invidious extractor environment isolation", () => {
  it("allows the Staging origin on preflight", async () => {
    const res = await extractor.fetch(new Request("https://extractor.example/", { method: "OPTIONS", headers: { Origin: STAGING_ORIGIN } }), STAGING_ENV);
    expect(res.status).toBe(204); expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_ORIGIN);
  });
  it("rejects production origin before upstream requests", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const res = await extractor.fetch(new Request("https://extractor.example/", {
      method: "POST", headers: { Origin: "https://edall.lovable.app", "Content-Type": "application/json" }, body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
    }), STAGING_ENV);
    expect(res.status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects arbitrary preflight origins", async () => {
    const res = await extractor.fetch(new Request("https://extractor.example/", { method: "OPTIONS", headers: { Origin: "https://attacker.example" } }), STAGING_ENV);
    expect(res.status).toBe(403);
  });

  it("uses the configured Staging origin for outbound media verification", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === STAGING_ENV.EDALL_REGISTRY_URL) {
        return Response.json({
          sources: {
            invidious: [{
              url: "https://instance.example",
              score: 100,
              status: "healthy",
              official: true,
              apiListed: true,
            }],
          },
        });
      }
      if (url.startsWith("https://instance.example/api/v1/videos/")) {
        return Response.json({
          title: "Staging origin probe",
          lengthSeconds: 12,
          formatStreams: [{
            url: "https://r1.googlevideo.com/videoplayback?itag=18",
            qualityLabel: "360p",
            resolution: "640x360",
            type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          }],
          adaptiveFormats: [],
        });
      }
      if (url.startsWith("https://r1.googlevideo.com/videoplayback")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("Origin")).toBe(STAGING_ORIGIN);
        return new Response("segment", {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Access-Control-Allow-Origin": STAGING_ORIGIN,
          },
        });
      }
      throw new Error("Unexpected upstream request: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await extractor.fetch(new Request("https://extractor.example/", {
      method: "POST",
      headers: {
        Origin: STAGING_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
    }), STAGING_ENV);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.diagnostics.playbackVerified).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves the production origin default", async () => {
    const res = await extractor.fetch(new Request("https://extractor.example/", { method: "OPTIONS", headers: { Origin: "https://edall.lovable.app" } }));
    expect(res.status).toBe(204); expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://edall.lovable.app");
  });
});
