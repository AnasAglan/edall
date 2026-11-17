const STAGING_BACKEND_URLS = new Set([
  "https://c--4d956767-2768-416c-981b-79ff624686eb-prod.lovable.cloud",
  "https://atpltvpwfammcnxcpvop.supabase.co",
]);
const PRODUCTION_BACKEND_URLS = new Set([
  "https://iuaddjoofgrirzslzqfy.supabase.co",
]);

const STAGING_APP_ORIGINS = [
  "https://id-preview--c65d2fd9-1c85-479f-9347-d54b6341e6a7.lovable.app",
];
const PRODUCTION_APP_ORIGINS = [
  "https://edall.lovable.app",
  "https://id-preview--41c4997e-3169-4ff8-bf15-3da064df3594.lovable.app",
];

function normalizeBackendUrl(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

/** Resolve only the app origins belonging to the backend running this function. */
export function getEdallAppOrigins(supabaseUrl: string | null | undefined): string[] {
  const backend = normalizeBackendUrl(supabaseUrl);
  if (STAGING_BACKEND_URLS.has(backend)) return [...STAGING_APP_ORIGINS];
  if (PRODUCTION_BACKEND_URLS.has(backend)) return [...PRODUCTION_APP_ORIGINS];
  return [];
}

/** Server-to-server requests may omit Origin; browser requests must match this backend. */
export function isAllowedEdallOrigin(
  origin: string | null,
  supabaseUrl: string | null | undefined,
): boolean {
  if (!origin) return true;
  return getEdallAppOrigins(supabaseUrl).includes(origin);
}

export function edallCorsHeaders(
  origin: string | null,
  supabaseUrl: string | null | undefined,
): Record<string, string> {
  const allowed = getEdallAppOrigins(supabaseUrl);
  return {
    ...(origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
