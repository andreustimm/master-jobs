// Persistent storage is public-by-admission. Application responses are never
// candidates, so privacy does not depend on logout or a later cleanup action.
const CACHE_VERSION = "__APP_VERSION__";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([STATIC_CACHE, SHELL_CACHE]);

const OFFLINE_DOCUMENT = "/offline.html";
const PRECACHE_STATIC = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

// Documentation as well as defence in depth. Unknown paths are denied by the
// positive admission rules below even when they are absent from this list.
const NEVER_CACHE = [
  "/api/",
  "/admin/",
  "/candidate",
  "/pipeline",
  "/referrals",
  "/compare",
  "/p/",
  "/jobs",
  "/applications",
  "/salary",
  "/resume",
  "/cv",
  "/login",
];

const ROUTER_REQUEST_HEADERS = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-url",
];

function asUrl(value) {
  if (value instanceof URL) return value;
  const candidate = typeof value === "string" ? value : value.url;
  return new URL(candidate, self.location.origin);
}

function isCacheableStatic(value) {
  const url = asUrl(value);
  if (url.origin !== self.location.origin || url.search || url.hash) return false;
  return PRECACHE_STATIC.includes(url.pathname) || url.pathname.startsWith("/_next/static/");
}

function isNeverCached(value) {
  const url = asUrl(value);
  return NEVER_CACHE.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix));
}

function isRouterRequest(request) {
  const url = asUrl(request);
  return ROUTER_REQUEST_HEADERS.some((header) => request.headers.has(header))
    || url.searchParams.has("_rsc");
}

function documentNavigationRequest(request) {
  const url = new URL(asUrl(request).href);
  url.searchParams.delete("_rsc");
  const headers = new Headers(request.headers);
  for (const header of ROUTER_REQUEST_HEADERS) headers.delete(header);
  headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  return new Request(url.href, {
    method: "GET",
    headers,
    credentials: request.credentials || "include",
    redirect: request.redirect || "follow",
  });
}

function navigationTarget(value) {
  const url = new URL(asUrl(value).href);
  url.searchParams.delete("_rsc");
  return `${url.pathname}${url.search}`;
}

function isRouterPayloadResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const vary = response.headers.get("vary") ?? "";
  return contentType.toLowerCase().includes("text/x-component")
    || /(?:^|,)\s*(?:rsc|next-router-state-tree|next-router-prefetch|next-url)\s*(?:,|$)/i.test(vary);
}

function isAdmissibleResponse(response, expectedType) {
  if (!response.ok || response.redirected || response.type === "opaqueredirect") return false;
  if (isRouterPayloadResponse(response)) return false;
  if (expectedType === "html") {
    return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
  }
  return true;
}

function publicRequest(value) {
  const url = asUrl(value);
  return new Request(url.href, { method: "GET", credentials: "omit", cache: "reload" });
}

async function installOne(path, cacheName, expectedType) {
  const request = publicRequest(path);
  const response = await fetch(request);
  if (!isAdmissibleResponse(response, expectedType)) return false;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await Promise.allSettled([
      installOne(OFFLINE_DOCUMENT, SHELL_CACHE, "html"),
      ...PRECACHE_STATIC.map((path) => installOne(path, STATIC_CACHE, "static")),
    ]);
    try {
      await self.skipWaiting();
    } catch {
      // Registration is progressive enhancement; online operation remains valid.
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)));
    } catch {
      // Refused storage cannot prevent this worker from serving the network.
    }
    try {
      await self.clients.claim();
    } catch {
      // A later online navigation can still register or update the worker.
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = asUrl(request);
  if (url.origin !== self.location.origin) return;

  // A document reload is HTML even if Chromium preserves App Router headers
  // from the screen that initiated it. Classifying RSC first would return a
  // text/x-component payload as the top-level document after a 403/404.
  if (request.mode === "navigate") {
    event.respondWith(networkOnlyNavigation(request));
    return;
  }

  if (isRouterRequest(request)) {
    event.respondWith(networkOnlyRouter(event, request));
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(cacheFirstPublic(request, STATIC_CACHE, "static"));
    return;
  }

  if (url.pathname === OFFLINE_DOCUMENT) {
    event.respondWith(cacheFirstPublic(request, SHELL_CACHE, "html"));
    return;
  }

  // Explicit private prefixes and every unknown non-navigation request fall
  // through to the browser network without touching Cache Storage.
  if (isNeverCached(url)) return;
});

async function cacheFirstPublic(request, cacheName, expectedType) {
  const safeRequest = publicRequest(request);
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(safeRequest);
    if (cached && isAdmissibleResponse(cached, expectedType)) return cached;
  } catch {
    // Continue with a credentialless network request when storage is refused.
  }

  const response = await fetch(safeRequest);
  if (isAdmissibleResponse(response, expectedType)) {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(safeRequest, response.clone());
    } catch {
      // The public response remains usable online even when it cannot persist.
    }
  }
  return response;
}

async function notifyInitiatingClient(event, request) {
  if (!event.clientId) return;
  try {
    const client = await self.clients.get(event.clientId);
    if (!client) return;
    client.postMessage({ type: "navigation-offline", url: navigationTarget(request) });
  } catch {
    // Notification failure must not turn a rejected route request into success.
  }
}

async function networkOnlyRouter(event, request) {
  try {
    return await fetch(request);
  } catch (error) {
    await notifyInitiatingClient(event, request);
    throw error;
  }
}

async function networkOnlyNavigation(request) {
  try {
    return await fetch(documentNavigationRequest(request));
  } catch {
    return offlineResponse();
  }
}

async function offlineResponse() {
  try {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(publicRequest(OFFLINE_DOCUMENT));
    if (cached && isAdmissibleResponse(cached, "html")) return cached;
  } catch {
    // The last-resort response carries no route, session, or user content.
  }
  return new Response("Offline.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "clear-private-caches") return;

  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)));
    } catch {
      // Current caches contain only public resources; cleanup is not a privacy boundary.
    }
    event.source?.postMessage({ type: "private-caches-cleared" });
  })());
});
