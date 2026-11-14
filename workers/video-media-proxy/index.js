const ALLOWED_ORIGINS = new Set(["https://edall.lovable.app", "https://id-preview--41c4997e-3169-4ff8-bf15-3da064df3594.lovable.app"]);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
  "Vary": "Origin",
};

function isGoogleVideoHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "googlevideo.com" || host.endsWith(".googlevideo.com");
}

function getAllowedMediaUrl(raw) {
  const upstream = new URL(String(raw || ""));
  if (upstream.protocol !== "https:" ||
      !isGoogleVideoHost(upstream.hostname) ||
      upstream.username || upstream.password || upstream.port ||
      upstream.pathname !== "/videoplayback") {
    throw new Error("Only HTTPS GoogleVideo /videoplayback URLs are allowed.");
  }
  return upstream;
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const responseCorsHeaders = new Headers(corsHeaders);
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Origin not allowed", { status: 403, headers: responseCorsHeaders });
    }
    if (origin) responseCorsHeaders.set("Access-Control-Allow-Origin", origin);
    if (requestUrl.pathname === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "edall-video-media-proxy" }), {
        status: 200, headers: { ...Object.fromEntries(responseCorsHeaders), "Content-Type": "application/json" }
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseCorsHeaders });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: responseCorsHeaders });
    }

    let upstreamUrl;
    try {
      if (requestUrl.pathname === "/media") {
        upstreamUrl = getAllowedMediaUrl(requestUrl.searchParams.get("url"));
      } else if (requestUrl.pathname === "/videoplayback") {
        const host = requestUrl.searchParams.get("host") || "";
        if (!isGoogleVideoHost(host)) {
          return new Response("Upstream host is not allowed", { status: 403, headers: responseCorsHeaders });
        }
        upstreamUrl = getAllowedMediaUrl("https://" + host + "/videoplayback");
        for (const [key, value] of requestUrl.searchParams) {
          if (key !== "host" && key !== "range") upstreamUrl.searchParams.append(key, value);
        }
      } else {
        return new Response("Not found", { status: 404, headers: responseCorsHeaders });
      }
    } catch (error) {
      return new Response(String(error && error.message || "Invalid media URL"), {
        status: 403,
        headers: responseCorsHeaders,
      });
    }

    const headers = new Headers({ Accept: "*/*" });
    const range = request.headers.get("Range") || requestUrl.searchParams.get("range");
    if (range && /^bytes=\d+-\d*$/.test(range)) headers.set("Range", range);

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers,
        redirect: "follow",
        cache: "no-store",
      });
    } catch {
      return new Response("The upstream video server could not be reached.", {
        status: 502,
        headers: responseCorsHeaders,
      });
    }

    let finalUrl;
    try {
      finalUrl = new URL(upstream.url || upstreamUrl.toString());
    } catch {
      return new Response("Invalid upstream response.", { status: 502, headers: responseCorsHeaders });
    }
    if (!isGoogleVideoHost(finalUrl.hostname)) {
      return new Response("The upstream redirected to a non-GoogleVideo host.", {
        status: 502,
        headers: responseCorsHeaders,
      });
    }

    const responseHeaders = new Headers(responseCorsHeaders);
    for (const name of ["accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "private, no-store");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
