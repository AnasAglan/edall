import {
  edallCorsHeaders,
  getEdallAppOrigins,
  isAllowedEdallOrigin,
} from "./app-origin.ts";

const STAGING_BACKEND = "https://c--4d956767-2768-416c-981b-79ff624686eb-prod.lovable.cloud";
const STAGING_APP = "https://id-preview--c65d2fd9-1c85-479f-9347-d54b6341e6a7.lovable.app";
const PRODUCTION_BACKEND = "https://iuaddjoofgrirzslzqfy.supabase.co";
const PRODUCTION_APP = "https://edall.lovable.app";
const PRODUCTION_PREVIEW = "https://id-preview--41c4997e-3169-4ff8-bf15-3da064df3594.lovable.app";

Deno.test("Staging backend accepts only the Staging app origin", () => {
  if (!isAllowedEdallOrigin(STAGING_APP, STAGING_BACKEND)) throw new Error("Staging origin should be allowed");
  if (isAllowedEdallOrigin(PRODUCTION_APP, STAGING_BACKEND)) throw new Error("Production origin must not reach Staging");
});

Deno.test("Production backend accepts only Production app origins", () => {
  if (!isAllowedEdallOrigin(PRODUCTION_APP, PRODUCTION_BACKEND)) throw new Error("Production origin should be allowed");
  if (!isAllowedEdallOrigin(PRODUCTION_PREVIEW, PRODUCTION_BACKEND)) throw new Error("Production preview origin should be allowed");
  if (isAllowedEdallOrigin(STAGING_APP, PRODUCTION_BACKEND)) throw new Error("Staging origin must not reach Production");
});

Deno.test("unknown backend fails closed for browser origins", () => {
  if (getEdallAppOrigins("https://unknown.example").length) throw new Error("Unknown backend got app origins");
  if (isAllowedEdallOrigin(STAGING_APP, "https://unknown.example")) throw new Error("Unknown backend accepted Staging");
  if (isAllowedEdallOrigin(PRODUCTION_APP, "https://unknown.example")) throw new Error("Unknown backend accepted Production");
});

Deno.test("CORS headers are emitted only for the matching backend and origin", () => {
  const allowed = edallCorsHeaders(STAGING_APP, STAGING_BACKEND);
  if (allowed["Access-Control-Allow-Origin"] !== STAGING_APP) throw new Error("Missing Staging CORS origin");
  const denied = edallCorsHeaders(PRODUCTION_APP, STAGING_BACKEND);
  if ("Access-Control-Allow-Origin" in denied) throw new Error("Cross-environment CORS header was emitted");
});
