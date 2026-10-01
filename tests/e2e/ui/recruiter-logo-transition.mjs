// Logo do topo para recrutador (#436): "/" redireciona para "/jobs", uma URL
// diferente do alvo da transição. A fronteira de commit só aceita o próprio
// alvo, então, por leitura do código, a geração podia ficar sem liberação e o
// splash prender a tela. Medido num build de produção local, isso não ocorre:
// o overlay entra e sai em cerca de meio segundo nos quatro casos abaixo. O
// teste fica como cobertura; numa falha, `timeline` no detalhe mostra o ciclo observado.

const RECRUITER = "e2e-recrutador@local.test";
const VIEWPORTS = [
  { label: "1280px", width: 1280, height: 800 },
  { label: "375px", width: 375, height: 812 },
];
// Mesma tela (pathname não muda) e troca de tela (pathname muda): o redirect
// cai em "/jobs" nos dois casos, mas o observador de commit reage diferente.
const STARTS = [
  { label: "a partir de /jobs", path: "/jobs" },
  { label: "a partir de /account", path: "/account" },
];
// Bem acima do mínimo (180ms) + esmaecimento (260ms) e abaixo do "prolongado"
// (3s) somado ao tempo de rede: o splash preso permanece indefinidamente.
const SETTLE_MS = 6_000;

async function signIn(page, base, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', RECRUITER);
  await page.fill('input[name="password"]', password);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole } = ctx;

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    trackConsole(page);
    try {
      await signIn(page, BASE, E2E_PASSWORD);
      for (const start of STARTS) {
        const name = `recrutador: logo do topo leva a /jobs sem splash preso em ${viewport.label}, ${start.label}`;
        try {
          await page.goto(`${BASE}${start.path}`, { waitUntil: "networkidle" });
          // Registra o ciclo do overlay desde o clique: sem isso um teste
          // verde poderia ser só uma transição que nunca começou.
          await page.evaluate(() => {
            const log = { startedAt: performance.now(), seenAt: null, goneAt: null, phases: [] };
            window.__logoTransition = log;
            const tick = () => {
              const overlay = document.querySelector('[data-testid="navigation-transition"]');
              if (overlay && log.seenAt === null) log.seenAt = performance.now() - log.startedAt;
              if (overlay) {
                const phase = overlay.getAttribute("data-phase");
                if (log.phases.at(-1) !== phase) log.phases.push(phase);
              }
              if (!overlay && log.seenAt !== null && log.goneAt === null) log.goneAt = performance.now() - log.startedAt;
              if (log.goneAt === null) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          await page.locator('[data-testid="nav-logo"]:visible').first().click();
          await page.waitForURL((url) => url.pathname === "/jobs", { timeout: 20_000 });
          await page.locator('[data-testid="route-jobs"]').waitFor({ state: "visible", timeout: 10_000 });

          let released = true;
          try {
            await page.waitForFunction(
              () =>
                document.querySelectorAll('[data-testid="navigation-transition"]').length === 0
                && !document.getElementById("application-shell")?.hasAttribute("inert")
                && document.getElementById("application-shell")?.getAttribute("aria-busy") !== "true",
              undefined,
              { timeout: SETTLE_MS },
            );
          } catch {
            released = false;
          }
          const state = await page.evaluate(() => ({
            path: location.pathname,
            overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
            shellInert: document.getElementById("application-shell")?.hasAttribute("inert") ?? false,
            shellBusy: document.getElementById("application-shell")?.getAttribute("aria-busy") ?? null,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            timeline: window.__logoTransition,
          }));
          check(
            name,
            released && state.path === "/jobs" && state.overlays === 0 && !state.shellInert && state.shellBusy === null && state.overflow <= 1,
            JSON.stringify(state),
          );
        } catch (error) {
          check(name, false, (error instanceof Error ? error.message : String(error)).slice(0, 240));
        }
      }
    } catch (error) {
      check(
        `recrutador: logo do topo em ${viewport.label}: preparação`,
        false,
        (error instanceof Error ? error.message : String(error)).slice(0, 240),
      );
    } finally {
      await context.close();
    }
  }
}
