import { loadEnv } from "vite";

export const STAGING_PROJECT_REF = "atpltvpwfammcnxcpvop";
export const STAGING_ASSISTANT_URL = "https://edall-assistant-staging.anasaglan2011.workers.dev";
// This project's managed sandbox uses this exact Cloud proxy, not the direct
// hosted URL. Never accept arbitrary *.lovable.cloud or *.supabase.co hosts.
export const STAGING_BACKEND_ORIGINS = [
  "https://c--4d956767-2768-416c-981b-79ff624686eb-prod.lovable.cloud"
];

// Opaque publishable keys have no decodable project ref. Legacy anon JWTs do.
export function validateStagingConfig(env) {
  const ref = env.VITE_SUPABASE_PROJECT_ID;
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (ref !== STAGING_PROJECT_REF || !STAGING_BACKEND_ORIGINS.includes(url) || typeof key !== "string" || !key) {
    throw new Error("Staging configuration error: this project's backend URL, project ID and publishable key are required.");
  }
  if (!key.startsWith("sb_publishable_")) {
    let payload;
    try { payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch {}
    if (payload?.ref !== ref || payload?.role !== "anon") {
      throw new Error("Staging configuration error: the anon key must belong to this project.");
    }
  } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("Staging configuration error: invalid publishable key.");
  }
  return { projectId: ref, supabaseUrl: url, supabasePublishableKey: key, assistantUrl: STAGING_ASSISTANT_URL };
}

export function renderStagingConfig(env) {
  const config = validateStagingConfig(env);
  return `window.ED_STAGING_CONFIG = Object.freeze(${JSON.stringify(config).replace(/</g, "\\u003c")});\n`;
}

// public/ HTML is copied verbatim by Vite: serve the same blocking config asset
// in development and emit it into the final build, never into source control.
export function stagingConfigPlugin(envOverride) {
  let configSource;
  return {
    name: "edall-staging-config",
    configResolved(config) {
      configSource = renderStagingConfig(envOverride || loadEnv(config.mode, config.envDir, "VITE_"));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/ed-staging-config.js") return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(configSource);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "ed-staging-config.js", source: configSource });
    }
  };
}