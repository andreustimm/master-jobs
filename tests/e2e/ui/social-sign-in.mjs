// Área `social-sign-in` do E2E de navegador: login com Google e LinkedIn contra
// o emissor OIDC falso do `run-isolated` (#464, ADR-010), por papel (G16).
//
// Cada cenário abre um contexto próprio: o login social grava cookie de sessão,
// e a sessão compartilhada (`ctx.page`) precisa continuar sendo a do dono.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { setRemoteBehavior } from "../fake-oidc.mjs";
import { SOCIAL_FIXTURES } from "../social-fixtures.mjs";

/** Uma vaga que existe em toda execução (`setup.mjs`), para o deep link. */
const DEEP_LINK = "/jobs/904000103";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("sem porta para o servidor secundário");
  return address.port;
}

/**
 * Sobe outra instância do MESMO build com outra configuração (E2E-022/023).
 * Variável com valor `""` sai do ambiente — é assim que um provedor fica sem
 * credencial.
 */
async function withServer(envPatch, use) {
  const serverJs = process.env.E2E_STANDALONE_SERVER;
  if (!serverJs) throw new Error("E2E_STANDALONE_SERVER ausente: rode pelo run-isolated");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, JHO_PUBLIC_URL: base, ...envPatch, HOSTNAME: "127.0.0.1", PORT: String(port) };
  for (const [name, value] of Object.entries(env)) if (value === "") delete env[name];
  const child = spawn(process.execPath, [serverJs], { cwd: dirname(serverJs), env, stdio: "ignore" });
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error("servidor secundário saiu antes de responder");
      try {
        const response = await fetch(`${base}/login`, { redirect: "manual" });
        if (response.status > 0) break;
      } catch {
        // Ainda subindo.
      }
      if (Date.now() > deadline) throw new Error("servidor secundário não respondeu em 20 s");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await use(base);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

