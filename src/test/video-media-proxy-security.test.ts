import { afterEach, describe, expect, it, vi } from "vitest";
import videoMediaProxy from "../../workers/video-media-proxy/index.js";
afterEach(() => vi.unstubAllGlobals());
const STAGING_ORIGIN = "https://id-preview--c65d2fd9-1c85-479f-9347-d54b6341e6a7.lovable.app";
const STAGING_ENV = { EDALL_ALLOWED_ORIGIN: STAGING_ORIGIN, EDALL_SERVICE_NAME: "edall-video-media-proxy-staging" };
const MEDIA_URL = "https://r1.googlevideo.com/videoplayback?itag=137";
function request(url = MEDIA_URL, requestOrigin = STAGING_ORIGIN) {
  return new Request("https://proxy.example/media?url=" + encodeURIComponent(url), { method: "GET", headers: { Origin: requestOrigin } });
}
describe("video media proxy environment isolation", () => {
  it("allows the Staging origin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("video", { status: 206, headers: { "Content-Type": "video/mp4" } })));
    const res = await videoMediaProxy.fetch(request(), STAGING_ENV);
    expect(res.status).toBe(206); expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_ORIGIN);
  });
  it("rejects production origin through the Staging Worker before fetch", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const res = await videoMediaProxy.fetch(request(MEDIA_URL, "https://edall.lovable.app"), STAGING_ENV);
    expect(res.status).toBe(403); expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects arbitrary origins", async () => {
    const res = await videoMediaProxy.fetch(request(MEDIA_URL, "https://attacker.example"), STAGING_ENV);
    expect(res.status).toBe(403);
  });
  it("blocks redirects to untrusted targets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/latest/meta-data" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await videoMediaProxy.fetch(request(), STAGING_ENV);
    expect(res.status).toBe(502); expect(await res.text()).toContain("redirect target is not allowed"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("allows safe GoogleVideo redirects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://r2.googlevideo.com/videoplayback?itag=137&sig=ok" } }))
      .mockResolvedValueOnce(new Response("chunk", { status: 206, headers: { "Content-Type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await videoMediaProxy.fetch(request(), STAGING_ENV);
    expect(res.status).toBe(206); expect(await res.text()).toBe("chunk"); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" }); expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "manual" });
  });
  it("caps redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://r2.googlevideo.com/videoplayback?next=1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await videoMediaProxy.fetch(request(), STAGING_ENV);
    expect(res.status).toBe(502); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("preserves production allowlist without Staging vars", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("video", { status: 206, headers: { "Content-Type": "video/mp4" } })));
    const res = await videoMediaProxy.fetch(request(MEDIA_URL, "https://edall.lovable.app"));
    expect(res.status).toBe(206); expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://edall.lovable.app");
  });
});
