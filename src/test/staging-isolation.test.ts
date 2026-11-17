// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderStagingConfig, validateStagingConfig, stagingConfigPlugin } from "../../scripts/staging-config.mjs";
import worker, { resolveAssistantRedirectOrigin } from "../../workers/edall-assistant/index.js";

const ref = "atpltvpwfammcnxcpvop";
const origin = "https://id-preview--c65d2fd9-1c85-479f-9347-d54b6341e6a7.lovable.app";
const productionRef = "iuaddjoofgrirzslzqfy";
const stagingUrl = "https://c--4d956767-2768-416c-981b-79ff624686eb-prod.lovable.cloud";
const config = { VITE_SUPABASE_PROJECT_ID: ref, VITE_SUPABASE_URL: stagingUrl, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" };
const env = { EDALL_ENV: "staging", SUPABASE_PROJECT_ID: ref, SUPABASE_URL: config.VITE_SUPABASE_URL, STAGING_SUPABASE_PUBLISHABLE_KEY: config.VITE_SUPABASE_PUBLISHABLE_KEY };
const request = (requestOrigin = origin, method = "POST") => new Request("https://assistant.example/", {
  method, headers: { Origin: requestOrigin, Authorization: "Bearer fixture" }
});

describe("Staging isolation", () => {
  it("keeps password reset redirects inside the matching environment", () => {
    expect(resolveAssistantRedirectOrigin(true)).toBe(origin);
    expect(resolveAssistantRedirectOrigin(false)).toBe("https://edall.lovable.app");
  });


  it("removes production refs, URLs, endpoints and embedded JWT keys from scoped source", () => {
    for (const file of ["public/ed_master.html", "public/ed_assistant.js", "wrangler.assistant.staging.toml", "wrangler.staging.toml", "workers/video-media-proxy/wrangler.staging.toml", "scripts/staging-config.mjs", "scripts/deploy-edall-assistant-staging.mjs"]) {
      const source = readFileSync(file, "utf8");
      expect(source.includes(productionRef), file).toBe(false);
      expect(source.includes("https://edall-assistant.anasaglan2011.workers.dev"), file).toBe(false);
      expect(source.includes("https://edall.lovable.app"), file).toBe(false);
      expect(source.includes("https://edall-invidious-extractor.anasaglan2011.workers.dev"), file).toBe(false);
      expect(source.includes("https://edall-video-media-proxy.anasaglan2011.workers.dev"), file).toBe(false);
      expect(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(source), file).toBe(false);
    }
  });

  it.each(Object.keys(config))("fails closed when %s is missing", name => {
    expect(() => validateStagingConfig({ ...config, [name]: "" })).toThrow(/Staging configuration error/);
  });

  it("rejects production and other project config without including keys in errors", () => {
    for (const invalidRef of [productionRef, "other-project"]) {
      expect(() => validateStagingConfig({ ...config, VITE_SUPABASE_PROJECT_ID: invalidRef, VITE_SUPABASE_URL: `https://${invalidRef}.supabase.co` })).toThrow(/Staging configuration error/);
    }
  });

  it("validates legacy JWT project ref and rejects privileged keys", () => {
    const jwt = (project: string, role = "anon") => `fixture.${btoa(JSON.stringify({ ref: project, role }))}.fixture`;
    expect(validateStagingConfig({ ...config, VITE_SUPABASE_PUBLISHABLE_KEY: jwt(ref) }).projectId).toBe(ref);
    expect(() => validateStagingConfig({ ...config, VITE_SUPABASE_PUBLISHABLE_KEY: jwt(productionRef) })).toThrow();
    expect(() => validateStagingConfig({ ...config, VITE_SUPABASE_PUBLISHABLE_KEY: jwt(ref, "service_role") })).toThrow();
  });

  it("emits the same public config asset in dev and builds without transforming public HTML", () => {
    const plugin = stagingConfigPlugin(config);
    plugin.configResolved({ mode: "development", envDir: process.cwd() });
    let middleware: Function = () => {};
    plugin.configureServer({ middlewares: { use: (handler: Function) => { middleware = handler; } } });
    let served = "";
    middleware({ url: "/ed-staging-config.js" }, { setHeader() {}, end(value: string) { served = value; } }, () => { throw new Error("config not served"); });
    let emitted: any;
    plugin.generateBundle.call({ emitFile(asset: any) { emitted = asset; } });
    expect(emitted.fileName).toBe("ed-staging-config.js");
    expect(emitted.source === served).toBe(true);
    expect(served.includes(`"projectId":"${ref}"`)).toBe(true);
    expect(served.includes(stagingUrl)).toBe(true);
    expect(served.includes("iuaddjoofgrirzslzqfy")).toBe(false);
    expect(renderStagingConfig(config).includes('"assistantUrl":"https://edall-assistant-staging.anasaglan2011.workers.dev"')).toBe(true);
  });

  it("missing backend config produces 503 with no upstream calls, including health", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      for (const invalid of [{}, { ...env, SUPABASE_URL: "" }, { ...env, STAGING_SUPABASE_PUBLISHABLE_KEY: "" }, { ...env, SUPABASE_PROJECT_ID: "" }, { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ignored" }]) {
        expect((await worker.fetch(request(), invalid)).status).toBe(503);
        expect((await worker.fetch(new Request("https://assistant.example/health"), invalid)).status).toBe(503);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects a production backend or mismatched legacy key without upstream calls", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const foreignKey = `fixture.${btoa(JSON.stringify({ ref: productionRef, role: "anon" }))}.fixture`;
      for (const invalid of [{ ...env, SUPABASE_URL: `https://${productionRef}.supabase.co` }, { ...env, STAGING_SUPABASE_PUBLISHABLE_KEY: foreignKey }]) {
        expect((await worker.fetch(request(), invalid)).status).toBe(503);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("denies both production origins on POST and preflight", async () => {
    for (const denied of ["https://edall.lovable.app", "https://id-preview--41c4997e-3169-4ff8-bf15-3da064df3594.lovable.app"]) {
      for (const method of ["POST", "OPTIONS"]) {
        const res = await worker.fetch(request(denied, method), env);
        expect(res.status).toBe(403);
        expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
      }
    }
    const allowed = await worker.fetch(request(origin, "OPTIONS"), env);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it("rejects students before models, rate limits or writes", async () => {
    const calls: string[] = [];
    const model = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init: RequestInit) => {
      calls.push(String(input));
      expect(init.method ?? "GET").toBe("GET");
      if (String(input).endsWith("/auth/v1/user")) return Response.json({ id: "fixture-user" });
      if (String(input).includes("/rest/v1/user_roles")) return Response.json([{ role: "student" }]);
      throw new Error("Unexpected upstream call");
    }));
    try {
      const res = await worker.fetch(request(), { ...env, AI: { run: model } });
      expect(res.status).toBe(403);
      expect(calls.length).toBe(2);
      expect(calls.every(url => url.startsWith(env.SUPABASE_URL))).toBe(true);
      expect(calls.every(url => !url.includes(productionRef))).toBe(true);
      expect(model).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});