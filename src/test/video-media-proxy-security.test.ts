import { afterEach, describe, expect, it, vi } from "vitest";
import videoMediaProxy from "../../workers/video-media-proxy/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function proxyRequest(mediaUrl: string) {
  const encoded = encodeURIComponent(mediaUrl);
  return new Request("https://proxy.example/media?url=" + encoded, {
    method: "GET",
    headers: { Origin: "https://edall.lovable.app" },
  });
}

describe("video media proxy redirect security", () => {
  it("rejects an untrusted redirect before making a request to its destination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/latest/meta-data" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await videoMediaProxy.fetch(
      proxyRequest("https://r1.googlevideo.com/videoplayback?itag=137"),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("redirect target is not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("r1.googlevideo.com");
  });

  it("allows a redirect to another HTTPS GoogleVideo media host", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: "https://r2.googlevideo.com/videoplayback?itag=137&sig=ok" },
      }))
      .mockResolvedValueOnce(new Response("video-chunk", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-10/100",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await videoMediaProxy.fetch(
      proxyRequest("https://r1.googlevideo.com/videoplayback?itag=137"),
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("video-chunk");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "manual" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("r2.googlevideo.com");
  });

  it("does not allow more than three redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "https://r2.googlevideo.com/videoplayback?next=1" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await videoMediaProxy.fetch(
      proxyRequest("https://r1.googlevideo.com/videoplayback?itag=137"),
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
