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
  it("preserves the production origin default", async () => {
    const res = await extractor.fetch(new Request("https://extractor.example/", { method: "OPTIONS", headers: { Origin: "https://edall.lovable.app" } }));
    expect(res.status).toBe(204); expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://edall.lovable.app");
  });
});
