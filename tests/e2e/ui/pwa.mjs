// Área `pwa` do E2E de navegador: PWA: instalação, offline e cache sem dado privado.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { privateMarkersOf, ptBR } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check } = ctx;
  const privateMarkers = privateMarkersOf(ctx);
  /* ------------------------------ PWA (UI-05) ------------------------------ */
  // O que a instalação exige precisa responder SEM sessão: um manifest atrás de
  // login não é lido por navegador nenhum, e o app simplesmente não oferece
  // instalar — sem erro, sem aviso.
  const pwaCtx = await browser.newContext();
  const pwaPage = await pwaCtx.newPage();

  const missing = [];
  const installIcons = [
    { src: "/icons/icon-192.png", width: 192, height: 192 },
    { src: "/icons/icon-512.png", width: 512, height: 512 },
    { src: "/icons/icon-maskable-512.png", width: 512, height: 512 },
  ];
  for (const path of ["/manifest.json", "/sw.js", ...installIcons.map(({ src }) => src), "/offline.html"]) {
    const hit = await pwaPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    if (hit?.status() !== 200) missing.push(`${path}=${hit?.status()}`);
  }
  check("recursos da PWA respondem sem sessão", missing.length === 0, missing.join(" | "));

  const decodedIcons = await pwaPage.evaluate(async (icons) => Promise.all(icons.map(async (icon) => {
    const image = new Image();
    image.src = icon.src;
    try {
      await image.decode();
      return { ...icon, decoded: true, actualWidth: image.naturalWidth, actualHeight: image.naturalHeight };
    } catch {
      return { ...icon, decoded: false, actualWidth: image.naturalWidth, actualHeight: image.naturalHeight };
    }
  })), installIcons);
  check(
    "ícones declarados da PWA decodificam nas dimensões exigidas",
    decodedIcons.every(({ decoded, width, height, actualWidth, actualHeight }) =>
      decoded && actualWidth === width && actualHeight === height
    ),
    JSON.stringify(decodedIcons),
  );

  await pwaPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const head = await pwaPage.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
    themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("media")),
  }));
  check("a página aponta para o manifest", head.manifest === "/manifest.json", `${head.manifest}`);
  // Duas cores porque o sistema tem tema claro e escuro; uma só deixaria a
  // barra do navegador escura sobre interface clara.
  check(
    "theme-color acompanha claro e escuro",
    head.themes.length === 2 && head.themes.every((m) => m?.includes("prefers-color-scheme")),
    head.themes.join(" | "),
  );

  // O service worker servido tem de trazer a VERSÃO, não o marcador. Com o
  // marcador literal todo cache se chamaria `static-__APP_VERSION__` e nenhum
  // deploy invalidaria coisa alguma.
  const swBody = await (await pwaPage.request.get(`${BASE}/sw.js`)).text();
  check(
    "o service worker servido traz a versão resolvida",
    !swBody.includes("__APP_VERSION__") && /CACHE_VERSION = "\d/.test(swBody),
    swBody.match(/CACHE_VERSION = "[^"]*"/)?.[0] ?? "ausente",
  );
  // E não guarda rota privada. A lista vive no template; aqui se confere que o
  // que foi servido é o que se pensa que foi.
  check(
    "o service worker servido exclui as rotas privadas",
    ["/api/", "/candidate", "/pipeline", "/p/"].every((p) => swBody.includes(`"${p}"`)),
  );

  await pwaPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await pwaPage.reload({ waitUntil: "networkidle" });
  await pwaPage.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Use an authenticated controlled document for the soft-navigation journey.
  await pwaPage.fill('input[name="email"]', E2E_EMAIL);
  await pwaPage.fill('input[name="password"]', E2E_PASSWORD);
  await pwaPage.locator('[data-testid="login-submit"]').click();
  await pwaPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await pwaPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });

  let freshDocumentRequests = 0;
  const targetPath = "/transition-test?delay=prolonged";
  const countFreshDocument = (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "document" && `${url.pathname}${url.search}` === targetPath) {
      freshDocumentRequests += 1;
    }
  };
  pwaPage.on("request", countFreshDocument);
  await pwaPage.evaluate((target) => {
    const router = window.next?.router;
    if (!router?.push) throw new Error("App Router client instance unavailable");
    router.push(target);
  }, targetPath);
  const pwaTransition = pwaPage.locator('[data-testid="navigation-transition"]');
  await pwaTransition.waitFor({ state: "attached" });
  await pwaCtx.setOffline(true);
  await pwaPage.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
  );
  const softOfflineCopy = await pwaTransition.textContent();
  await pwaCtx.setOffline(false);
  await pwaPage.locator('[data-testid="navigation-transition-retry"]').evaluate((button) => {
    button.click();
    button.click();
  });
  await pwaPage.waitForURL((url) => `${url.pathname}${url.search}` === targetPath);
  await pwaPage.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  pwaPage.off("request", countFreshDocument);
  check(
    "offline E2E-010 soft failure mostra uma fase e retry faz uma navegação fresca",
    softOfflineCopy?.includes(ptBR.transition.offlineTitle) === true
      && softOfflineCopy?.includes(ptBR.transition.offlineBody) === true
      && freshDocumentRequests === 1,
    `documents=${freshDocumentRequests} · ${softOfflineCopy}`,
  );

  const offlineAttempts = ["/jobs", "/p/e2e-revoked-profile", "/pipeline?history=offline"];
  const offlineDocuments = [];
  await pwaCtx.setOffline(true);
  for (const path of offlineAttempts) {
    await pwaPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const first = await pwaPage.locator("body").textContent();
    const firstUrl = pwaPage.url();
    await pwaPage.reload({ waitUntil: "domcontentloaded" });
    const repeated = await pwaPage.locator("body").textContent();
    offlineDocuments.push({ path, first, firstUrl, repeated, repeatedUrl: pwaPage.url() });
  }
  const realCacheAudit = await pwaPage.evaluate(async () => {
    const entries = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ cacheName, url: request.url, body: response ? await response.text() : "" });
      }
    }
    return entries;
  });
  await pwaCtx.setOffline(false);
  const persistedCache = JSON.stringify(realCacheAudit);
  const cachedPaths = realCacheAudit.map(({ url }) => new URL(url).pathname);
  check(
    "offline E2E-011 full start/reload preserva URL e só persiste corpos públicos",
    offlineDocuments.every(({ path, first, firstUrl, repeated, repeatedUrl }) =>
      new URL(firstUrl).pathname + new URL(firstUrl).search === path
        && new URL(repeatedUrl).pathname + new URL(repeatedUrl).search === path
        && first?.includes(ptBR.transition.offlineTitle)
        && first?.includes(ptBR.transition.retry)
        && repeated?.includes(ptBR.transition.offlineTitle)
    )
      && privateMarkers.every((marker) => !persistedCache.includes(marker))
      && realCacheAudit.every(({ cacheName }) => /^(?:static|shell)-/.test(cacheName))
      && !cachedPaths.some((path) => path === "/login" || path.startsWith("/p/") || path.startsWith("/jobs")),
    JSON.stringify({ offlineDocuments, cachedPaths }),
  );

  const freshCtx = await browser.newContext();
  const freshPage = await freshCtx.newPage();
  await freshCtx.setOffline(true);
  let freshOfflineFailed = false;
  try {
    await freshPage.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded", timeout: 4_000 });
  } catch {
    freshOfflineFailed = true;
  }
  const freshOfflineBody = await freshPage.locator("body").textContent().catch(() => "");
  await freshCtx.setOffline(false);
  const recovered = await freshPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  const refusedCtx = await browser.newContext();
  const refusedPage = await refusedCtx.newPage();
  const refusedCdp = await refusedCtx.newCDPSession(refusedPage);
  await refusedCdp.send("Storage.overrideQuotaForOrigin", { origin: BASE, quotaSize: 1 });
  await refusedPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await refusedPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await refusedPage.reload({ waitUntil: "networkidle" });
  await refusedPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await refusedCtx.setOffline(true);
  const refusedFallback = await refusedPage.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  const refusedBody = await refusedPage.locator("body").textContent();
  await refusedCtx.setOffline(false);
  const refusedRecovered = await refusedPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  check(
    "offline E2E-012 sem cache e storage recusado degradam honestamente e recuperam online",
    freshOfflineFailed
      && !privateMarkers.some((marker) => freshOfflineBody?.includes(marker))
      && recovered?.status() === 200
      && refusedFallback?.status() === 503
      && refusedBody === "Offline."
      && refusedRecovered?.status() === 200,
    JSON.stringify({ freshOfflineFailed, freshOfflineBody, refusedStatus: refusedFallback?.status(), refusedBody }),
  );
  await freshCtx.close();
  await refusedCtx.close();

  await pwaCtx.close();
}
