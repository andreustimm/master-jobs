// Área de regressão da aba antiga após logout em outra aba (#399).

const ROLE_SCENARIOS = [
  {
    role: "candidato",
    email: "e2e-candidato@local.test",
    startPath: "/candidate",
    menuTarget: "nav-jobs",
    landsAfterLogin: "/",
  },
  {
    role: "recrutador",
    email: "e2e-recrutador@local.test",
    startPath: "/jobs",
    menuTarget: "nav-account",
    landsAfterLogin: "/jobs",
  },
];

async function signIn(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole } = ctx;

  for (const scenario of ROLE_SCENARIOS) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const logoutPage = await context.newPage();
    const stalePage = await context.newPage();
    trackConsole(logoutPage);
    trackConsole(stalePage);

    let reloginPath = "";
    let reloginError = "";
    try {
      await signIn(logoutPage, BASE, scenario.email, E2E_PASSWORD);
      await stalePage.goto(`${BASE}${scenario.startPath}`, { waitUntil: "networkidle" });
      await logoutPage.locator('[data-testid="sign-out"]').click();
      await logoutPage.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });

      await stalePage.locator('[data-testid="mobile-nav-trigger"]').click();
      await stalePage.locator('[data-testid="mobile-nav-popover"] [data-testid="' + scenario.menuTarget + '"]').click();
      await stalePage.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
      await stalePage.locator('[data-testid="route-login"]').waitFor({ state: "visible", timeout: 10_000 });

      const staleState = await stalePage.evaluate(() => ({
        shellInert: document.getElementById("application-shell")?.hasAttribute("inert") ?? false,
        transitionOverlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
        loginForm: Boolean(document.querySelector('[data-testid="route-login"] input[name="email"]')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));

      await stalePage.fill('input[name="email"]', scenario.email);
      await stalePage.fill('input[name="password"]', E2E_PASSWORD);
      await stalePage.locator('[data-testid="login-submit"]').click();
      await stalePage.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
      reloginPath = new URL(stalePage.url()).pathname;

      check(
        `${scenario.role}: aba antiga libera o login em 375px e permite novo acesso`,
        !staleState.shellInert
          && staleState.transitionOverlays === 0
          && staleState.loginForm
          && staleState.overflow <= 1
          && reloginPath === scenario.landsAfterLogin,
        JSON.stringify({ ...staleState, reloginPath }),
      );
    } catch (error) {
      reloginError = error instanceof Error ? error.message : String(error);
      check(
        `${scenario.role}: aba antiga libera o login em 375px e permite novo acesso`,
        false,
        reloginError.slice(0, 240),
      );
    } finally {
      await context.close();
    }
  }
}
