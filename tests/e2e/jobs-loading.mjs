// Fronteira de carregamento de /jobs (#217).
//
// O servidor do E2E responde rápido demais para a espera ser vista: a
// navegação RSC para /jobs é retida por alguns segundos, e só ela — o
// pré-carregamento (`next-router-prefetch`) passa direto, porque é ele que traz
// o esqueleto antes do clique. Assim a prova não depende de corrida.
//
// Contexto próprio com o service worker bloqueado: requisição atendida pelo
// worker não passa por `page.route`, e a retenção simplesmente não acontecia.
// O worker não guarda página nem RSC (só `static-` e `shell-`), então a
// navegação medida é a mesma.

const HOLD_MS = 2_500;

const isNavigationRsc = (request) => {
  const headers = request.headers();
  return headers.rsc === "1" && !headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"];
};

// Testemunha o que entrou e saiu do DOM durante a espera, inclusive o que
// durou menos que um quadro de polling.
const watch = (page) => page.evaluate(() => {
  globalThis.__e2eJobsLoading?.observer?.disconnect();
  const evidence = { skeleton: false, listRemoved: false };
  const scan = (nodes, flag) => {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (flag === "added" && (node.matches('[data-testid="jobs-loading"]') || node.querySelector('[data-testid="jobs-loading"]'))) {
        evidence.skeleton = true;
      }
      if (flag === "removed" && (node.matches('[data-testid="route-jobs"]') || node.querySelector('[data-testid="route-jobs"]'))) {
        evidence.listRemoved = true;
      }
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      scan(mutation.addedNodes, "added");
      scan(mutation.removedNodes, "removed");
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.__e2eJobsLoading = { observer, evidence };
});

const collect = (page) => page.evaluate(() => {
  const { observer, evidence } = globalThis.__e2eJobsLoading;
  observer.disconnect();
  delete globalThis.__e2eJobsLoading;
  return evidence;
});

const settled = (page) => page.waitForFunction(() => {
  const shell = document.getElementById("application-shell");
  return shell && !shell.hasAttribute("inert") && !shell.hasAttribute("aria-busy")
    && !document.querySelector('[data-testid="navigation-transition"]');
}, null, { timeout: 20_000 });

export async function checkJobsLoading(browser, base, { email, password }, check) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  try {
    await runChecks(await context.newPage(), base, { email, password }, check);
  } finally {
    await context.close();
  }
}

async function runChecks(page, base, { email, password }, check) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // 1. O documento transmite o esqueleto antes da lista, e a vaga inexistente
  //    continua 404: a fronteira não envolve o detalhe. `fetch` de dentro da
  //    página leva o cookie da sessão; `page.request` não o leva para este host.
  const documents = await page.evaluate(async () => {
    const list = await fetch("/jobs");
    const missing = await fetch("/jobs/999999999", { redirect: "manual" });
    const html = await list.text();
    return {
      status: list.status,
      skeletonAt: html.indexOf('data-testid="route-jobs-loading"'),
      listAt: html.indexOf('data-testid="route-jobs"'),
      missing: missing.status,
      missingSkeleton: (await missing.text()).includes("jobs-loading"),
    };
  });
  check(
    "#217 documento de /jobs chega com o esboço antes da lista",
    documents.status === 200 && documents.skeletonAt > 0 && documents.listAt > documents.skeletonAt,
    JSON.stringify(documents),
  );
  check(
    "#217 vaga inexistente continua 404, sem esboço",
    documents.missing === 404 && !documents.missingSkeleton,
    JSON.stringify(documents),
  );

  let hold = false;
  const retain = async (route) => {
    if (hold && isNavigationRsc(route.request())) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  };
  const jobsUrl = (url) => url.pathname === "/jobs";
  await page.route(jobsUrl, retain);
  try {
    // 2. Troca de tela: o clique em Vagas mostra o esboço pré-carregado, o
    //    overlay sai sobre ele, e a lista chega depois.
    await page.goto(`${base}/compare`, { waitUntil: "networkidle" });
    await settled(page);
    hold = true;
    await watch(page);
    const clickedAt = Date.now();
    await page.locator('[data-testid="nav-jobs"]:visible').first().click();
    await page.getByTestId("jobs-loading").waitFor({ state: "attached", timeout: 10_000 });
    const skeletonAfterMs = Date.now() - clickedAt;
    await page.locator('[data-testid="navigation-transition"]').waitFor({ state: "detached", timeout: 10_000 });
    const overlayGoneBeforeList = (await page.getByTestId("route-jobs").count()) === 0;
    const announced = (await page.getByTestId("jobs-loading").locator('[role="status"]').textContent())?.trim() ?? "";
    const busy = await page.getByTestId("jobs-loading").locator("[aria-busy]").first().getAttribute("aria-busy");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByTestId("route-jobs").waitFor({ state: "visible", timeout: 20_000 });
    await settled(page);
    const routeEvidence = await collect(page);
    const skeletonLeft = (await page.getByTestId("jobs-loading").count()) === 0;
    check(
      "#217 troca para Vagas mostra o esboço, o overlay sai sobre ele e a lista substitui o esboço",
      routeEvidence.skeleton
        && skeletonAfterMs < HOLD_MS
        && overlayGoneBeforeList
        && announced.length > 0
        && busy === "true"
        && overflow <= 1
        && skeletonLeft,
      JSON.stringify({ routeEvidence, skeletonAfterMs, overlayGoneBeforeList, announced, busy, overflow, skeletonLeft }),
    );

    // 3. Mesma tela: filtro com a resposta retida não troca a lista pelo
    //    esboço — a transição suave da #220 continua mostrando a tela anterior.
    await watch(page);
    await page.getByTestId("filter-work-mode-remote").click();
    await page.waitForURL((url) => url.searchParams.get("workMode") === "remote", { timeout: 20_000 });
    await page.getByTestId("filter-work-mode-remote").and(page.locator('[aria-current="true"]')).waitFor({ timeout: 20_000 });
    await settled(page);
    const sameScreen = await collect(page);
    check(
      "#217 filtro na mesma tela mantém a lista anterior, sem esboço",
      !sameScreen.skeleton && !sameScreen.listRemoved,
      JSON.stringify(sameScreen),
    );
  } finally {
    hold = false;
    await page.unroute(jobsUrl, retain);
  }

  // 4. Refresh no destino filtrado mantém URL e filtro.
  await page.reload({ waitUntil: "networkidle" });
  check(
    "#217 recarregar mantém o filtro aplicado depois da espera",
    new URL(page.url()).searchParams.get("workMode") === "remote"
      && (await page.getByTestId("filter-work-mode-remote").getAttribute("aria-current")) === "true"
      && (await page.getByTestId("jobs-loading").count()) === 0,
  );
}
