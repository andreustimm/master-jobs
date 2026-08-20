// ─── Arquitetura de cache ───────────────────────────────────────
//
// Desenho replicado do `contas_casal` — caches versionados por tipo de
// recurso, estratégia por tipo, limpeza das versões antigas no `activate` — com
// UMA diferença deliberada, e ela é a decisão central deste arquivo.
//
//   static-vX  → JS, CSS, fontes, ícones, manifest   (Cache First)
//   shell-vX   → /login e /offline                    (Network First)
//
// **Não existe `pages-` nem `api-` aqui, e a ausência é a política.**
//
// O `contas_casal` cacheia página autenticada e resposta de API porque tem a
// contrapartida: uma fronteira de sessão offline que, no logout, apaga Dexie,
// Cache Storage privado, fila de uploads e outbox como uma operação observável,
// e recusa renderizar a próxima conta se qualquer etapa falhar. Copiar o cache
// sem copiar essa máquina seria copiar o risco sem a mitigação.
//
// Neste sistema tudo o que está atrás de sessão é privado — currículo, funil,
// candidaturas, contatos — e o disco sobrevive à sessão. Uma página do
// candidato gravada em cache continua legível depois do logout, para quem tiver
// o aparelho. O ganho seria abrir uma tela que já se abre rápido; o custo é o
// dado que este projeto inteiro existe para proteger.
//
// O que a PWA entrega aqui, então: instala como app, abre em tela cheia, e o
// shell estático carrega instantaneamente. Offline de verdade exigiria o dado
// local, e o dado mora em SQLite no servidor.
// ────────────────────────────────────────────────────────────────

const CACHE_VERSION = "__APP_VERSION__";

const STATIC_CACHE = `static-${CACHE_VERSION}`;
const SHELL_CACHE = `shell-${CACHE_VERSION}`;

const CURRENT_CACHES = new Set([STATIC_CACHE, SHELL_CACHE]);

/** Só o que não é de ninguém. */
const PRECACHE_SHELL = ["/offline", "/login"];

const PRECACHE_STATIC = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

/**
 * Nunca tocado pelo cache, em nenhuma circunstância.
 *
 * Lista de EXCLUSÃO explícita além do padrão de negar, porque as duas falham de
 * modos diferentes: o padrão protege o que ninguém previu, e a lista documenta
 * o que já se sabe ser sensível. `/p/` está aqui apesar de público — o perfil é
 * público por escolha do candidato, e essa escolha pode ser revogada; uma cópia
 * em disco não obedeceria à revogação.
 */
const NEVER_CACHE = ["/api/", "/admin/", "/candidate", "/pipeline", "/referrals", "/compare", "/p/"];

const STATIC_EXTENSIONS = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico|json)$/i;

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || STATIC_EXTENSIONS.test(url.pathname);
}

function isShell(url) {
  return PRECACHE_SHELL.includes(url.pathname);
}

function isNeverCached(url) {
  return NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const [shell, statics] = await Promise.all([
        caches.open(SHELL_CACHE),
        caches.open(STATIC_CACHE),
      ]);
      // `allSettled`: uma rota do shell que ainda não existe no deploy não pode
      // impedir a instalação inteira e deixar o app sem service worker nenhum.
      await Promise.allSettled([shell.addAll(PRECACHE_SHELL), statics.addAll(PRECACHE_STATIC)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só GET. Uma mutação servida do cache seria uma escrita que não aconteceu
  // sendo reportada como se tivesse acontecido.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Origem diferente não passa por aqui: cachear terceiro é assumir a política
  // de cache dele.
  if (url.origin !== self.location.origin) return;

  if (isNeverCached(url)) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isShell(url)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Navegação autenticada: rede, e só rede. Sem fallback stale — servir uma
  // tela antiga com dado de sessão encerrada é pior que dizer que está offline.
  if (request.mode === "navigate") {
    event.respondWith(networkOnlyWithOfflinePage(request));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && !isRedirectToLogin(response)) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

async function networkOnlyWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

/**
 * Uma resposta que redirecionou para o login não pode ser gravada.
 *
 * Sem esta checagem, perder a sessão enquanto o shell é aquecido guardaria a
 * tela de login sob a URL de outra rota — e a próxima visita offline mostraria
 * "entre" onde deveria mostrar a página.
 */
function isRedirectToLogin(response) {
  return response.redirected && new URL(response.url).pathname.startsWith("/login");
}

async function offlineResponse() {
  const cached = await caches.match("/offline");
  if (cached) return cached;
  return new Response("Sem conexão.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Limpeza no logout, pedida pela aplicação.
 *
 * Os estáticos ficam: são públicos e é o que permite o shell abrir na próxima
 * vez. Tudo o mais some. A resposta confirma a conclusão para quem pediu poder
 * esperar antes de trocar de identidade.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "clear-private-caches") return;

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)));
      event.source?.postMessage({ type: "private-caches-cleared" });
    })(),
  );
});
