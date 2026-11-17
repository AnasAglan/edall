"use strict";

/*
 * ED-ALL PWA cache policy:
 * Only the public application shell is cacheable.
 * Auth, REST, Storage, Functions, private lesson content, signed URLs,
 * query-string pages, cross-origin resources and all media are network-only.
 */
const CACHE_NAME = "edall-public-shell-v1";
const PUBLIC_SHELL = [
  "/",
  "/ed_master.html",
  "/ed_features.js",
  "/ed_features.css",
  "/ed-pwa.js",
  "/manifest.webmanifest",
  "/favicon.ico"
];
const NETWORK_ONLY_PATHS = [
  "/auth/v1/",
  "/rest/v1/",
  "/storage/v1/",
  "/functions/v1/",
  "/realtime/v1/"
];
const MEDIA_EXTENSIONS = /\.(?:mp4|m3u8|mpd|ts|m4s|webm|mov|mp3|m4a|aac|vtt|srt|pdf)$/i;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PUBLIC_SHELL.map(async path => {
      try {
        const response = await fetch(new Request(path, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-EDALL-Public-Shell": "1" }
        }));
        if (response.ok && response.type === "basic" && !response.headers.has("Set-Cookie")) {
          await cache.put(path, response);
        }
      } catch (_) {
        // Offline installation is still allowed; the shell will populate on next visit.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith("edall-public-shell-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isPublicShell(url) {
  return url.origin === self.location.origin && PUBLIC_SHELL.includes(url.pathname);
}

function isNetworkOnly(url, request) {
  return request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search.length > 0 ||
    NETWORK_ONLY_PATHS.some(path => url.pathname.includes(path)) ||
    MEDIA_EXTENSIONS.test(url.pathname) ||
    request.headers.has("Authorization") ||
    request.headers.has("Range") ||
    request.cache === "no-store";
}

async function cacheableResponse(response, expectedType) {
  if (!response || !response.ok || response.type !== "basic" || response.headers.has("Set-Cookie")) return false;
  const control = (response.headers.get("Cache-Control") || "").toLowerCase();
  if (control.includes("no-store") || control.includes("private")) return false;
  const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
  if (expectedType === "document") return contentType.includes("text/html");
  if (expectedType === "script") return contentType.includes("javascript") || contentType.includes("ecmascript") || contentType.includes("text/plain");
  if (expectedType === "style") return contentType.includes("text/css");
  if (expectedType === "manifest") return contentType.includes("json");
  return true;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (isNetworkOnly(url, request)) {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }

  if (!isPublicShell(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.pathname);
    const expectedType = url.pathname.endsWith(".js") ? "script" :
      url.pathname.endsWith(".css") ? "style" :
      url.pathname.endsWith(".webmanifest") ? "manifest" :
      (url.pathname === "/" || url.pathname.endsWith(".html")) ? "document" : "other";

    if (expectedType !== "document" && cached) return cached;

    try {
      const response = await fetch(new Request(request, { cache: "no-store" }));
      if (await cacheableResponse(response, expectedType)) {
        await cache.put(url.pathname, response.clone());
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
