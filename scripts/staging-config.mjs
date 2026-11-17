import { loadEnv } from "vite";

export const STAGING_PROJECT_REF = "atpltvpwfammcnxcpvop";
export const PRODUCTION_PROJECT_REF = "iuaddjoofgrirzslzqfy";

export const STAGING_BACKEND_ORIGINS = [
  "https://c--4d956767-2768-416c-981b-79ff624686eb-prod.lovable.cloud"
];
export const PRODUCTION_BACKEND_ORIGINS = [
  "https://iuaddjoofgrirzslzqfy.supabase.co"
];

export const STAGING_ASSISTANT_URL = "https://edall-assistant-staging.anasaglan2011.workers.dev";
export const STAGING_EXTRACTOR_URL = "https://edall-invidious-extractor-staging.anasaglan2011.workers.dev";
export const STAGING_MEDIA_PROXY_URL = "https://edall-video-media-proxy-staging.anasaglan2011.workers.dev";

export const PRODUCTION_ASSISTANT_URL = "https://edall-assistant.anasaglan2011.workers.dev";
export const PRODUCTION_EXTRACTOR_URL = "https://edall-invidious-extractor.anasaglan2011.workers.dev";
export const PRODUCTION_MEDIA_PROXY_URL = "https://edall-video-media-proxy.anasaglan2011.workers.dev";

const ENVIRONMENTS = [
  {
    environment: "staging",
    projectId: STAGING_PROJECT_REF,
    backendOrigins: STAGING_BACKEND_ORIGINS,
    assistantUrl: STAGING_ASSISTANT_URL,
    extractorUrl: STAGING_EXTRACTOR_URL,
    mediaProxyUrl: STAGING_MEDIA_PROXY_URL
  },
  {
    environment: "production",
    projectId: PRODUCTION_PROJECT_REF,
    backendOrigins: PRODUCTION_BACKEND_ORIGINS,
    assistantUrl: PRODUCTION_ASSISTANT_URL,
    extractorUrl: PRODUCTION_EXTRACTOR_URL,
    mediaProxyUrl: PRODUCTION_MEDIA_PROXY_URL
  }
];

function validatePublishableKey(key, projectId) {
  if (typeof key !== "string" || !key.trim()) return false;
  if (key.startsWith("sb_publishable_")) return /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  let payload;
  try {
    const part = key.split(".")[1];
    if (!part) return false;
    payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {}
  return payload?.ref === projectId && payload?.role === "anon";
}

export function validateAppConfig(env) {
  const ref = env.VITE_SUPABASE_PROJECT_ID;
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const target = ENVIRONMENTS.find(item => item.projectId === ref && item.backendOrigins.includes(url));
  if (!target || !validatePublishableKey(key, ref)) {
    throw new Error("ED-ALL app configuration error: the project ID, backend URL and publishable key must match one approved environment.");
  }
  return {
    environment: target.environment,
    projectId: ref,
    supabaseUrl: url,
    supabasePublishableKey: key,
    assistantUrl: target.assistantUrl,
    extractorUrl: target.extractorUrl,
    mediaProxyUrl: target.mediaProxyUrl
  };
}

export function validateStagingConfig(env) {
  let config;
  try {
    config = validateAppConfig(env);
  } catch {
    throw new Error("Staging configuration error: the project ID, backend URL and publishable key must match the Staging project.");
  }
  if (config.environment !== "staging") {
    throw new Error("Staging configuration error: production credentials are not accepted by the Staging build.");
  }
  return config;
}

export function validateProductionConfig(env) {
  const config = validateAppConfig(env);
  if (config.environment !== "production") {
    throw new Error("Production configuration error: Staging credentials are not accepted by the production build.");
  }
  return config;
}

export function renderAppConfig(env) {
  const config = validateAppConfig(env);
  return `window.ED_APP_CONFIG = Object.freeze(${JSON.stringify(config).replace(/</g, "\\u003c")});\\n`;
}

export function renderStagingConfig(env) {
  const config = validateStagingConfig(env);
  return `window.ED_APP_CONFIG = Object.freeze(${JSON.stringify(config).replace(/</g, "\\u003c")});\\n`;
}

// public/ HTML is copied verbatim by Vite. Emit a per-project public config
// asset so each Lovable project uses only its own approved backend and Workers.
export function appConfigPlugin(envOverride) {
  let configSource;
  return {
    name: "edall-app-config",
    configResolved(config) {
      configSource = renderAppConfig(envOverride || loadEnv(config.mode, config.envDir, "VITE_"));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/ed-app-config.js") return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(configSource);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "ed-app-config.js", source: configSource });
    }
  };
}

// Kept as a compatibility export for existing staging-only tests/callers.
export const stagingConfigPlugin = appConfigPlugin;
