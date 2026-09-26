// Área `account` do E2E de navegador: Minha conta: trocar a própria senha (#236).
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  /* ------------------ Minha conta: trocar a própria senha (#236) ----------- */

  // Conta dedicada: trocar a senha de uma conta compartilhada quebraria os
  // logins das outras jornadas. Duas sessões da mesma conta, e a troca feita
  // numa delas precisa derrubar a outra e manter quem pediu.
  {
    const ACCOUNT_EMAIL = "e2e-conta@local.test";
    const NEW_PASSWORD = "conta-trocada-pelo-e2e-43";
    const openSession = async () => {
      const ctx = await browser.newContext();
      const tab = await ctx.newPage();
      trackConsole(tab);
      await ctx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
      await tab.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await tab.fill('input[name="email"]', ACCOUNT_EMAIL);
      await tab.fill('input[name="password"]', E2E_PASSWORD);
      await tab.locator('[data-testid="login-submit"]').click();
      await tab.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
      return { ctx, tab };
    };
    const first = await openSession();
    const second = await openSession();

    await first.tab.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await first.tab.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    await first.tab.fill('input[name="currentPassword"]', "senha-errada-do-e2e-99");
    await first.tab.fill('input[name="newPassword"]', NEW_PASSWORD);
    await first.tab.fill('input[name="confirmPassword"]', NEW_PASSWORD);
    await first.tab.locator('[data-testid="account-change-password"]').click();
    await first.tab.waitForSelector('[data-testid="account-status"]', { timeout: 15_000 }).catch(() => {});
    const wrongStatus = await first.tab.locator('[data-testid="account-status"]').getAttribute("role").catch(() => null);
    check("Minha conta: senha atual errada é recusada com alerta", wrongStatus === "alert", String(wrongStatus));

    await first.tab.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await first.tab.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    await first.tab.fill('input[name="currentPassword"]', E2E_PASSWORD);
    await first.tab.fill('input[name="newPassword"]', NEW_PASSWORD);
    await first.tab.fill('input[name="confirmPassword"]', NEW_PASSWORD);
    await first.tab.locator('[data-testid="account-change-password"]').click();
    await first.tab.waitForURL((url) => url.searchParams.get("status") === "password-changed", { timeout: 15_000 })
      .catch(() => {});
    // Sobrevive a refresh: a sessão nova gravada no cookie é a que vale.
    await first.tab.reload({ waitUntil: "networkidle" });
    const stillIn = new URL(first.tab.url()).pathname === "/account"
      && (await first.tab.locator('[data-testid="route-account"]').count()) === 1;
    const otherResponse = await second.tab.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    const otherOut = new URL(second.tab.url()).pathname.startsWith("/login");
    check(
      "Minha conta: trocar a senha mantém quem pediu e derruba a outra sessão",
      stillIn && otherOut,
      JSON.stringify({ stillIn, otherOut, other: otherResponse?.status(), url: second.tab.url() }),
    );

    await second.tab.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await second.tab.fill('input[name="email"]', ACCOUNT_EMAIL);
    await second.tab.fill('input[name="password"]', NEW_PASSWORD);
    await second.tab.locator('[data-testid="login-submit"]').click();
    await second.tab.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
    check(
      "Minha conta: a senha nova entra",
      !new URL(second.tab.url()).pathname.startsWith("/login"),
      second.tab.url(),
    );
    await first.ctx.close();
    await second.ctx.close();
  }

  // Conta desabilitada não entra, mesmo com a senha certa.
  const offCtx = await browser.newContext();
  const offPage = await offCtx.newPage();
  await offCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await offPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await offPage.fill('input[name="email"]', "e2e-desabilitada@local.test");
  await offPage.fill('input[name="password"]', E2E_PASSWORD);
  await offPage.locator('[data-testid="login-submit"]').click();
  await offPage.waitForTimeout(1500);
  check(
    "conta desabilitada não entra nem com a senha certa",
    offPage.url().includes("/login"),
    offPage.url().replace(BASE, ""),
  );
  await offCtx.close();
}
