// Área `account-methods` do E2E de navegador: formas de entrar da conta, por
// papel (#464, task_04, G16) — ligar e desligar provedor, primeira senha,
// lista de métodos e termos aceitos, e o admin desligando provedor alheio.
//
// Contas próprias (`account-methods-fixtures.mjs`), devolvidas ao estado
// inicial por `setup.mjs` a cada execução; cada cenário em contexto próprio.
// O provedor é o emissor OIDC falso do `run-isolated` (ADR-010).
import { and, eq } from "drizzle-orm";
import { setRemoteBehavior } from "../fake-oidc.mjs";
import { METHODS_FIXTURES } from "../account-methods-fixtures.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  const fake = process.env.E2E_FAKE_OIDC;
  if (!fake) {
    console.warn("[e2e] account-methods pulada: E2E_FAKE_OIDC ausente (rode pelo run-isolated)");
    return;
  }
  const [{ getDb }, { authEvent, authIdentity, authUser }] = await Promise.all([
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
  ]);

  async function fresh(viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    trackConsole(page);
    return { context, page };
  }

  async function passwordLogin(page, email, password = E2E_PASSWORD) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
  }

  async function socialLogin(page, provider, behavior) {
    await setRemoteBehavior(fake, provider, behavior);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.locator(`[data-testid="social-${provider}"]`).click();
    await page.waitForURL((url) => url.origin === BASE && !url.pathname.startsWith("/login"), { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
  }

  async function openAccount(page) {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
  }

  const text = async (page, testId) =>
    ((await page.locator(`[data-testid="${testId}"]`).first().textContent().catch(() => "")) ?? "").trim();
  const linked = async (page, provider) =>
    page.locator(`[data-testid="account-method-${provider}"]`).getAttribute("data-linked").catch(() => null);

  async function identitiesOf(email) {
    const [user] = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
    return getDb()
      .select({ provider: authIdentity.provider, origin: authIdentity.origin, subject: authIdentity.subject })
      .from(authIdentity)
      .where(eq(authIdentity.userId, user.id));
  }

  /* ----------------- E2E-016/E2E-017: ligar e desligar o Google ------------ */

  {
    const owner = METHODS_FIXTURES.owner;
    const { context, page } = await fresh();
    await passwordLogin(page, owner.email);
    await openAccount(page);
    const before = await linked(page, "google");

    await setRemoteBehavior(fake, "google", { sub: owner.googleSubject, email: "pessoal-do-dono@gmail.test" });
    await page.locator('[data-testid="account-connect-google"]').click();
    await page.waitForURL((url) => url.pathname === "/account" && url.searchParams.get("linked") === "google", {
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle");
    const notice = await text(page, "account-provider-status");
    // Sobrevive a refresh: o vínculo é do banco, não da URL.
    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await linked(page, "google");
    const lastUsed = await text(page, "account-method-google-last-used");
    const rows = await identitiesOf(owner.email);
    check(
      "E2E-016 'Conectar Google' na conta liga o Google (manual) e a tela mostra ligado depois do refresh",
      before === "false"
        && /Google ligado/.test(notice)
        && afterReload === "true"
        && lastUsed === "Último uso: nunca"
        && rows.length === 1
        && rows[0].origin === "manual"
        && rows[0].subject === owner.googleSubject,
      JSON.stringify({ before, notice, afterReload, lastUsed, rows }),
    );

    // Cancelar no consentimento volta à conta sem mudar nada.
    await setRemoteBehavior(fake, "linkedin", { mode: "cancel" });
    await page.locator('[data-testid="account-connect-linkedin"]').click();
    await page.waitForURL((url) => url.pathname === "/account" && url.searchParams.get("error") === "cancelled", {
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle");
    const cancelled = await text(page, "account-provider-status");
    check(
      "E2E-016 cancelar no provedor volta à conta sem mudança",
      /Ligação cancelada/.test(cancelled)
        && (await linked(page, "linkedin")) === "false"
        && (await identitiesOf(owner.email)).length === 1,
      cancelled,
    );

    // Desligar com senha definida: some, com o aviso de religação.
    await page.locator('[data-testid="account-disconnect-google"]').click();
    await page.waitForURL((url) => url.searchParams.get("unlinked") === "google", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const unlinked = await text(page, "account-provider-status");
    check(
      "E2E-017 desligar o Google com senha definida: some, com o aviso de que entrar de novo religa",
      /Google desligado/.test(unlinked)
        && /religa automaticamente/.test(unlinked)
        && (await linked(page, "google")) === "false"
        && (await identitiesOf(owner.email)).length === 0,
      unlinked,
    );
    await context.close();
  }

  /* --------- E2E-020, E2E-017 (último método), E2E-018: conta só social ---- */

  {
    const social = METHODS_FIXTURES.socialOnly;
    const { context, page } = await fresh();
    await socialLogin(page, "linkedin", { sub: social.identities[0].subject, email: social.email });
    await openAccount(page);
    const password = await text(page, "account-method-password");
    const linkedinRow = await text(page, "account-method-linkedin");
    const lastUsed = await text(page, "account-method-linkedin-last-used");
    const terms = await text(page, "account-terms-versions");
    check(
      "E2E-020 a conta lista senha, provedores com data, origem e último uso, e as versões dos termos aceitos",
      /Não definida/.test(password)
        && /Ligado em/.test(linkedinRow)
        && /automaticamente pelo e-mail verificado/.test(linkedinRow)
        && /^Último uso: /.test(lastUsed) && !/nunca/.test(lastUsed)
        && (await linked(page, "google")) === "false"
        && /versão 2026-10-06/.test(terms)
        && /aceitos em/.test(terms),
      JSON.stringify({ password, linkedinRow, lastUsed, terms }),
    );

    await page.locator('[data-testid="account-disconnect-linkedin"]').click();
    await page.waitForURL((url) => url.searchParams.get("status") === "unlink-last_method", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const refused = await text(page, "account-status");
    const refusedRole = await page.locator('[data-testid="account-status"]').getAttribute("role").catch(() => null);
    check(
      "E2E-017 conta só com LinkedIn não desliga a última forma de entrar",
      /Defina uma senha ou conecte outro provedor/.test(refused)
        && refusedRole === "alert"
        && (await linked(page, "linkedin")) === "true"
        && (await identitiesOf(social.email)).length === 1,
      JSON.stringify({ refused, refusedRole }),
    );

    const FIRST = "primeira-senha-do-e2e-77";
    await page.fill("#account-first", FIRST);
    await page.fill("#account-first-confirm", FIRST);
    await page.locator('[data-testid="account-set-password"]').click();
    await page.waitForURL((url) => url.searchParams.get("status") === "first-password-set", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const stillIn = (await page.locator('[data-testid="route-account"]').count()) === 1;
    await context.close();

    const second = await fresh();
    await passwordLogin(second.page, social.email, FIRST);
    check(
      "E2E-018 conta só social define a primeira senha, continua dentro e entra com e-mail e senha",
      stillIn && !new URL(second.page.url()).pathname.startsWith("/login"),
      JSON.stringify({ stillIn, landed: second.page.url().replace(BASE, "") }),
    );
    await second.context.close();
  }

  /* ---------------- E2E-019: o admin vê e desliga o provedor --------------- */

  {
    const target = METHODS_FIXTURES.adminTarget;
    const { context, page } = await fresh();
    await passwordLogin(page, E2E_EMAIL);
    await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    const row = page.locator("main ul > li").filter({ hasText: target.email });
    const shown = {
      google: await row.locator('[data-testid="user-method-google"]').count(),
      password: await row.locator('[data-testid="user-method-password"]').count(),
    };
    await row.locator('[data-testid="user-disconnect-google"]').click();
    await page.locator('[data-testid="mutation-feedback"]').waitFor({ timeout: 15_000 }).catch(() => {});
    const feedback = await text(page, "mutation-feedback");
    await page.reload({ waitUntil: "networkidle" });
    const gone = (await row.locator('[data-testid="user-method-google"]').count()) === 0;
    const [user] = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, target.email));
    const events = await getDb()
      .select({ detail: authEvent.detail })
      .from(authEvent)
      .where(and(eq(authEvent.kind, "identity_unlinked"), eq(authEvent.userId, user.id)));
    await context.close();

    const owner = await fresh();
    await passwordLogin(owner.page, target.email);
    await openAccount(owner.page);
    const ownerSees = await linked(owner.page, "google");
    check(
      "E2E-019 o admin vê os provedores e a senha de cada conta, desliga o Google e a dona vê que sumiu",
      shown.google === 1
        && shown.password === 1
        && /Provedor desligado/.test(feedback)
        && gone
        && ownerSees === "false"
        && events.some((event) => event.detail?.includes(`admin ${E2E_EMAIL.trim().toLowerCase()}`)),
      JSON.stringify({ shown, feedback, gone, ownerSees, events }),
    );
    await owner.context.close();
  }

  /* ------------- E2E-021: admin entra pelo Google e segue admin ------------ */

  {
    const admin = METHODS_FIXTURES.socialAdmin;
    const { context, page } = await fresh();
    await socialLogin(page, "google", { sub: admin.identities[0].subject, email: admin.email });
    const menu = await page.locator('[data-testid="nav-admin-users"]').count();
    await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    const adminPage = await page.locator('[data-testid="route-admin-users"]').count();
    check(
      "E2E-021 conta admin entra pelo Google e continua com o menu e a tela de administração",
      menu >= 1 && adminPage === 1,
      JSON.stringify({ menu, adminPage, url: page.url().replace(BASE, "") }),
    );
    await context.close();
  }

  /* ------------------------- 375 px (regra 11) ----------------------------- */

  {
    const { context, page } = await fresh({ width: 375, height: 812 });
    await passwordLogin(page, METHODS_FIXTURES.owner.email);
    await openAccount(page);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      methods: document.querySelector('[data-testid="account-methods"]') !== null,
    }));
    check(
      "Minha conta com as formas de entrar em 375 px: sem rolagem horizontal",
      layout.methods && layout.overflow <= 0,
      JSON.stringify(layout),
    );
    await context.close();
  }
}
