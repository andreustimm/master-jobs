// Área `canonical-flows` do E2E de navegador: Task 04: inventário próprio e fluxos canônicos.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { TASK04_FIXTURES } from "../task04-fixtures.mjs";
import { COMPARISON_TEXT, contrast, en, privateMarkersOf, ptBR, toRgb, transitionHelpers } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_CLOSED_JOB_ID, E2E_DELETED_JOB_ID, E2E_EMAIL, E2E_LOGIN_EXPIRED_TOKEN, E2E_LOGIN_RACE_TOKEN, E2E_PASSWORD, E2E_RESET_CONSUMED_TOKEN, E2E_RESET_EXPIRED_TOKEN, E2E_RESET_RACE_TOKEN, browser, check, page, rememberCreatedJob, trackConsole } = ctx;
  const {
    observeCanonicalReload,
    observeNavigation,
    observeRedirectAction,
    observeSoftNavigation,
    pushOn,
    readCacheStorage,
    resetTransitionDocument,
    routerPush,
    transitionError,
    transitionOverlay,
    waitForState,
  } = transitionHelpers(ctx);
  // Criada pela área `candidate-rescore`, que o mapa de E2E exige antes desta.
  const { comparisonJobId } = ctx.state;
  const comparisonText = COMPARISON_TEXT;
  const privateMarkers = privateMarkersOf(ctx);
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const firstJobLink = page.locator('[data-testid^="job-link-"]').first();
  const contextualPhases = [];
  const softStatuses = [];
  const softOf = (evidence) => {
    softStatuses.push(evidence.status);
    return evidence.phase;
  };
  contextualPhases.push((await observeNavigation(page, () => firstJobLink.click(), '[data-testid="route-job-detail"]')).phase);
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="filters-query"]').fill("Task 04 typical fixture");
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const typicalCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="density-compact"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const densityState = {
    query: new URL(page.url()).searchParams.get("dense"),
    current: await page.locator('[data-testid="density-compact"]').getAttribute("aria-current"),
    layout: await page.locator('[data-density]').first().getAttribute("data-density"),
  };
  await page.locator('[data-testid="filters-query"]').fill("Task 04 bulk fixture");
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )));
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="page-size-200"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const bulkCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="pagination-next"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const paginationUrl = new URL(page.url());
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="preset-applicableToday"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const presetUrl = new URL(page.url());
  const contextualState = {
    pagination: {
      path: paginationUrl.pathname,
      query: paginationUrl.searchParams.get("q"),
      size: paginationUrl.searchParams.get("size"),
      page: paginationUrl.searchParams.get("page"),
    },
    preset: {
      path: presetUrl.pathname,
      fit: presetUrl.searchParams.get("fit"),
      unblocked: presetUrl.searchParams.get("unblocked"),
      named: presetUrl.searchParams.get("named"),
      stalePage: presetUrl.searchParams.get("page"),
    },
  };
  await page.locator('[data-testid="filters-query"]').fill(`zero-${crypto.randomUUID()}`);
  contextualPhases.push(softOf(await observeSoftNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )));
  const zeroCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  check(
    "task-04 E2E-003 card, densidade, paginação e GET cobrem zero, típico e milhares",
    contextualPhases.length === 8
      && contextualPhases[0] === "loading"
      && contextualPhases.slice(1).every((phase) => phase === "soft")
      && softStatuses.some((status) => status === ptBR.transition.updating || status === en.transition.updating)
      && typicalCardinality.cards === 7
      && /^7\s/.test(typicalCardinality.summary ?? "")
      && typicalCardinality.next === 0
      && densityState.query === "1"
      && densityState.current === "page"
      && densityState.layout === "compact"
      && bulkCardinality.cards === 200
      && /1[.,]001/.test(bulkCardinality.summary ?? "")
      && bulkCardinality.next === 1
      && contextualState.pagination.path === "/jobs"
      && contextualState.pagination.query === "Task 04 bulk fixture"
      && contextualState.pagination.size === "200"
      && contextualState.pagination.page === "2"
      && contextualState.preset.path === "/jobs"
      && contextualState.preset.fit === "60"
      && contextualState.preset.unblocked === "1"
      && contextualState.preset.named === "1"
      && contextualState.preset.stalePage === null
      && zeroCardinality.cards === 0
      && /^0\s/.test(zeroCardinality.summary ?? "")
      && zeroCardinality.next === 0,
    JSON.stringify({
      contextualPhases,
      softStatuses,
      typicalCardinality,
      densityState,
      bulkCardinality,
      contextualState,
      zeroCardinality,
    }),
  );

  // Voltar/avançar na mesma tela também é suave. Aqui o início vem do
  // observador de commit (o roteador já trocou a URL quando o evento chega),
  // um caminho diferente do Link e do formulário GET acima.
  const historyBack = await observeSoftNavigation(
    page,
    () => page.goBack(),
    '[data-testid="route-jobs"]',
    "history back on /jobs",
  );
  const historyForward = await observeSoftNavigation(
    page,
    () => page.goForward(),
    '[data-testid="route-jobs"]',
    "history forward on /jobs",
  );
  check(
    "#220 voltar e avançar na mesma tela não abrem o overlay nem travam o shell",
    historyBack.phase === "soft" && historyForward.phase === "soft",
    JSON.stringify({ historyBack, historyForward }),
  );

  const contextualFamilyFailures = [];
  const verifyContextualDestination = async (source, control, destination, expectedPath) => {
    await page.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    const link = page.locator(control).first();
    const targetPath = expectedPath ?? new URL(await link.getAttribute("href"), BASE).pathname;
    const snapshot = await observeNavigation(
      page,
      () => link.click(),
      destination,
      `${source} via ${control}`,
    );
    const actualPath = new URL(page.url()).pathname;
    if (snapshot.count !== 1 || actualPath !== targetPath) {
      contextualFamilyFailures.push(`${control}:${JSON.stringify({ count: snapshot.count, actualPath })}`);
    }
  };

  await verifyContextualDestination(
    "/candidate",
    '[data-testid="candidate-skills-link"]',
    '[data-testid="route-candidate-skills"]',
    "/candidate/skills",
  );
  await verifyContextualDestination(
    "/candidate/skills",
    '[data-testid="skills-vocabulary-link"]',
    '[data-testid="route-candidate-vocabulary"]',
    "/candidate/vocabulary",
  );
  await verifyContextualDestination(
    "/candidate/vocabulary",
    '[data-testid="vocabulary-candidate-link"]',
    '[data-testid="route-candidate"]',
    "/candidate",
  );
  await verifyContextualDestination(
    "/compare",
    '[data-testid="compare-candidate-link"]',
    '[data-testid="route-candidate"]',
    "/candidate",
  );
  await verifyContextualDestination(
    `/compare?job=${comparisonJobId}#comparison-result`,
    '[data-testid="compare-job-link"]',
    '[data-testid="route-job-detail"]',
    `/jobs/${comparisonJobId}`,
  );
  await verifyContextualDestination(
    `/jobs/${TASK04_FIXTURES.closedJobId}`,
    '[data-testid="job-detail-back"]',
    '[data-testid="route-jobs"]',
    "/jobs",
  );

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
  const pipelineRow = page.locator('[data-testid^="pipeline-job-"]').first();
  const pipelineHasRow = await pipelineRow.count() > 0;
  const pipelineControl = pipelineHasRow ? pipelineRow : page.locator('[data-testid="pipeline-empty-jobs"]');
  const pipelineExpected = pipelineHasRow
    ? new URL(await pipelineControl.getAttribute("href"), BASE).pathname
    : "/jobs";
  const pipelineSnapshot = await observeNavigation(
    page,
    () => pipelineControl.click(),
    pipelineHasRow ? '[data-testid="route-job-detail"]' : '[data-testid="route-jobs"]',
    "pipeline contextual destination",
  );
  if (pipelineSnapshot.count !== 1 || new URL(page.url()).pathname !== pipelineExpected) {
    contextualFamilyFailures.push(`pipeline:${page.url()}`);
  }

  await verifyContextualDestination(
    "/referrals",
    '[data-testid^="referral-job-"]',
    '[data-testid="route-job-detail"]',
    null,
  );
  check(
    "task-04 E2E-003 famílias contextuais chegam ao destino e preservam estado",
    contextualFamilyFailures.length === 0,
    contextualFamilyFailures.join(" | "),
  );

  // F-07 E2E-001 — o histórico sobrevive ao fim do anúncio. A vaga da fixture
  // está fechada E arquivada; a candidatura tem de continuar na tela, com o
  // estado da vaga dito em algum lugar, depois de filtrar e depois de recarregar.
  const historyFailures = [];
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
  const archivedBadge = page.locator(
    `[data-testid="pipeline-job-state-${TASK04_FIXTURES.archivedJobId}"]`,
  );
  const archivedRow = page.locator(
    `[data-testid="pipeline-job-${TASK04_FIXTURES.archivedJobId}"]`,
  );
  if ((await archivedRow.count()) !== 1) historyFailures.push("linha da vaga arquivada ausente");
  if ((await archivedBadge.count()) !== 1) {
    historyFailures.push("estado da vaga não aparece na linha");
  } else if (!(await archivedBadge.innerText()).trim()) {
    historyFailures.push("estado da vaga vazio");
  }

  await page.locator('[data-testid="pipeline-filter-applied"]').click();
  await page.waitForURL(/stage=applied/, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  const filteredUrl = page.url();
  if (!filteredUrl.includes("stage=applied")) {
    historyFailures.push(`filtro não entrou na URL: ${new URL(filteredUrl).search || "(vazia)"}`);
  }
  if ((await archivedRow.count()) !== 1) {
    historyFailures.push("filtro por estágio esconde a candidatura arquivada");
  }

  await page.reload({ waitUntil: "networkidle" });
  if ((await archivedRow.count()) !== 1) historyFailures.push("recarregar perde a linha");
  if (!page.url().includes("stage=applied")) {
    historyFailures.push(`recarregar perde o filtro: ${new URL(page.url()).search || "(vazia)"}`);
  }

  await page.goto(`${BASE}/pipeline?stage=nao-existe`, { waitUntil: "networkidle" });
  if ((await page.locator('[data-testid="pipeline-unknown-stage"]').count()) !== 1) {
    historyFailures.push("estágio inválido não é explicado");
  }
  if ((await archivedRow.count()) !== 1) {
    historyFailures.push("estágio inválido esconde o funil em vez de mostrá-lo inteiro");
  }

  // Página além do fim mostrava "nada no funil ainda" para quem TEM
  // candidatura — a lista vazia contando a mesma mentira que o estágio
  // desconhecido contaria. Agora o pedido é limitado à última página real.
  await page.goto(`${BASE}/pipeline?page=999`, { waitUntil: "networkidle" });
  if ((await archivedRow.count()) !== 1) {
    historyFailures.push("página além do fim esvazia o funil de quem tem candidatura");
  }

  check(
    "F-07 E2E-001 histórico mantém candidatura de vaga arquivada após filtro e refresh",
    historyFailures.length === 0,
    historyFailures.join(" | "),
  );

  const redirectEvidence = [];
  const actionLoginCtx = await browser.newContext();
  const actionLoginPage = await actionLoginCtx.newPage();
  await actionLoginCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await actionLoginPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await actionLoginPage.fill('input[name="email"]', E2E_EMAIL);
  await actionLoginPage.fill('input[name="password"]', E2E_PASSWORD);
  redirectEvidence.push(await observeRedirectAction(
    actionLoginPage,
    () => actionLoginPage.locator('[data-testid="login-submit"]').click(),
    '[data-testid="route-cockpit"]',
  ));
  await actionLoginCtx.close();

  const actionRecoveryCtx = await browser.newContext();
  const actionRecoveryPage = await actionRecoveryCtx.newPage();
  await actionRecoveryCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await actionRecoveryPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await actionRecoveryPage.fill('input[name="email"]', "nao-existe-task04@local.test");
  redirectEvidence.push(await observeRedirectAction(
    actionRecoveryPage,
    () => actionRecoveryPage.locator('[data-testid="request-reset"]').click(),
    '[data-testid="route-login-forgot"]',
  ));
  await actionRecoveryCtx.close();

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.fill('input[name="title"]', "Task 04 redirect fixture");
  await page.fill('input[name="companyName"]', "E2E Comparison Lab");
  await page.fill('textarea[name="description"]', comparisonText);
  redirectEvidence.push(await observeRedirectAction(
    page,
    () => page.locator('[data-testid="compare-submit"]').click(),
    '[data-testid="comparison-result"]',
  ));
  rememberCreatedJob(page.url(), "Task 04 redirect fixture", "E2E Comparison Lab");

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const jobFormEntry = await observeNavigation(
    page,
    () => routerPush("/jobs/new"),
    '[data-testid="route-jobs-new"]',
  );
  const task04RecruiterCompany = `Task 04 ${crypto.randomUUID()}`;
  const task04OneShotTitle = `Task 04 one-shot ${crypto.randomUUID()}`;
  await page.fill('input[name="title"]', task04OneShotTitle);
  await page.fill('input[name="companyName"]', task04RecruiterCompany);
  await page.fill('textarea[name="description"]', comparisonText);
  const oneShotRedirect = await observeRedirectAction(
    page,
    () => page.locator('[data-testid="post-job"]').click(),
    '[data-testid="route-job-detail"]',
  );
  redirectEvidence.push(oneShotRedirect);
  rememberCreatedJob(page.url(), task04OneShotTitle, task04RecruiterCompany);
  await page.goto(`${BASE}/jobs?q=${encodeURIComponent(task04OneShotTitle)}&size=200&fit=0`, {
    waitUntil: "networkidle",
  });
  const oneShotMutationCount = await page
    .locator('[data-testid^="job-link-"]')
    .filter({ hasText: task04OneShotTitle })
    .count();

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const administratorTransition = await observeNavigation(
    page,
    () => page.locator('[data-testid="nav-admin-users"]:visible').click(),
    '[data-testid="route-admin-users"]',
  );
  const administratorCache = await readCacheStorage(page);
  const task04Target = page.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
  const impersonationEntry = await observeRedirectAction(
    page,
    () => task04Target.locator('[data-testid="impersonate-user"]').click(),
    '[data-testid="stop-impersonating"]',
  );
  redirectEvidence.push(impersonationEntry);
  const impersonatedTransition = await observeNavigation(
    page,
    () => page.locator('[data-testid="nav-compare"]:visible').click(),
    '[data-testid="route-compare"]',
  );
  const impersonatedCache = await readCacheStorage(page);
  const impersonationExit = await observeRedirectAction(
    page,
    () => page.locator('[data-testid="stop-impersonating"]').click(),
    '[data-testid="route-admin-users"]',
  );
  const restoredAdministratorCache = await readCacheStorage(page);
  check(
    "task-04 E2E-004 redirects de login, recovery, compare, vaga e impersonação mutam uma vez",
    redirectEvidence.length === 5
      && redirectEvidence.every(({ count, actionRequests, sameScreen, moved }) =>
        count === (sameScreen ? 0 : 1) && actionRequests === 1 && moved),
    JSON.stringify(redirectEvidence.map(({ count, actionRequests, sameScreen, moved }) => ({ count, actionRequests, sameScreen, moved }))),
  );
  check(
    "task-04 IT-012 Server Actions reais mutam uma vez e iniciam somente o redirect aceito",
    jobFormEntry.generation === 1
      && oneShotRedirect.generation === jobFormEntry.generation + 1
      && oneShotRedirect.count === 1
      && oneShotRedirect.actionRequests === 1
      && oneShotRedirect.actionResponses === 1
      && oneShotRedirect.actionResponseSeenAtAttach
      && oneShotRedirect.transitionEvidence.filter((state) =>
        state.generation === oneShotRedirect.generation && state.phase === "loading"
      ).length === 1
      && oneShotMutationCount === 1,
    JSON.stringify({ jobFormEntry, oneShotRedirect, oneShotMutationCount }),
  );

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await observeNavigation(page, () => page.locator('[data-testid="nav-compare"]:visible').click(), '[data-testid="route-compare"]');
  await observeNavigation(page, () => page.locator('[data-testid="nav-pipeline"]:visible').click(), '[data-testid="route-pipeline"]');
  const backToCompare = page.goBack({ waitUntil: "commit" });
  await transitionOverlay.waitFor({ state: "attached" });
  const firstHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await backToCompare;
  await page.locator('[data-testid="route-compare"]').waitFor({ state: "visible" });
  const backToJobs = page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(
    (generation) => Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation")) > generation,
    firstHistoryGeneration,
  );
  const secondHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await backToJobs;
  await page.locator('[data-testid="route-jobs"]').waitFor({ state: "visible" });
  const forwardToCompare = page.goForward({ waitUntil: "commit" });
  await page.waitForFunction(
    (generation) => Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation")) > generation,
    secondHistoryGeneration,
  );
  const finalHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await forwardToCompare;
  await page.locator('[data-testid="route-compare"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  const historyFocus = await page.evaluate(() => ({
    path: location.pathname,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    focusedOverlay: Boolean(document.activeElement?.closest('[data-testid="navigation-transition"]')),
  }));
  check(
    "task-04 E2E-005 histórico rápido multi-entry termina no dono final sem foco removido",
    firstHistoryGeneration < secondHistoryGeneration
      && secondHistoryGeneration < finalHistoryGeneration
      && historyFocus.path === "/compare"
      && historyFocus.overlays === 0
      && !historyFocus.focusedOverlay,
    JSON.stringify({ firstHistoryGeneration, secondHistoryGeneration, finalHistoryGeneration, historyFocus }),
  );
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const visibilityBeforeTask04 = await page.locator('input[name="visibility"]:checked').getAttribute("value") ?? "private";
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const task04PublicHref = await page.locator('a[href^="/p/"]').first().getAttribute("href");

  const publicCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const publicPage = await publicCtx.newPage();
  await publicCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const directRouteLayers = [];
  for (const path of [
    "/login",
    "/login/forgot",
    "/login/reset?token=nunca-existiu-task04-direct",
    `/login/callback?token=${E2E_LOGIN_EXPIRED_TOKEN}`,
    task04PublicHref,
  ].filter(Boolean)) {
    const directPage = await publicCtx.newPage();
    await directPage.goto(`${BASE}${path}`, { waitUntil: "commit" });
    await directPage.locator("#app-splash").waitFor({ state: "attached", timeout: 10_000 });
    directRouteLayers.push(await directPage.evaluate(() => ({
      path: location.pathname + location.search,
      startup: document.querySelectorAll("#app-splash").length,
      transition: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    })));
    await directPage.close();
  }
  await publicPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await publicPage.locator("#app-splash").waitFor({ state: "detached" });
  const canonical404Ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await canonical404Ctx.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  const canonical404Page = await canonical404Ctx.newPage();
  const canonical404Response = await canonical404Page.goto(`${BASE}/p/full-qa-not-published`, {
    waitUntil: "domcontentloaded",
  });
  await canonical404Page.locator('[data-testid="route-not-found"]').waitFor({ state: "visible" });
  await canonical404Page.locator("#app-splash").waitFor({ state: "detached", timeout: 5_000 });
  const canonical404Reload = await observeCanonicalReload(canonical404Page, "route-not-found");
  const canonical404Body = canonical404Reload.body;
  await canonical404Page.locator('[data-testid="route-status-back"]').click();
  await canonical404Page.waitForURL((url) => url.pathname === "/login");
  const canonical404RecoveryPath = new URL(canonical404Page.url()).pathname;
  check(
    "BUG-20260824 recarga 404 termina na tela canônica sem splash inerte",
    canonical404Response?.status() === 404
      && canonical404Reload.status === 404
      && canonical404Reload.terminal === 1
      && canonical404Reload.startup === 0
      && canonical404Reload.transitions === 0
      && canonical404Reload.locale === "en"
      && canonical404Reload.overflow <= 1
      && canonical404Body.includes(en.routeStatus.notFoundTitle)
      && canonical404Body.includes(en.routeStatus.notFoundBody)
      && canonical404Reload.backText === en.routeStatus.back
      && canonical404Reload.backHref === "/"
      && canonical404RecoveryPath === "/login"
      && privateMarkers.every((term) => !canonical404Body.includes(term)),
    JSON.stringify({ ...canonical404Reload, recoveryPath: canonical404RecoveryPath }),
  );
  await canonical404Ctx.close();
  const publicPhases = [];
  publicPhases.push(await observeNavigation(
    publicPage,
    () => publicPage.locator('[data-testid="forgot-password"]').click(),
    '[data-testid="route-login-forgot"]',
  ));
  publicPhases.push(await observeNavigation(
    publicPage,
    () => publicPage.locator('[data-testid="login-back"]').click(),
    '[data-testid="route-login"]',
  ));
  const resetSoftTransition = await observeNavigation(
    publicPage,
    () => pushOn(publicPage, "/login/reset?token=nunca-existiu-task04-soft"),
    '[data-testid="route-login-reset"]',
  );
  publicPhases.push(resetSoftTransition);
  publicPhases.push(await observeNavigation(
    publicPage,
    () => pushOn(publicPage, "/login"),
    '[data-testid="route-login"]',
  ));
  const callbackSoftTransition = await observeNavigation(
    publicPage,
    () => pushOn(publicPage, `/login/callback?token=${encodeURIComponent(E2E_LOGIN_EXPIRED_TOKEN)}`),
    // O alerta, não a tela: `route-login` já está visível ANTES do push, e
    // esperar por ela encerrava a observação antes de a navegação acontecer.
    '[data-testid="route-login"] [role="alert"]',
    "expired callback soft transition",
  );
  publicPhases.push(callbackSoftTransition);
  // O callback é um Route Handler que responde 303, e o roteador às vezes cai
  // numa navegação de DOCUMENTO para `/login?error=invalid` em vez da suave.
  // Prova, no run 36034122670 (tentativa 1): esta fase saiu com `count` 1 e
  // `maxOverlayCount` 0 — o overlay foi visto, mas a evidência do
  // MutationObserver sumiu, e ela só some quando o documento é trocado. O
  // alerta vem no HTML do servidor e fica visível ANTES da hidratação. O
  // `push` seguinte saía antes de o Next criar a fila de ações do roteador e
  // morria sem erro (`window.next.router` já existe desde o carregamento do
  // módulo): 20 s de espera sem uma única requisição para `/p/` (#303). A fila
  // nasce logo antes do `hydrateRoot`, então a fibra do React na tela a prova.
  await publicPage.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("error") === "invalid");
  await publicPage.waitForFunction(() => {
    const screen = document.querySelector('[data-testid="route-login"]');
    return Boolean(screen && Object.keys(screen).some((key) => key.startsWith("__reactFiber$")));
  });
  // O callback vencido volta para `/login?error=invalid`: a MESMA tela de onde
  // o push saiu, só com outra query — navegação de mesma tela, que não abre
  // overlay (#220). O overlay só aparece quando o roteador chega a confirmar a
  // URL intermediária `/login/callback`, e isso depende de quanto a resposta do
  // redirect demora: na máquina local aparecia, no runner do CI não (medido na
  // #202). Nos dois casos o que se exige é o mesmo: nunca duas camadas, e a
  // tela certa no fim — o alerta, que só existe com `error=invalid`.
  const overlayCountFits = (phase) =>
    phase === callbackSoftTransition ? phase.count <= 1 && phase.maxOverlayCount <= 1 : phase.count === 1;
  if (task04PublicHref) {
    // A transição suave é o que se mede aqui; o que vem depois — vazamento de
    // dado no perfil público — é verificação de segurança e não pode ficar sem
    // resposta porque uma navegação não chegou.
    //
    // Então a falha da transição vira um check reprovado, e o cenário segue por
    // `goto`. Sem esta separação a exceção subia para o `catch` da suíte e
    // levava consigo tudo o que vinha depois, incluindo as asserções sobre o que
    // `/p/[slug]` mostra a quem não tem sessão.
    // O que a rede respondeu durante a navegação, para o diagnóstico dizer POR QUE
    // ela não chegou. Sem isto a falha é só um timeout de locator, que não
    // distingue 429 de 404, de redirecionamento para `/login`, ou de a requisição
    // RSC nunca ter saído.
    const respostasDoPerfil = [];
    const coletor = (resposta) => {
      const url = resposta.url();
      if (url.includes("/p/") || url.includes("_rsc")) {
        respostasDoPerfil.push(`${resposta.status()} ${url.replace(BASE, "").slice(0, 120)}`);
      }
    };
    publicPage.on("response", coletor);
    try {
      publicPhases.push(await observeNavigation(
        publicPage,
        () => pushOn(publicPage, task04PublicHref),
        '[data-testid="route-public-profile"]',
      ));
    } catch (erro) {
      check(
        "task-04 transição suave para o perfil público chega à rota",
        false,
        `${(erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, " ").slice(0, 200)} | rede: ${respostasDoPerfil.slice(0, 6).join(" ; ") || "nenhuma resposta para /p/ ou _rsc"}`,
      );
      await publicPage.goto(`${BASE}${task04PublicHref}`, { waitUntil: "domcontentloaded" });
      await publicPage
        .locator('[data-testid="route-public-profile"]')
        .waitFor({ state: "visible", timeout: 20_000 });
    } finally {
      publicPage.off("response", coletor);
    }
  }
  const publicUserText = task04PublicHref
    ? (await publicPage.locator('[data-testid="route-public-profile"] h1').textContent()) ?? ""
    : "missing-public-profile";
  const publicProfileMarkers = task04PublicHref
    ? (await publicPage.locator('[data-testid="route-public-profile"] [data-user-content]').allTextContents())
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== publicUserText)
    : [];
  const publicLeakMarkers = [publicUserText, ...publicProfileMarkers]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  check(
    "task-04 E2E-013 startup direto e auth/public soft usam uma camada sem conteúdo do usuário",
    directRouteLayers.length === 5
      && directRouteLayers.every(({ startup, transition }) => startup === 1 && transition === 0)
      && publicPhases.length === 6
      && publicProfileMarkers.length > 0
      && publicPhases.every((phase) =>
        overlayCountFits(phase)
          && privateMarkers.every((term) => !phase.text.includes(term))
          && publicLeakMarkers.every((term) => !phase.text.includes(term))
      ),
    JSON.stringify({
      directRouteLayers,
      phases: publicPhases.map(({ count, maxOverlayCount }) => [count, maxOverlayCount]),
      publicLeakMarkers,
    }),
  );
  await publicPage.goto(`${BASE}/login/reset?token=nunca-existiu-task04`, { waitUntil: "networkidle" });
  const invalidReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  await publicPage.goto(`${BASE}/login/reset?token=${E2E_RESET_EXPIRED_TOKEN}`, { waitUntil: "networkidle" });
  const expiredReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  const expiredResetForms = await publicPage.locator('input[name="password"]').count();
  await publicPage.goto(`${BASE}/login/reset?token=${E2E_RESET_CONSUMED_TOKEN}`, { waitUntil: "networkidle" });
  const consumedReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  const consumedResetForms = await publicPage.locator('input[name="password"]').count();

  const resetRaceContexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const resetRacePages = await Promise.all(resetRaceContexts.map((context) => context.newPage()));
  const resetRacePosts = [0, 0];
  for (const [index, resetPage] of resetRacePages.entries()) {
    resetPage.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) resetRacePosts[index] += 1;
    });
    await resetPage.goto(`${BASE}/login/reset?token=${E2E_RESET_RACE_TOKEN}`, { waitUntil: "networkidle" });
    await resetPage.fill('input[name="password"]', `task04-race-password-${index + 1}!`);
  }
  await Promise.all(resetRacePages.map(async (resetPage) => {
    await Promise.all([
      resetPage.waitForURL((url) => url.pathname === "/login" || url.searchParams.get("error") === "invalid"),
      resetPage.locator('[data-testid="submit-reset"]').click(),
    ]);
  }));
  const resetRaceUrls = resetRacePages.map((resetPage) => resetPage.url().replace(BASE, ""));
  const resetWinnerIndex = resetRaceUrls.findIndex((url) => url === "/login?reset=1");
  if (resetWinnerIndex === -1) throw new Error("reset race produced no successful consumer");
  const resetReplayPage = resetRacePages[resetWinnerIndex];
  const consumedResetPath = `/login/reset?token=${E2E_RESET_RACE_TOKEN}`;
  await resetReplayPage.goto(`${BASE}${consumedResetPath}`, { waitUntil: "networkidle" });
  const resetReplayAfterConsume = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await resetReplayPage.reload({ waitUntil: "networkidle" });
  const resetReplayAfterReload = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await resetReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await resetReplayPage.goBack({ waitUntil: "networkidle" });
  const resetReplayAfterHistory = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await Promise.all(resetRaceContexts.map((context) => context.close()));
  await publicPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_EXPIRED_TOKEN}`, { waitUntil: "networkidle" });
  const expiredCallback = new URL(publicPage.url());
  const expiredCallbackUrl = expiredCallback.pathname + expiredCallback.search;
  const loginRaceContexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const loginRacePages = await Promise.all(loginRaceContexts.map((context) => context.newPage()));
  await Promise.all(loginRacePages.map((loginPage) =>
    loginPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" })
  ));
  const loginRaceUrls = loginRacePages.map((loginPage) => {
    const url = new URL(loginPage.url());
    return url.pathname + url.search;
  });
  const loginRaceSessions = await Promise.all(loginRaceContexts.map(async (context) =>
    (await context.cookies()).some((cookie) => cookie.name === "jho_session")
  ));
  const loginWinnerIndex = loginRaceSessions.findIndex(Boolean);
  if (loginWinnerIndex === -1) throw new Error("login race produced no successful consumer");
  const loginReplayContext = loginRaceContexts[loginWinnerIndex];
  const loginReplayPage = loginRacePages[loginWinnerIndex];
  await loginReplayContext.clearCookies();
  await loginReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await loginReplayPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" });
  const loginReplayAfterConsumeUrl = new URL(loginReplayPage.url());
  const loginReplayAfterConsume = loginReplayAfterConsumeUrl.pathname + loginReplayAfterConsumeUrl.search;
  await loginReplayPage.reload({ waitUntil: "networkidle" });
  const loginReplayAfterReloadUrl = new URL(loginReplayPage.url());
  const loginReplayAfterReload = loginReplayAfterReloadUrl.pathname + loginReplayAfterReloadUrl.search;
  await loginReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await loginReplayPage.goBack({ waitUntil: "networkidle" });
  const loginReplayAfterHistoryUrl = new URL(loginReplayPage.url());
  const loginReplayAfterHistory = loginReplayAfterHistoryUrl.pathname + loginReplayAfterHistoryUrl.search;
  const loginReplayRestoredSession = (await loginReplayContext.cookies())
    .some((cookie) => cookie.name === "jho_session");
  await Promise.all(loginRaceContexts.map((context) => context.close()));
  await publicPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" });
  const replayCallback = new URL(publicPage.url());
  const replayCallbackUrl = replayCallback.pathname + replayCallback.search;
  const emptyProfileResponse = await publicPage.goto(`${BASE}/p/e2e-e2e-alvo`, { waitUntil: "networkidle" });
  const emptyProfile = await publicPage.evaluate(() => {
    const main = document.querySelector('[data-testid="route-public-profile"]');
    return {
      statusSurface: Boolean(main),
      heading: main?.querySelector("h1")?.textContent?.trim() ?? "",
      optionalParagraphs: main?.querySelectorAll("p").length ?? -1,
      optionalSections: main?.querySelectorAll("section").length ?? -1,
      optionalLinks: main?.querySelectorAll("a").length ?? -1,
      overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(
    "task-04 E2E-018 tokens inválidos, expirados, consumidos e raceados preservam resultado canônico",
    /não vale mais/i.test(invalidReset ?? "")
      && expiredReset === consumedReset
      && /não vale mais/i.test(expiredReset ?? "")
      && expiredResetForms === 0
      && consumedResetForms === 0
      && resetRacePosts.every((count) => count === 1)
      && resetRaceUrls.filter((url) => url === "/login?reset=1").length === 1
      && resetRaceUrls.filter((url) => url.includes("error=invalid")).length === 1
      && expiredCallbackUrl === "/login?error=invalid"
      && loginRaceUrls.filter((url) => url === "/login").length === 1
      && loginRaceUrls.filter((url) => url === "/login?error=invalid").length === 1
      && loginRaceSessions.filter(Boolean).length === 1
      && replayCallbackUrl === "/login?error=invalid"
      && [resetReplayAfterConsume, resetReplayAfterReload, resetReplayAfterHistory]
        .every(({ url, forms }) => url === consumedResetPath && forms === 0)
      && loginReplayAfterConsume === "/login?error=invalid"
      && loginReplayAfterReload === "/login?error=invalid"
      && loginReplayAfterHistory === "/login?error=invalid"
      && !loginReplayRestoredSession
      && emptyProfileResponse?.status() === 200
      && emptyProfile.statusSurface
      // O setup grava o e-mail como nome deste candidato — o dado que a
      // 1.22.0 produzia pela CLI. A página nunca o publica: o título é o
      // neutro do dicionário (BUG-20260922-public-profile-shows-email-as-name).
      && !emptyProfile.heading.includes("@")
      && ["Perfil sem nome", "Unnamed profile"].includes(emptyProfile.heading)
      && emptyProfile.optionalParagraphs === 0
      && emptyProfile.optionalSections === 0
      && emptyProfile.optionalLinks === 0
      && emptyProfile.overlays === 0
      && emptyProfile.overflow <= 1,
    JSON.stringify({
      expiredResetForms,
      consumedResetForms,
      resetRacePosts,
      resetRaceUrls,
      expiredCallbackUrl,
      loginRaceUrls,
      loginRaceSessions,
      replayCallbackUrl,
      resetReplayAfterConsume,
      resetReplayAfterReload,
      resetReplayAfterHistory,
      loginReplayAfterConsume,
      loginReplayAfterReload,
      loginReplayAfterHistory,
      loginReplayRestoredSession,
      emptyProfile,
    }),
  );

  const longPublicPath = `/p/${"a".repeat(16 * 1024)}`;
  const longResponse = await publicPage.goto(`${BASE}${longPublicPath}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const longOutcome = await publicPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    body: document.body.innerText,
  }));
  const malformedResponse = await publicPage.goto(`${BASE}/p/%`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const malformedOutcome = await publicPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    body: document.body.innerText,
  }));
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const statusContext = await browser.newContext();
  await statusContext.addCookies(await page.context().cookies());
  const statusPage = await statusContext.newPage();
  const missingJobDocumentStatus = (await statusPage.goto(`${BASE}/jobs/999999999`, {
    waitUntil: "networkidle",
  }))?.status() ?? 0;
  const deletedJobDocumentStatus = (await statusPage.goto(`${BASE}/jobs/${E2E_DELETED_JOB_ID}`, {
    waitUntil: "networkidle",
  }))?.status() ?? 0;
  await statusContext.close();
  const missingJobTransition = await observeNavigation(
    page,
    () => routerPush("/jobs/999999999"),
    "body",
    "missing job soft transition",
  );
  const missingJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    notFound: document.querySelectorAll('[data-testid="route-not-found"]').length,
    body: document.body.innerText,
  }));

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const closedJobTransition = await observeNavigation(
    page,
    () => routerPush(`/jobs/${E2E_CLOSED_JOB_ID}`),
    '[data-testid="route-job-detail"]',
    "closed job soft transition",
  );
  const closedJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    body: document.querySelector('[data-testid="route-job-detail"]')?.textContent ?? "",
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
  }));

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const deletedJobTransition = await observeNavigation(
    page,
    () => routerPush(`/jobs/${E2E_DELETED_JOB_ID}`),
    "body",
    "deleted job soft transition",
  );
  const deletedJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    notFound: document.querySelectorAll('[data-testid="route-not-found"]').length,
    body: document.body.innerText,
  }));
  if (!task04PublicHref) throw new Error("Task 04 public profile href unavailable for revocation race");
  const revocationCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    serviceWorkers: "block",
  });
  const revocationPage = await revocationCtx.newPage();
  trackConsole(revocationPage);
  await revocationCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await revocationPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await revocationPage.fill('input[name="email"]', E2E_EMAIL);
  await revocationPage.fill('input[name="password"]', E2E_PASSWORD);
  await observeRedirectAction(
    revocationPage,
    () => revocationPage.locator('[data-testid="login-submit"]').click(),
    '[data-testid="route-cockpit"]',
  );
  await revocationPage.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const revocationLink = revocationPage.locator(`a[href="${task04PublicHref}"]`).first();
  if (await revocationLink.count() !== 1) throw new Error("Public profile TransitionLink unavailable for revocation race");
  const revocationTarget = task04PublicHref;
  const revocationPath = new URL(revocationTarget, BASE).pathname;
  let releaseRevocationRequest = () => {};
  let markRevocationPending = () => {};
  const revocationPending = new Promise((resolve) => { markRevocationPending = resolve; });
  let heldRevocationRequest = false;
  const holdRevocation = async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const isNavigationTransport = request.method() === "GET";
    if (!heldRevocationRequest && isNavigationTransport && requestUrl.pathname === revocationPath) {
      heldRevocationRequest = true;
      markRevocationPending();
      await new Promise((resolve) => { releaseRevocationRequest = resolve; });
    }
    await route.continue();
  };
  await revocationPage.route("**/*", holdRevocation);
  await revocationLink.click({ noWaitAfter: true });
  let revocationTimeoutId;
  const revocationTimeout = new Promise((_, reject) => {
    revocationTimeoutId = setTimeout(() => reject(new Error("revocation request was not intercepted")), 20_000);
  });
  try {
    await Promise.all([
      Promise.race([revocationPending, revocationTimeout]),
      revocationPage.locator('[data-testid="navigation-transition"]').waitFor({ state: "attached", timeout: 20_000 }),
    ]);
  } catch (error) {
    releaseRevocationRequest();
    throw error;
  } finally {
    clearTimeout(revocationTimeoutId);
  }
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"])),
    page.locator('[data-testid="save-visibility"]').click(),
  ]);
  releaseRevocationRequest();
  await revocationPage.waitForURL((url) => url.pathname === revocationPath, { timeout: 20_000 });
  await revocationPage.locator('[data-testid="navigation-transition"]').waitFor({ state: "detached", timeout: 20_000 });
  const revokedProfileOutcome = await revocationPage.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    publicProfile: document.querySelectorAll('[data-testid="route-public-profile"]').length,
    notFound: document.querySelectorAll('[data-testid="route-not-found"]').length,
    body: document.body.innerText,
  }));
  await revocationPage.unroute("**/*", holdRevocation);
  await revocationCtx.close();
  const staleEntityMarkers = [
    ...publicProfileMarkers,
    "Task 04 deleted fixture",
    "Task 04 Deleted Lab",
  ];
  check(
    "task-04 E2E-019 URL hostil, vagas ausente/deletada/fechada e revogação pending ficam canônicas",
    (longResponse?.status() ?? 0) >= 400
      && longOutcome.overflow <= 1
      && longOutcome.overlays === 0
      && malformedOutcome.overflow <= 1
      && malformedOutcome.overlays === 0
      && (malformedResponse?.status() ?? 0) >= 400
      && missingJobOutcome.path === "/jobs/999999999"
      && missingJobDocumentStatus === 404
      && deletedJobDocumentStatus === 404
      && missingJobOutcome.noIndex
      && missingJobOutcome.overlays === 0
      && missingJobOutcome.jobDetail === 0
      && staleEntityMarkers.every((term) => !missingJobOutcome.body.includes(term))
      && closedJobOutcome.path === `/jobs/${E2E_CLOSED_JOB_ID}`
      && closedJobOutcome.jobDetail === 1
      && /Task 04 closed fixture/.test(closedJobOutcome.body)
      && /fechada/i.test(closedJobOutcome.body)
      && closedJobOutcome.overlays === 0
      && deletedJobOutcome.path === `/jobs/${E2E_DELETED_JOB_ID}`
      && deletedJobOutcome.noIndex
      && deletedJobOutcome.overlays === 0
      && deletedJobOutcome.jobDetail === 0
      && staleEntityMarkers.every((term) => !deletedJobOutcome.body.includes(term))
      && heldRevocationRequest
      && revokedProfileOutcome.path === task04PublicHref
      && revokedProfileOutcome.noIndex
      && revokedProfileOutcome.overlays === 0
      && revokedProfileOutcome.publicProfile === 0
      && publicProfileMarkers.every((term) => !revokedProfileOutcome.body.includes(term))
      && privateMarkers.every((term) => !longOutcome.body.includes(term))
      && privateMarkers.every((term) => !malformedOutcome.body.includes(term)),
    JSON.stringify({
      longStatus: longResponse?.status(),
      missingJobDocumentStatus,
      deletedJobDocumentStatus,
      longOutcome,
      malformedStatus: malformedResponse?.status(),
      malformedOutcome,
      missingJobOutcome,
      closedJobOutcome,
      deletedJobOutcome,
      heldRevocationRequest,
      revokedProfileOutcome,
    }),
  );
  check(
    "task-04 IT-014 entidades ausentes, fechadas e revogadas preservam resultado canônico sem cache privado",
    [missingJobTransition, closedJobTransition, deletedJobTransition]
      .every(({ generation, maxOverlayCount }) =>
        Number.isInteger(generation) && generation > 0 && maxOverlayCount === 1
      )
      && missingJobOutcome.noIndex
      && missingJobOutcome.jobDetail === 0
      && missingJobOutcome.notFound === 1
      && closedJobOutcome.jobDetail === 1
      && /fechada/i.test(closedJobOutcome.body)
      && deletedJobOutcome.noIndex
      && deletedJobOutcome.jobDetail === 0
      && deletedJobOutcome.notFound === 1
      && revokedProfileOutcome.noIndex
      && revokedProfileOutcome.publicProfile === 0
      && revokedProfileOutcome.notFound === 1
      && [missingJobOutcome, closedJobOutcome, deletedJobOutcome, revokedProfileOutcome]
        .every(({ overlays }) => overlays === 0),
    JSON.stringify({
      transitions: [missingJobTransition, closedJobTransition, deletedJobTransition]
        .map(({ count, generation }) => ({ count, generation })),
      missingJobOutcome,
      closedJobOutcome,
      deletedJobOutcome,
      revokedProfileOutcome,
    }),
  );
  await publicCtx.close();

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check(`input[name="visibility"][value="${visibilityBeforeTask04}"]`);
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(700);

  const roleTransitionResults = [];
  for (const scenario of [
    {
      email: "e2e-candidato@local.test",
      locale: "en",
      prepare: "/jobs",
      control: '[data-testid="nav-compare"]:visible',
      landmark: '[data-testid="route-compare"]',
    },
    {
      email: "e2e-recrutador@local.test",
      locale: "en",
      prepare: `/jobs/${E2E_CLOSED_JOB_ID}`,
      control: '[data-testid="nav-jobs"]:visible',
      landmark: '[data-testid="route-jobs"]',
    },
  ]) {
    const roleCtx = await browser.newContext();
    if (scenario.locale) {
      await roleCtx.addCookies([{ name: "jho_locale", value: scenario.locale, url: BASE }]);
    }
    const rolePage = await roleCtx.newPage();
    await rolePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await rolePage.fill('input[name="email"]', scenario.email);
    await rolePage.fill('input[name="password"]', E2E_PASSWORD);
    await rolePage.locator('[data-testid="login-submit"]').click();
    await rolePage.waitForURL((url) => !url.pathname.startsWith("/login"));
    // #279: a conta de candidato do E2E nunca é pontuada. Com o corte padrão de
    // 45, o cockpit e o quadro dela têm de listar o acervo e dizer que a nota
    // está pendente. O cockpit é lido direto, sem depender de onde o login cai.
    let unscoredBoard = null;
    if (scenario.email === "e2e-candidato@local.test") {
      await rolePage.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const cockpitNotice = await rolePage.evaluate(
        () => document.querySelector('[data-testid="cockpit-scores-pending"]')?.textContent ?? null,
      );
      unscoredBoard = { cockpitNotice };
    }
    if (scenario.prepare) await rolePage.goto(`${BASE}${scenario.prepare}`, { waitUntil: "networkidle" });
    if (unscoredBoard) {
      Object.assign(unscoredBoard, await rolePage.evaluate(() => ({
        total: Number(document.querySelector('[data-testid="jobs-total"]')?.getAttribute("data-total") ?? "-1"),
        notice: document.querySelector('[data-testid="jobs-notice-scores_pending"]')?.textContent ?? null,
      })));
    }
    const snapshot = await observeNavigation(
      rolePage,
      () => rolePage.locator(scenario.control).click(),
      scenario.landmark,
      `task-04 E2E-020 ${scenario.email}`,
    );
    let emptyPipelineLocale = null;
    if (scenario.email === "e2e-candidato@local.test") {
      const pipelineTransition = await observeNavigation(
        rolePage,
        () => rolePage.locator('[data-testid="nav-pipeline"]:visible').click(),
        '[data-testid="route-pipeline"]',
        "task-04 empty pipeline locale",
      );
      emptyPipelineLocale = {
        transition: pipelineTransition.count,
        emptyLink: await rolePage.locator('[data-testid="pipeline-empty-jobs"]').count(),
        text: (await rolePage.locator('[data-testid="route-pipeline"]').textContent()) ?? "",
      };
      await rolePage.reload({ waitUntil: "networkidle" });
      emptyPipelineLocale.reloadedText =
        (await rolePage.locator('[data-testid="route-pipeline"]').textContent()) ?? "";
    }
    let missingRoleSnapshot = null;
    let missingRoleOutcome = null;
    let missingRoleReload = null;
    if (scenario.email === "e2e-recrutador@local.test") {
      missingRoleSnapshot = await observeNavigation(
        rolePage,
        () => pushOn(rolePage, "/candidate"),
        "body",
        "task-04 missing-role soft transition",
      );
      missingRoleOutcome = await rolePage.evaluate(() => ({
        path: location.pathname,
        candidate: document.querySelectorAll('[data-testid="route-candidate"]').length,
        forbidden: document.querySelectorAll('[data-testid="route-forbidden"]').length,
        overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
        body: document.body.innerText,
      }));
      missingRoleReload = await observeCanonicalReload(rolePage, "route-forbidden");
      await rolePage.locator('[data-testid="route-status-back"]').click();
      await rolePage.waitForURL((url) => url.pathname === "/jobs");
      missingRoleReload.recoveryPath = new URL(rolePage.url()).pathname;
    }
    const cache = await readCacheStorage(rolePage);
    roleTransitionResults.push({
      email: scenario.email,
      snapshot,
      missingRoleSnapshot,
      missingRoleOutcome,
      missingRoleReload,
      emptyPipelineLocale,
      unscoredBoard,
      cache,
    });
    await roleCtx.close();
  }

  const expiredCtx = await browser.newContext();
  const expiredPage = await expiredCtx.newPage();
  await expiredPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await expiredPage.fill('input[name="email"]', "e2e-candidato@local.test");
  await expiredPage.fill('input[name="password"]', E2E_PASSWORD);
  await expiredPage.locator('[data-testid="login-submit"]').click();
  await expiredPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expiredCtx.clearCookies();
  await expiredCtx.addCookies([{ name: "jho_session", value: "expired-task04", url: BASE }]);
  const expiredSnapshot = await observeNavigation(
    expiredPage,
    () => expiredPage.locator('[data-testid="nav-compare"]:visible').click(),
    '[data-testid="route-login"]',
    "task-04 E2E-020 expired session",
  );
  const expiredCache = await readCacheStorage(expiredPage);
  await expiredCtx.close();

  const recruiterMissingRole = roleTransitionResults
    .find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot;
  const recruiterMissingRoleOutcome = roleTransitionResults
    .find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleOutcome;
  const recruiterMissingRoleReload = roleTransitionResults
    .find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleReload;
  if (!recruiterMissingRole) throw new Error("missing-role transition evidence unavailable");
  const namedRoleTransitions = [
    ...roleTransitionResults.map(({ email, snapshot }) => ({ role: email, snapshot })),
    { role: "administrator", snapshot: administratorTransition },
    { role: "impersonated-administrator", snapshot: impersonatedTransition },
    { role: "expired-session", snapshot: expiredSnapshot },
    { role: "missing-role", snapshot: recruiterMissingRole },
  ];
  const roleNeutral = namedRoleTransitions.map(({ snapshot }) => snapshot.text)
    .every((text) => privateMarkers.every((term) => !text.includes(term)));
  const roleCaches = [
    ...roleTransitionResults.map(({ email, cache }) => ({ role: email, cache })),
    { role: "administrator", cache: administratorCache },
    { role: "impersonated-administrator", cache: impersonatedCache },
    { role: "restored-administrator", cache: restoredAdministratorCache },
    { role: "expired-session", cache: expiredCache },
  ];
  const roleCachePayload = JSON.stringify(roleCaches.map(({ cache }) => cache));
  const roleCacheIsolated = roleCaches.every(({ cache }) =>
    cache.names.every((name) => name.startsWith("static-") || name.startsWith("shell-"))
      && cache.entries.every(({ url }) => {
        const path = new URL(url).pathname;
        return ![
          "/admin/users",
          "/candidate",
          "/compare",
          "/jobs",
          "/pipeline",
          "/referrals",
          "/p/",
          "/api/",
        ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
      })
  ) && privateMarkers.every((term) => !roleCachePayload.includes(term));
  check(
    "task-04 E2E-020 papéis e sessão expirada chegam ao destino canônico com copy neutra",
    namedRoleTransitions.length === 6
      && namedRoleTransitions.every(({ role, snapshot }) =>
        role === "missing-role"
          ? Number.isInteger(snapshot.generation)
            && snapshot.generation > 0
            && snapshot.maxOverlayCount === 1
          : snapshot.count === 1
      )
      && Number.isInteger(recruiterMissingRole.generation)
      && recruiterMissingRole.generation > 0
      && recruiterMissingRole.maxOverlayCount === 1
      && recruiterMissingRoleOutcome?.path === "/candidate"
      && recruiterMissingRoleOutcome?.candidate === 0
      && recruiterMissingRoleOutcome?.forbidden === 1
      && recruiterMissingRoleOutcome?.overlays === 0
      && /forbidden|403|access|acesso|proibid/i.test(recruiterMissingRoleOutcome?.body ?? "")
      && recruiterMissingRoleReload?.status === 403
      && recruiterMissingRoleReload?.terminal === 1
      && recruiterMissingRoleReload?.startup === 0
      && recruiterMissingRoleReload?.transitions === 0
      && recruiterMissingRoleReload?.locale === "en"
      && recruiterMissingRoleReload?.overflow <= 1
      && recruiterMissingRoleReload?.body.includes(en.routeStatus.forbiddenTitle)
      && recruiterMissingRoleReload?.body.includes(en.routeStatus.forbiddenBody)
      && recruiterMissingRoleReload?.backText === en.routeStatus.back
      && recruiterMissingRoleReload?.backHref === "/"
      && recruiterMissingRoleReload?.recoveryPath === "/jobs"
      && impersonationEntry.count === 1
      && impersonationExit.count === 1
      && roleNeutral
      && roleCacheIsolated,
    JSON.stringify({
      roles: namedRoleTransitions.map(({ role, snapshot }) => [role, snapshot.count]),
      missingRoleOutcome: recruiterMissingRoleOutcome,
      missingRoleReload: recruiterMissingRoleReload,
      roleNeutral,
      roleCacheIsolated,
    }),
  );
  const candidateUnscoredBoard = roleTransitionResults
    .find(({ email }) => email === "e2e-candidato@local.test")?.unscoredBoard;
  check(
    "#279 candidato sem nota vê as vagas sob o corte padrão, com aviso de nota pendente em inglês",
    (candidateUnscoredBoard?.total ?? 0) > 0
      && candidateUnscoredBoard?.notice === en.filterNotices.scores_pending
      && candidateUnscoredBoard?.cockpitNotice === en.filterNotices.scores_pending,
    JSON.stringify(candidateUnscoredBoard),
  );
  const candidateEmptyPipeline = roleTransitionResults
    .find(({ email }) => email === "e2e-candidato@local.test")?.emptyPipelineLocale;
  check(
    "BUG-20260823 funil vazio permanece integralmente em inglês após transição e recarga",
    candidateEmptyPipeline?.transition === 1
      && candidateEmptyPipeline?.emptyLink === 1
      && candidateEmptyPipeline.text.includes(en.pipeline.noApplications)
      && candidateEmptyPipeline.text.includes(en.pipeline.startWith)
      && candidateEmptyPipeline.text.includes(en.pipeline.jobsList)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.noApplications)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.startWith)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.jobsList)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.noApplications)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.startWith)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.jobsList)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.noApplications)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.startWith)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.jobsList),
    JSON.stringify(candidateEmptyPipeline),
  );
  check(
    "task-04 IT-013 tokens, papéis, sessão e impersonação chegam ao destino autorizado e liberam overlay",
    expiredResetForms === 0
      && consumedResetForms === 0
      && resetRacePosts.every((count) => count === 1)
      && expiredCallbackUrl === "/login?error=invalid"
      && replayCallbackUrl === "/login?error=invalid"
      && resetSoftTransition.count === 1
      // Ver `overlayCountFits`: o redirect volta para a mesma tela.
      && overlayCountFits(callbackSoftTransition)
      && roleTransitionResults.length === 2
      && roleTransitionResults.every(({ snapshot }) => snapshot.count === 1)
      && Number.isInteger(recruiterMissingRole.generation)
      && recruiterMissingRole.generation > 0
      && recruiterMissingRole.maxOverlayCount === 1
      && impersonationExit.count === 1
      && expiredSnapshot.count === 1
      && roleNeutral,
    JSON.stringify({
      expiredResetForms,
      consumedResetForms,
      resetRacePosts,
      expiredCallbackUrl,
      replayCallbackUrl,
      resetSoftTransition: resetSoftTransition.count,
      callbackSoftTransition: callbackSoftTransition.count,
      roleTransitionResults: roleTransitionResults.map(({ email, snapshot }) => [email, snapshot.count]),
      missingRoleTransition: roleTransitionResults.find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot?.count,
      impersonationExit: impersonationExit.count,
      expiredCount: expiredSnapshot.count,
      roleNeutral,
    }),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await resetTransitionDocument();
  await page.evaluate(() => window.next?.router?.prefetch?.("/transition-test"));
  await page.waitForTimeout(700);
  const fastStartedAt = await page.evaluate(() => performance.now());
  await routerPush("/transition-test");
  await transitionOverlay.waitFor({ state: "attached" });
  const fastSingleton = await transitionOverlay.count();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "leaving",
  );
  const fastLeavingAt = await page.evaluate(() => performance.now());
  await transitionOverlay.waitFor({ state: "detached" });
  const fastDuration = fastLeavingAt - fastStartedAt;
  check(
    "transition E2E-006 rota prefetched observa 180 ms sem herdar 900 ms",
    fastSingleton === 1
      && fastDuration >= 150
      && fastDuration < 900
      && (await page.locator('[data-testid="transition-test-destination"]').count()) === 1,
    `${Math.round(fastDuration)}ms · overlays=${fastSingleton}`,
  );

  await resetTransitionDocument();
  const prolongedStartedAt = await page.evaluate(() => performance.now());
  await routerPush("/transition-test?delay=prolonged");
  await transitionOverlay.waitFor({ state: "attached" });
  const normalCopy = await transitionOverlay.locator('[role="status"]').textContent();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "prolonged",
    undefined,
    { timeout: 5000 },
  );
  const prolongedAt = await page.evaluate(() => performance.now());
  const prolongedGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  const prolongedCopy = await transitionOverlay.locator('[role="status"]').textContent();
  const indeterminate =
    (await transitionOverlay.locator(".app-splash__barra").getAttribute("aria-valuenow")) === null;
  await page.waitForFunction(
    ({ generation, observedAt }) =>
      performance.now() - observedAt >= 400
      && Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation"))
        === generation,
    { generation: prolongedGeneration, observedAt: prolongedAt },
    { timeout: 2000 },
  );
  const prolongedStillAttached = (await transitionOverlay.count()) === 1;
  await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  check(
    "transition IT-003 + E2E-007 espera prolongada aguarda commit sem root streaming",
    normalCopy?.includes(ptBR.transition.loading) === true
      && prolongedCopy?.includes(ptBR.transition.prolonged) === true
      && prolongedAt - prolongedStartedAt >= 2900
      && indeterminate
      && prolongedStillAttached,
    `${Math.round(prolongedAt - prolongedStartedAt)}ms · attached=${prolongedStillAttached} · ${prolongedCopy}`,
  );

  await resetTransitionDocument();
  await routerPush("/transition-test?delay=race-old");
  await transitionOverlay.waitFor({ state: "attached" });
  const olderGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await routerPush("/transition-test?delay=race-new");
  await page.waitForFunction(
    (generation) =>
      Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation"))
        > generation,
    olderGeneration,
  );
  const newerGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await page.waitForTimeout(850);
  const newerStillOwns =
    (await transitionOverlay.count()) === 1
    && Number(await transitionOverlay.getAttribute("data-generation")) === newerGeneration;
  await page.waitForURL(/delay=race-new/);
  await transitionOverlay.waitFor({ state: "detached" });
  check(
    "transition E2E-008 conclusão antiga não encerra a geração nova",
    newerGeneration > olderGeneration && newerStillOwns,
    `${olderGeneration}→${newerGeneration}`,
  );

  const exerciseClientFailure = async (token) => {
    await resetTransitionDocument();
    await routerPush(`/transition-test?error=${encodeURIComponent(token)}`);
    await waitForState(transitionOverlay, "attached", `${token}: error navigation did not mount overlay`);
    await waitForState(transitionError, "visible", `${token}: error boundary did not become visible`);
    const failure = await transitionError.textContent();
    const released = await page.locator("#application-shell").evaluate((shell) => ({
      inert: shell.hasAttribute("inert"),
      busy: shell.getAttribute("aria-busy"),
    }));
    const body = (await page.locator("body").textContent()) ?? "";
    await page.locator('[data-testid="navigation-route-error-retry"]').click();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
    return {
      token,
      failure,
      released,
      rawVisible: ["TRANSITION_TEST_ROUTE_FAILURE", token, "[object Object]"]
        .some((value) => body.includes(value)),
      overlayAfterRetry: await transitionOverlay.count(),
    };
  };
  const clientFailures = [
    await exerciseClientFailure(`ordinary-${crypto.randomUUID()}`),
    await exerciseClientFailure(`unparseable-${crypto.randomUUID()}`),
  ];
  check(
    "transition E2E-009 falha comum e valor não parseável liberam overlay, redigem detalhe e aceitam retry",
    clientFailures.every(({ failure, released, rawVisible, overlayAfterRetry }) =>
      failure?.includes(ptBR.transition.failedTitle) === true
        && failure?.includes(ptBR.transition.failedBody) === true
        && failure?.includes(ptBR.transition.retry) === true
        && released.inert === false
        && released.busy === null
        && !rawVisible
        && overlayAfterRetry === 0
    ),
    JSON.stringify(clientFailures),
  );

  await resetTransitionDocument();
  await routerPush("/transition-test?delay=prolonged");
  await transitionOverlay.waitFor({ state: "attached" });
  const shellWhileBusy = await page.locator("#application-shell").evaluate((shell) => ({
    inert: shell.hasAttribute("inert"),
    busy: shell.getAttribute("aria-busy"),
  }));
  const liveStatus = transitionOverlay.locator('[role="status"][aria-live="polite"][aria-atomic="true"]');
  const statusCount = await liveStatus.count();
  const accessibilitySnapshot = await liveStatus.ariaSnapshot();
  // Lido junto com o snapshot: `statusBeforeTheme` vem depois de um clique e
  // de um Tab, e a fase `prolonged` (3 s) pode chegar no meio.
  const statusAtSnapshot = await liveStatus.textContent();
  const focusOutsideStatus = await transitionOverlay.evaluate((overlay) =>
    !overlay.contains(document.activeElement),
  );
  let underlyingBlocked = false;
  try {
    await page.locator('#application-shell a[href="/jobs"]').first().click({ timeout: 350 });
  } catch {
    underlyingBlocked = true;
  }
  await page.keyboard.press("Tab");
  const keyboardFocusWhileBusy = await page.evaluate(() => ({
    inApplicationShell: Boolean(document.activeElement?.closest("#application-shell")),
    inStatus: document.activeElement?.getAttribute("role") === "status",
  }));
  const generationBeforeTheme = Number(await transitionOverlay.getAttribute("data-generation"));
  const statusBeforeTheme = await transitionOverlay.locator('[role="status"]').textContent();
  // Trocar o tema não pode reiniciar a transição — quem prova isso é a
  // geração, que não muda. O texto pode AVANÇAR para o aviso de demora: a
  // fase `prolonged` chega aos 3 s pelo relógio, e as doze amostras abaixo
  // passam disso num runner de CI. Recuar ou mudar para outro texto reprova.
  const statusKept = (status) =>
    status === statusBeforeTheme || status === ptBR.transition.prolonged;
  const transitionContrastFailures = [];
  const systemModeEvidence = [];
  for (const theme of ["hp", "huly", "graphy"]) {
    for (const fixture of [
      { mode: "light", colorScheme: "light", label: "light" },
      { mode: "dark", colorScheme: "dark", label: "dark" },
      { mode: "system", colorScheme: "light", label: "system-light" },
      { mode: "system", colorScheme: "dark", label: "system-dark" },
    ]) {
      await page.emulateMedia({ colorScheme: fixture.colorScheme });
      const sample = await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        if (mode === "system") delete document.documentElement.dataset.mode;
        else document.documentElement.dataset.mode = mode;
        const overlay = document.querySelector('[data-testid="navigation-transition"]');
        const status = overlay?.querySelector('[role="status"]');
        return {
          count: document.querySelectorAll('[data-testid="navigation-transition"]').length,
          foreground: status ? getComputedStyle(status).color : "",
          background: overlay ? getComputedStyle(overlay).backgroundColor : "",
          modeAttribute: document.documentElement.getAttribute("data-mode"),
          prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
          generation: overlay?.getAttribute("data-generation") ?? null,
          status: status?.textContent ?? "",
        };
      }, { theme, mode: fixture.mode });
      const ratio = contrast(toRgb(sample.foreground), toRgb(sample.background));
      if (sample.count !== 1 || ratio < 4.5) {
        transitionContrastFailures.push(`${theme}/${fixture.label}:${ratio.toFixed(2)}`);
      }
      if (fixture.mode === "system") {
        systemModeEvidence.push({ theme, ...fixture, ...sample, ratio });
      }
    }
  }
  await page.emulateMedia({ colorScheme: null });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await transitionOverlay.evaluate((overlay) => {
    const brand = overlay.querySelector(".app-splash__marca");
    const sweep = overlay.querySelector(".app-splash__barra span");
    return {
      rootTransition: getComputedStyle(overlay).transitionDuration,
      brandAnimation: brand ? getComputedStyle(brand).animationName : null,
      sweepAnimation: sweep ? getComputedStyle(sweep).animationName : null,
      generation: overlay.getAttribute("data-generation"),
      status: overlay.querySelector('[role="status"]')?.textContent ?? "",
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "transition E2E-016 temas e movimento reduzido mudam sem reiniciar estado",
    transitionContrastFailures.length === 0
      && systemModeEvidence.length === 6
      && systemModeEvidence.every((sample) =>
        sample.modeAttribute === null
          && sample.prefersDark === (sample.colorScheme === "dark")
          && Number(sample.generation) === generationBeforeTheme
          && statusKept(sample.status)
      )
      && reducedMotion.rootTransition === "0s"
      && reducedMotion.brandAnimation === "none"
      && reducedMotion.sweepAnimation === "none"
      && Number(reducedMotion.generation) === generationBeforeTheme
      && statusKept(reducedMotion.status),
    JSON.stringify({ transitionContrastFailures, systemModeEvidence, reducedMotion }),
  );
  await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  const focusAfterTransition = await page.evaluate(() => ({
    inOverlay: Boolean(document.activeElement?.closest('[data-testid="navigation-transition"]')),
    role: document.activeElement?.getAttribute("role") ?? null,
  }));
  check(
    "transition E2E-015 saída não prende foco no status removido",
    !focusAfterTransition.inOverlay && focusAfterTransition.role !== "status",
    JSON.stringify(focusAfterTransition),
  );

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const keyboardControl = page.locator('[data-testid="nav-compare"]:visible').first();
  await keyboardControl.focus();
  const keyboardTransition = await observeNavigation(
    page,
    () => page.keyboard.press("Enter"),
    '[data-testid="route-compare"]',
    "keyboard navigation transition",
  );

  const touchCtx = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const touchPage = await touchCtx.newPage();
  await touchCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await touchPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await touchPage.fill('input[name="email"]', E2E_EMAIL);
  await touchPage.fill('input[name="password"]', E2E_PASSWORD);
  await touchPage.locator('[data-testid="login-submit"]').click();
  await touchPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await touchPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const mobileTriggerBox = await touchPage.locator('[data-testid="mobile-nav-trigger"]').boundingBox();
  if (!mobileTriggerBox) throw new Error("mobile navigation trigger has no touch target");
  await touchPage.touchscreen.tap(
    mobileTriggerBox.x + mobileTriggerBox.width / 2,
    mobileTriggerBox.y + mobileTriggerBox.height / 2,
  );
  const touchControl = touchPage.locator('[data-testid="mobile-nav-popover"] [data-testid="nav-compare"]');
  await touchControl.waitFor({ state: "visible" });
  const touchControlBox = await touchControl.boundingBox();
  if (!touchControlBox) throw new Error("mobile compare control has no touch target");
  const touchTransition = await observeNavigation(
    touchPage,
    () => touchPage.touchscreen.tap(
      touchControlBox.x + touchControlBox.width / 2,
      touchControlBox.y + touchControlBox.height / 2,
    ),
    '[data-testid="route-compare"]',
    "touch navigation transition",
  );
  const touchOverflow = await touchPage.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  await touchCtx.close();

  check(
    "transition E2E-015 árvore acessível, pointer, teclado e toque preservam um status e bloqueiam o shell",
    shellWhileBusy.inert
      && shellWhileBusy.busy === "true"
      && statusCount === 1
      && /status/i.test(accessibilitySnapshot)
      && Boolean(statusAtSnapshot)
      && accessibilitySnapshot.includes(statusAtSnapshot ?? "")
      && focusOutsideStatus
      && underlyingBlocked
      && !keyboardFocusWhileBusy.inApplicationShell
      && !keyboardFocusWhileBusy.inStatus
      && keyboardTransition.count === 1
      && touchTransition.count === 1
      && touchOverflow <= 1,
    JSON.stringify({
      shellWhileBusy,
      statusCount,
      accessibilitySnapshot,
      focusOutsideStatus,
      underlyingBlocked,
      keyboardFocusWhileBusy,
      keyboardTransition: keyboardTransition.count,
      touchTransition: touchTransition.count,
      touchOverflow,
    }),
  );

  for (const locale of ["pt-BR", "en"]) {
    const dictionary = locale === "pt-BR" ? ptBR : en;
    const opposite = locale === "pt-BR" ? en : ptBR;
    await resetTransitionDocument(locale);
    await routerPush("/transition-test?delay=race-new");
    await transitionOverlay.waitFor({ state: "attached" });
    const localizedNormal = (await transitionOverlay.locator('[role="status"]').textContent())?.trim();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
    );
    const localizedOffline = (await transitionOverlay.textContent()) ?? "";

    await resetTransitionDocument(locale);
    await routerPush("/transition-test?delay=prolonged");
    await transitionOverlay.waitFor({ state: "attached" });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "prolonged",
      undefined,
      { timeout: 5000 },
    );
    const localizedProlonged = (await transitionOverlay.locator('[role="status"]').textContent())?.trim();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
    await transitionOverlay.waitFor({ state: "detached" });
    check(
      `transition E2E-014 ${locale} normal, prolongado e offline usam só o dicionário ativo`,
      localizedNormal === dictionary.transition.loading
        && localizedProlonged === dictionary.transition.prolonged
        && localizedOffline?.includes(dictionary.transition.offlineTitle) === true
        && localizedOffline?.includes(dictionary.transition.offlineBody) === true
        && localizedOffline?.includes(dictionary.transition.retry) === true
        && !localizedNormal?.includes(opposite.transition.loading)
        && !localizedProlonged?.includes(opposite.transition.prolonged)
        && !localizedOffline.includes(opposite.transition.offlineTitle)
        && !localizedOffline.includes(opposite.transition.offlineBody)
        && !localizedOffline.includes(opposite.transition.retry),
      JSON.stringify({ localizedNormal, localizedProlonged, localizedOffline }),
    );

    await resetTransitionDocument(locale);
    const token = crypto.randomUUID();
    await routerPush(`/transition-test?error=${token}`);
    await transitionError.waitFor({ state: "visible" });
    const localizedFailure = (await transitionError.textContent()) ?? "";
    check(
      `transition E2E-014 ${locale} falha usa somente o dicionário ativo`,
      localizedFailure?.includes(dictionary.transition.failedTitle) === true
        && localizedFailure?.includes(dictionary.transition.failedBody) === true
        && localizedFailure?.includes(dictionary.transition.retry) === true
        && !localizedFailure.includes(opposite.transition.failedTitle)
        && !localizedFailure.includes(opposite.transition.failedBody)
        && !localizedFailure.includes(opposite.transition.retry),
      localizedFailure ?? "",
    );
    await page.locator('[data-testid="navigation-route-error-retry"]').click();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  }

  const zoomCdp = await page.context().newCDPSession(page);
  const zoomEvidence = [];
  for (const fixture of [
    { label: "desktop", physicalWidth: 1280, physicalHeight: 900, safe: [0, 0, 0, 0] },
    { label: "mobile", physicalWidth: 375, physicalHeight: 812, safe: [47, 20, 34, 44] },
  ]) {
    await page.setViewportSize({ width: fixture.physicalWidth, height: fixture.physicalHeight });
    const cssWidth = Math.ceil(fixture.physicalWidth / 2);
    const cssHeight = Math.ceil(fixture.physicalHeight / 2);
    await zoomCdp.send("Emulation.setDeviceMetricsOverride", {
      width: cssWidth,
      height: cssHeight,
      deviceScaleFactor: 2,
      mobile: false,
      screenWidth: fixture.physicalWidth,
      screenHeight: fixture.physicalHeight,
    });
    await resetTransitionDocument("en");
    await routerPush("/transition-test?delay=race-new");
    await transitionOverlay.waitFor({ state: "attached" });
    await page.evaluate(([top, right, bottom, left]) => {
      const root = document.documentElement.style;
      root.setProperty("--safe-area-top", `${top}px`);
      root.setProperty("--safe-area-right", `${right}px`);
      root.setProperty("--safe-area-bottom", `${bottom}px`);
      root.setProperty("--safe-area-left", `${left}px`);
      window.dispatchEvent(new Event("offline"));
    }, fixture.safe);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
    );
    await transitionOverlay.locator('[role="status"] p').evaluate((paragraph) => {
      paragraph.textContent = `${paragraph.textContent} ${paragraph.textContent}`;
    });
    const sample = await transitionOverlay.evaluate((overlay) => {
      const root = overlay.getBoundingClientRect();
      const contentElement = overlay.querySelector(".navigation-transition__content");
      const content = contentElement?.getBoundingClientRect();
      const status = overlay.querySelector('[role="status"] p');
      const style = getComputedStyle(overlay);
      const statusStyle = status ? getComputedStyle(status) : null;
      return {
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: window.screen.width, height: window.screen.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        visualViewport: window.visualViewport
          ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              scale: window.visualViewport.scale,
            }
          : null,
        root: { top: root.top, right: root.right, bottom: root.bottom, left: root.left },
        content: content
          ? { top: content.top, right: content.right, bottom: content.bottom, left: content.left }
          : null,
        padding: {
          top: Number.parseFloat(style.paddingTop),
          right: Number.parseFloat(style.paddingRight),
          bottom: Number.parseFloat(style.paddingBottom),
          left: Number.parseFloat(style.paddingLeft),
        },
        touchAction: style.touchAction,
        status: status
          ? {
              clientWidth: status.clientWidth,
              scrollWidth: status.scrollWidth,
              scrollHeight: status.scrollHeight,
              lineHeight: Number.parseFloat(statusStyle?.lineHeight ?? "0"),
              text: status.textContent ?? "",
            }
          : null,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    zoomEvidence.push({ ...fixture, cssWidth, cssHeight, sample });
  }
  await zoomCdp.send("Emulation.clearDeviceMetricsOverride");
  check(
    "transition E2E-017 desktop e mobile em zoom Chromium 200%, safe area e copy longa permanecem contidos",
    zoomEvidence.length === 2
      && zoomEvidence.every(({ cssWidth, cssHeight, safe, sample }) =>
        sample.devicePixelRatio === 2
          && sample.viewport.width === cssWidth
          && sample.viewport.height === cssHeight
          && sample.root.top === 0
          && sample.root.left === 0
          && sample.root.right === cssWidth
          && sample.root.bottom === cssHeight
          && sample.content?.left >= safe[3]
          && sample.content?.right <= cssWidth - safe[1]
          && sample.padding.top >= safe[0]
          && sample.padding.right >= safe[1]
          && sample.padding.bottom >= safe[2]
          && sample.padding.left >= safe[3]
          && sample.touchAction === "auto"
          && sample.status?.text.split(" ").length > 12
          && sample.status.scrollWidth <= sample.status.clientWidth
          && sample.status.scrollHeight > sample.status.lineHeight
          && sample.scrollWidth <= cssWidth
      ),
    JSON.stringify(zoomEvidence),
  );
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
}
