// Área `navigation` do E2E de navegador: Splash de transição: menus do candidato no desktop e no celular.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { transitionHelpers } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, TRANSITION_CENTER_TOLERANCE_PX, browser, check, trackConsole } = ctx;
  const { observeNavigation } = transitionHelpers(ctx);
  /* ------------ Task 04: first-party inventory and canonical flows -------- */
  const candidateMenuCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await candidateMenuCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const candidateMenuPage = await candidateMenuCtx.newPage();
  trackConsole(candidateMenuPage);
  await candidateMenuPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await candidateMenuPage.fill('input[name="email"]', "e2e-candidato@local.test");
  await candidateMenuPage.fill('input[name="password"]', E2E_PASSWORD);
  await candidateMenuPage.locator('[data-testid="login-submit"]').click();
  await candidateMenuPage.waitForURL((url) => !url.pathname.startsWith("/login"));

  const candidateDestinations = [
    ["nav-logo", "route-cockpit"],
    ["nav-jobs", "route-jobs"],
    ["nav-compare", "route-compare"],
    ["nav-pipeline", "route-pipeline"],
    ["nav-referrals", "route-referrals"],
    ["nav-candidate", "route-candidate"],
  ];
  const desktopFailures = [];
  const desktopIntegrationEvidence = [];
  for (const [control, destination] of candidateDestinations) {
    const source = control === "nav-jobs" ? "/compare" : "/jobs";
    await candidateMenuPage.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    const snapshot = await observeNavigation(
      candidateMenuPage,
      () => candidateMenuPage.locator(`[data-testid="${control}"]:visible`).first().click(),
      `[data-testid="${destination}"]`,
    );
    desktopIntegrationEvidence.push(snapshot);
    const centered = snapshot.visibleRect !== null
      && Math.abs(snapshot.visibleRect.left + snapshot.visibleRect.width / 2 - snapshot.viewport.width / 2) <= TRANSITION_CENTER_TOLERANCE_PX
      && Math.abs(snapshot.visibleRect.top + snapshot.visibleRect.height / 2 - snapshot.viewport.height / 2) <= TRANSITION_CENTER_TOLERANCE_PX;
    if (
      snapshot.count !== 1 ||
      snapshot.rect.left !== 0 ||
      snapshot.rect.top !== 0 ||
      Math.round(snapshot.rect.width) !== snapshot.viewport.width ||
      Math.round(snapshot.rect.height) !== snapshot.viewport.height ||
      snapshot.style?.position !== "fixed" ||
      snapshot.style?.display !== "flex" ||
      snapshot.style?.alignItems !== "center" ||
      !snapshot.style?.justifyContent?.includes("center") ||
      snapshot.contentStyle?.display !== "flex" ||
      snapshot.contentStyle?.flexDirection !== "column" ||
      snapshot.contentStyle?.alignItems !== "center" ||
      snapshot.contentStyle?.textAlign !== "center" ||
      !centered
    ) {
      desktopFailures.push(`${control}:${JSON.stringify(snapshot)}`);
    }
  }
  check(
    "task-04 E2E-001 menu desktop do candidato cobre todos os destinos permitidos com um splash full-screen",
    desktopFailures.length === 0
      && (await candidateMenuPage.locator('[data-testid="nav-admin-users"]').count()) === 0,
    desktopFailures.slice(0, 2).join(" | "),
  );
  check(
    "task-04 IT-002 Link real e router hook coalescem em uma geração observável",
    desktopIntegrationEvidence.length === candidateDestinations.length
      && desktopIntegrationEvidence.every(({ count, generation, phase, transitionEvidence }) =>
        count === 1
          && generation === 1
          && phase === "loading"
          && transitionEvidence.filter((state) =>
            state.generation === 1 && state.phase === "loading"
          ).length === 1
      ),
    JSON.stringify(desktopIntegrationEvidence.map(({ count, generation, phase, transitionEvidence }) => ({
      count,
      generation,
      phase,
      transitionEvidence,
    }))),
  );

  await candidateMenuPage.setViewportSize({ width: 375, height: 812 });
  const mobileFailures = [];
  for (const [control, destination] of candidateDestinations.filter(([name]) => name !== "nav-logo")) {
    const source = control === "nav-jobs" ? "/compare" : "/jobs";
    await candidateMenuPage.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    await candidateMenuPage.locator('[data-testid="mobile-nav-trigger"]').click();
    const popover = candidateMenuPage.locator('[data-testid="mobile-nav-popover"]');
    await popover.waitFor({ state: "visible" });
    const snapshot = await observeNavigation(
      candidateMenuPage,
      () => popover.locator(`[data-testid="${control}"]`).click(),
      `[data-testid="${destination}"]`,
    );
    const result = await candidateMenuPage.evaluate(() => ({
      popoverOpen: document.querySelector('[data-testid="mobile-nav-popover"]')?.matches(":popover-open"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const centered = snapshot.visibleRect !== null
      && Math.abs(snapshot.visibleRect.left + snapshot.visibleRect.width / 2 - snapshot.viewport.width / 2) <= TRANSITION_CENTER_TOLERANCE_PX
      && Math.abs(snapshot.visibleRect.top + snapshot.visibleRect.height / 2 - snapshot.viewport.height / 2) <= TRANSITION_CENTER_TOLERANCE_PX;
    if (
      snapshot.count !== 1 ||
      snapshot.style?.position !== "fixed" ||
      snapshot.style?.display !== "flex" ||
      snapshot.style?.alignItems !== "center" ||
      !snapshot.style?.justifyContent?.includes("center") ||
      snapshot.contentStyle?.display !== "flex" ||
      snapshot.contentStyle?.flexDirection !== "column" ||
      snapshot.contentStyle?.alignItems !== "center" ||
      snapshot.contentStyle?.textAlign !== "center" ||
      !centered ||
      result.popoverOpen ||
      result.overflow > 1
    ) {
      mobileFailures.push(`${control}:${JSON.stringify({ snapshot, result })}`);
    }
  }
  check(
    "task-04 E2E-002 menu móvel fecha antes do destino e mantém paridade sem overflow",
    mobileFailures.length === 0,
    mobileFailures.slice(0, 2).join(" | "),
  );
  await candidateMenuCtx.close();
}