export async function run(ctx) {
  const { BASE, browser, check, trackConsole } = ctx;
  const fake = process.env.E2E_FAKE_OIDC;
  if (!fake) {
    // Fora do `run-isolated` (`test:e2e:external`) não há emissor falso, e o
    // servidor alvo nem o aceitaria fora de `JHO_ENV=e2e`. Como a área de
    // foto e capa sem MinIO: avisa, sem fingir que provou.
    console.warn("[e2e] social-sign-in pulada: E2E_FAKE_OIDC ausente (rode pelo run-isolated)");
    return;
  }
  const [{ and, eq }, { getDb }, { authIdentity, authSignup, authUser }] = await Promise.all([
    import("drizzle-orm"),
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

  /** Clica no botão do provedor em `/login` e espera o fim do fluxo, onde quer que caia. */
  async function continueWith(page, provider, behavior, startPath = "/login") {
    await setRemoteBehavior(fake, provider, behavior);
    await page.goto(`${BASE}${startPath}`, { waitUntil: "networkidle" });
    await page.locator(`[data-testid="social-${provider}"]`).click();
    await page.waitForURL((url) => url.origin === BASE && !url.pathname.startsWith("/login/oauth"), {
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle");
  }

  const errorText = async (page) =>
    ((await page.locator('[data-testid="login-error"]').textContent().catch(() => "")) ?? "").trim();
  const hasSession = async (context) =>
    (await context.cookies()).some((cookie) => cookie.name === "jho_session");

  /* ------------------------- Entrar por papel (G16) ------------------------ */

  let replayCallback = null;
  {
    const { context, page } = await fresh();
    // Guarda a URL do retorno para provar depois que ela não vale de novo.
    page.on("request", (request) => {
      if (request.url().includes("/login/oauth/google/callback")) replayCallback = request.url();
    });
    await continueWith(page, "google", {
      sub: SOCIAL_FIXTURES.candidate.subject,
      email: SOCIAL_FIXTURES.candidate.email,
    });
    const landed = new URL(page.url()).pathname;
    const cookie = (await context.cookies()).find((item) => item.name === "jho_session");
    check(
      "E2E-001 candidato com Google ligado entra e cai no cockpit",
      landed === "/" && cookie?.httpOnly === true,
      JSON.stringify({ landed, httpOnly: cookie?.httpOnly }),
    );

    // Já dentro, `/login` não mostra formulário: manda para a tela do papel.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    check(
      "E2E-006 quem já entrou e abre /login vai para a sua tela",
      new URL(page.url()).pathname === "/",
      page.url().replace(BASE, ""),
    );
    await context.close();
  }

  {
    const { context, page } = await fresh();
    await continueWith(page, "linkedin", {
      sub: SOCIAL_FIXTURES.recruiter.subject,
      email: SOCIAL_FIXTURES.recruiter.email,
    });
    check(
      "E2E-001 recrutador com LinkedIn ligado entra e cai em Vagas",
      new URL(page.url()).pathname === "/jobs" && (await hasSession(context)),
      page.url().replace(BASE, ""),
    );
    await context.close();
  }

  /* ------------------------------ Deep link -------------------------------- */

  {
    const { context, page } = await fresh();
    await page.goto(`${BASE}${DEEP_LINK}`, { waitUntil: "networkidle" });
    const atLogin = new URL(page.url());
    await setRemoteBehavior(fake, "google", {
      sub: SOCIAL_FIXTURES.candidate.subject,
      email: SOCIAL_FIXTURES.candidate.email,
    });
    await page.locator('[data-testid="social-google"]').click();
    await page.waitForURL((url) => url.origin === BASE && !url.pathname.startsWith("/login"), { timeout: 20_000 });
    check(
      "E2E-007 deep link sem sessão: entra com Google e volta à vaga pedida",
      atLogin.pathname === "/login"
        && atLogin.searchParams.get("next") === DEEP_LINK
        && new URL(page.url()).pathname === DEEP_LINK,
      JSON.stringify({ login: atLogin.pathname + atLogin.search, landed: page.url().replace(BASE, "") }),
    );
    await context.close();
  }

  /* -------------------------------- Recusas -------------------------------- */

  {
    const { context, page } = await fresh();
    await continueWith(page, "google", { sub: "e2e-google-desabilitada", email: "e2e-desabilitada@local.test" });
    const message = await errorText(page);
    check(
      "E2E-002 conta desabilitada pelo Google volta ao login com a recusa neutra",
      new URL(page.url()).pathname === "/login" && /Não foi possível entrar/.test(message) && !(await hasSession(context)),
      message,
    );
    await context.close();
  }

  {
    const { context, page } = await fresh();
    await continueWith(page, "google", { mode: "cancel" });
    const message = await errorText(page);
    check("E2E-003 cancelar no consentimento volta com 'Login cancelado'", message === "Login cancelado.", message);
    await context.close();
  }

  {
    const { context, page } = await fresh();
    await continueWith(page, "google", { mode: "error" });
    const message = await errorText(page);
    check(
      "E2E-004 provedor com erro volta com 'Não foi possível falar com o Google'",
      /Não foi possível falar com o Google/.test(message) && !(await hasSession(context)),
      message,
    );
    await context.close();
  }

  {
    // O retorno do E2E-001 de novo, noutro navegador: sem o cookie do fluxo e
    // com o `state` já queimado, não vale.
    const { context, page } = await fresh();
    if (replayCallback) await page.goto(replayCallback, { waitUntil: "networkidle" });
    const message = await errorText(page);
    check(
      "E2E-005 repetir a URL de retorno antiga: 'Esta tentativa de login expirou'",
      replayCallback !== null && /expirou/.test(message) && !(await hasSession(context)),
      JSON.stringify({ replayCallback: replayCallback !== null, message }),
    );
    await context.close();
  }

  {
    const { context, page } = await fresh();
    await continueWith(page, "google", {
      sub: "e2e-google-conflito-B",
      email: SOCIAL_FIXTURES.conflict.email,
    });
    const message = await errorText(page);
    const [conflictUser] = await getDb()
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, SOCIAL_FIXTURES.conflict.email));
    const identities = await getDb()
      .select({ subject: authIdentity.subject })
      .from(authIdentity)
      .where(eq(authIdentity.userId, conflictUser.id));
    check(
      "E2E-009 conta ligada ao sujeito A, Google com o sujeito B do mesmo e-mail: conflito, nada muda",
      /ligada a outra conta do Google/.test(message)
        && identities.length === 1
        && identities[0].subject === SOCIAL_FIXTURES.conflict.subject
        && !(await hasSession(context)),
      JSON.stringify({ message, identities }),
    );
    await context.close();
  }

  {
    const email = "e2e-social-nao-verificado@local.test";
    const { context, page } = await fresh();
    await continueWith(page, "linkedin", { sub: "e2e-linkedin-nao-verificado", email, emailVerified: false });
    const message = await errorText(page);
    const users = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
    const pending = await getDb().select({ id: authSignup.id }).from(authSignup).where(eq(authSignup.email, email));
    check(
      "E2E-010 LinkedIn sem e-mail verificado: orientação nomeando o LinkedIn, nenhuma conta nem cadastro",
      /confirmar seu e-mail com o LinkedIn/.test(message)
        && users.length === 0
        && pending.length === 0
        && !(await hasSession(context)),
      JSON.stringify({ message, users: users.length, pending: pending.length }),
    );
    await context.close();
  }

  /* --------------------------- Vínculo automático -------------------------- */

  {
    const { context, page } = await fresh();
    await continueWith(page, "google", { sub: "e2e-google-convidado", email: SOCIAL_FIXTURES.invited.email });
    const [invited] = await getDb()
      .select({ id: authUser.id, passwordHash: authUser.passwordHash })
      .from(authUser)
      .where(eq(authUser.email, SOCIAL_FIXTURES.invited.email));
    const linked = await getDb()
      .select({ origin: authIdentity.origin, subject: authIdentity.subject })
      .from(authIdentity)
      .where(and(eq(authIdentity.userId, invited.id), eq(authIdentity.provider, "google")));
    check(
      "E2E-008 conta criada por admin, sem senha, entra pelo Google de e-mail verificado e fica ligada (automatic)",
      new URL(page.url()).pathname === "/"
        && (await hasSession(context))
        && invited.passwordHash === null
        && linked.length === 1
        && linked[0].origin === "automatic",
      JSON.stringify({ landed: page.url().replace(BASE, ""), linked }),
    );
    await context.close();
  }

  /* ------------------------------ 375 px (regra 11) ------------------------ */

  {
    const { context, page } = await fresh({ width: 375, height: 812 });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      buttons: [...document.querySelectorAll('[data-testid^="social-"] a, a[data-testid^="social-"]')].map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return { left: Math.round(rect.left), right: Math.round(rect.right) };
      }),
    }));
    check(
      "login com botões sociais em 375 px: sem rolagem horizontal, botões dentro da tela",
      layout.overflow <= 0 && layout.buttons.length === 2 && layout.buttons.every((b) => b.left >= 0 && b.right <= 375),
      JSON.stringify(layout),
    );
    await context.close();
  }

  /* ------------------------ Disponibilidade (US-014) ----------------------- */

  try {
    await withServer({ LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "" }, async (base) => {
      const html = await (await fetch(`${base}/login`)).text();
      check(
        "E2E-023 só o Google configurado: só o botão do Google em /login",
        html.includes('data-testid="social-google"') && !html.includes('data-testid="social-linkedin"'),
      );
      const start = await fetch(`${base}/login/oauth/linkedin`, { redirect: "manual" });
      check(
        "E2E-023 iniciar o LinkedIn pela URL volta com 'não disponível aqui'",
        start.status === 303 && start.headers.get("location") === "/login?error=unavailable&provider=linkedin",
        `${start.status} ${start.headers.get("location")}`,
      );
    });

    await withServer(
      { GOOGLE_OIDC_CLIENT_ID: "", GOOGLE_OIDC_CLIENT_SECRET: "", LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "" },
      async (base) => {
        const { context, page } = await fresh();
        await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: base }]);
        await page.goto(`${base}/login`, { waitUntil: "networkidle" });
        const blocks = await page.locator('[data-testid="social-sign-in"]').count();
        const form = await page.locator('[data-testid="login-submit"]').count();
        await page.goto(`${base}/login/oauth/google`, { waitUntil: "networkidle" });
        const message = await errorText(page);
        check(
          "E2E-022 nenhum provedor configurado: /login como sempre, sem bloco social; pela URL, 'não disponível aqui'",
          blocks === 0 && form === 1 && /não está disponível aqui/.test(message),
          JSON.stringify({ blocks, form, message }),
        );
        await context.close();
      },
    );

    // Instalação vazia: a tela de primeiro acesso continua só de CLI, mesmo
    // com os provedores configurados (US-012.EC-2, US-014.EC-3).
    const [{ provisionTestDatabase }, { connectDatabase }, { migrate }] = await Promise.all([
      import("../../support/db.ts"),
      import("../../../src/core/db/client.ts"),
      import("drizzle-orm/postgres-js/migrator"),
    ]);
    const empty = await provisionTestDatabase();
    try {
      const { db, client } = connectDatabase(empty.url);
      try {
        await migrate(db, { migrationsFolder: "./drizzle/postgres" });
      } finally {
        await client.end();
      }
      await withServer({ DATABASE_URL: empty.url }, async (base) => {
        const html = await (await fetch(`${base}/login`, { headers: { cookie: "jho_locale=pt-BR" } })).text();
        check(
          "E2E-022 instalação vazia: primeiro acesso pela CLI, sem botões sociais",
          html.includes("Primeiro acesso") && html.includes("auth add-user") && !html.includes('data-testid="social-'),
        );
      });
    } finally {
      await empty.drop();
    }
  } catch (error) {
    check("E2E-022/023 servidores secundários sobem e respondem", false, String(error).slice(0, 300));
  }
}
