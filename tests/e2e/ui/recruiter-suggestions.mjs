// Área `recruiter-suggestions` do E2E de navegador: o recrutador com acesso
// lê o funil e o currículo e sugere vagas; só o candidato aceita ou recusa; a
// sessão emprestada só vê; a revogação corta (#465, task_04, E2E-016 –
// E2E-023, G16).
//
// Contas, vagas e concessões próprias (`recruiter-suggestions-fixtures.mjs`),
// devolvidas a "nada sugerido" por `setup.mjs` a cada execução. Cada papel em
// contexto próprio; o do recrutador que sonda 404 sem coletor de console.
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { SUGGESTION_FIXTURES } from "../recruiter-suggestions-fixtures.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** O recrutador sem concessão nenhuma de `setup.mjs` (`E2E_ROLES.recruiter`), o mesmo de `roles.mjs`. */
const LONELY_RECRUITER = "e2e-recrutador@local.test";
const { candidate: ANA, other: ZE, recruiter: RUI, jobs: JOBS } = SUGGESTION_FIXTURES;

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  const [{ getDb }, { authUser }] = await Promise.all([
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
  ]);
  const candidateOf = async (email) =>
    (await getDb().select({ id: authUser.candidateId }).from(authUser).where(eq(authUser.email, email)))[0].id;
  const anaId = await candidateOf(ANA.email);
  const zeId = await candidateOf(ZE.email);

  async function fresh({ viewport = { width: 1280, height: 900 }, track = true } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    if (track) trackConsole(page);
    return { context, page };
  }

  async function login(page, email) {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
  }

  async function signIn(email, options) {
    const session = await fresh(options);
    await session.page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await login(session.page, email);
    return session;
  }

  // Clique com a casca ainda `inert` (antes da hidratação) cai no vazio sem
  // erro: toda carga espera a casca liberar antes de agir.
  async function open(page, path) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    return response;
  }

  const text = async (locator) => ((await locator.first().textContent().catch(() => "")) ?? "").trim();

  async function scenario(id, body) {
    try {
      await body();
    } catch (error) {
      check(`${id} terminou sem exceção`, false, String(error).replace(/\s+/g, " ").slice(0, 300));
    }
  }

  /** Sem rolagem horizontal, alvos de toque alcançáveis e nenhuma violação axe no `main`. */
  async function measure(page) {
    const layout = await page.evaluate(() => {
      const visible = [...document.querySelectorAll("main a, main button")].filter((el) => el.getBoundingClientRect().width > 0);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        offscreen: visible.filter((el) => el.getBoundingClientRect().right > innerWidth + 1).length,
      };
    });
    const axe = await new AxeBuilder({ page }).include("main").withTags(TAGS).analyze();
    return { ...layout, violations: axe.violations.map((violation) => violation.id) };
  }

  const suggestionRow = (page, title) => page.locator('[data-testid="recruiter-suggestion"]').filter({ hasText: title });
  const candidateItem = (page, title) => page.locator('[data-testid="suggestion-item"]').filter({ hasText: title });

  const rui = await signIn(RUI.email, { track: false });
  const ana = await signIn(ANA.email);

  /* ---------- E2E-016: a lista, o nome como texto, o título e 375 px ---------- */
  await scenario("E2E-016", async () => {
    await open(rui.page, "/recruiter");
    const listed = {
      ana: await rui.page.locator(`[data-testid="recruiter-candidate-${anaId}"]`).count(),
      ze: await rui.page.locator(`[data-testid="recruiter-candidate-${zeId}"]`).count(),
      zeName: await text(rui.page.locator(`[data-testid="recruiter-candidate-${zeId}"]`)),
      zeMarkup: await rui.page.locator(`[data-testid="recruiter-candidate-${zeId}"] b`).count(),
      since: await text(rui.page.locator('[data-testid="recruiter-row-since"]')),
    };
    const narrow = await signIn(RUI.email, { viewport: { width: 375, height: 812 }, track: false });
    await open(narrow.page, "/recruiter");
    const small = await measure(narrow.page);
    await narrow.context.close();
    await rui.page.locator(`[data-testid="recruiter-candidate-${anaId}"]`).click();
    await rui.page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 15_000 });
    // Na navegação do cliente o título chega com a página, depois da URL.
    await rui.page.waitForFunction(() => document.title.includes("Ana"), null, { timeout: 10_000 }).catch(() => {});
    const title = await rui.page.title();
    const lonely = await signIn(LONELY_RECRUITER);
    await open(lonely.page, "/recruiter");
    const empty = await lonely.page.locator('[data-testid="recruiter-empty-state"]').count();
    await lonely.context.close();
    check(
      "E2E-016 Rui vê Ana e Zé com 'Acesso desde', nome como texto, 375 px sem estouro, o nome na aba; sem concessão, o vazio",
      listed.ana === 1
        && listed.ze === 1
        && listed.zeName === ZE.name
        && listed.zeMarkup === 0
        && listed.since.startsWith("Acesso desde")
        && small.overflow <= 0
        && small.offscreen === 0
        && small.violations.length === 0
        && title.includes("Ana")
        && empty === 1,
      JSON.stringify({ listed, small, title, empty }),
    );
  });

  /* ------------- E2E-017: funil só de leitura, currículo e último acesso ------------- */
  await scenario("E2E-017", async () => {
    await open(rui.page, `/recruiter/${anaId}`);
    const page = rui.page;
    const funnel = {
      counts: await page.locator('[data-testid="recruiter-funnel-counts"] > *').count(),
      row: await page.locator(`[data-testid="recruiter-job-${JOBS.funnel.id}"]`).count(),
      controls: await page.locator("main select, main form, main textarea").count(),
    };
    await page.locator('[data-testid="recruiter-view-cv"]').click();
    await page.locator('[data-testid="route-recruiter-cv"]').waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const cv = await text(page.locator('[data-testid="recruiter-cv-content"]'));
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.locator('[data-testid="recruiter-cv-download"]').click(),
    ]);
    const fileName = download.suggestedFilename();
    await open(ana.page, "/account");
    const lastAccess = await text(
      ana.page.locator('[data-testid="recruiter-grant"]').filter({ hasText: RUI.email }).locator('[data-testid="recruiter-grant-last-access"]'),
    );
    check(
      "E2E-017 funil com contagem e linha, sem controle de escrita; o currículo aparece e baixa como ana-e2e-cv.md; a Ana vê o último acesso",
      funnel.counts > 0
        && funnel.row === 1
        && funnel.controls === 0
        && cv.includes("Engenheira de backend")
        && fileName === "ana-e2e-cv.md"
        && lastAccess.startsWith("Último acesso:")
        && lastAccess !== "Último acesso: nunca",
      JSON.stringify({ funnel, cvChars: cv.length, fileName, lastAccess }),
    );
  });

  /* ------------- E2E-018: sugerir pelo acervo, aceitar, marcador e "Aceita" ------------- */
  await scenario("E2E-018", async () => {
    const page = rui.page;
    await open(page, `/recruiter/${anaId}`);
    await page.locator('[data-testid="recruiter-suggest-link"]').click();
    await page.locator('[data-testid="route-recruiter-suggest"]').waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    await page.fill('[data-testid="suggest-search-input"]', "Backend");
    await page.locator('[data-testid="suggest-search-submit"]').click();
    await page.waitForURL((url) => url.searchParams.get("q") === "Backend", { timeout: 15_000 });
    await page.locator(`[data-testid="suggest-job-${JOBS.suggested.id}"]`).waitFor({ timeout: 15_000 });
    await page.locator(`[data-testid="suggest-job-${JOBS.suggested.id}"] input`).check();
    await page.fill('[data-testid="suggest-note"]', "Fits you");
    await page.locator('[data-testid="suggest-submit"]').click();
    await page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const pending = await suggestionRow(page, JOBS.suggested.title).getAttribute("data-status").catch(() => null);

    await open(ana.page, "/suggestions");
    const navCount = await text(ana.page.locator('[data-testid="nav-suggestions-count"]'));
    const item = candidateItem(ana.page, JOBS.suggested.title);
    const shown = {
      company: await text(item.locator('[data-testid="suggestion-company"]')),
      score: await text(item.locator('[data-testid="suggestion-score"]')),
      recruiter: await text(item.locator('[data-testid="suggestion-recruiter-name"]')),
      note: await text(item.locator('[data-testid="suggestion-note"]')),
    };
    await item.locator('[data-testid="suggestion-accept"]').click();
    await ana.page.waitForFunction(() =>
      document.querySelector('[data-testid="mutation-feedback"]')?.textContent?.includes("Sugestão aceita"),
    );
    await open(ana.page, "/pipeline");
    const marker = await ana.page.locator(`[data-testid="pipeline-suggested-${JOBS.suggested.id}"]`).count();
    await open(page, `/recruiter/${anaId}`);
    const decided = await suggestionRow(page, JOBS.suggested.title).getAttribute("data-status").catch(() => null);
    check(
      "E2E-018 Rui sugere 'Backend' com nota → Pendente; Ana vê 1 na navegação, vaga, empresa, nota, Rui e a nota → aceita → Backlog com marcador → Rui vê Aceita",
      pending === "pending"
        && navCount === "1"
        && shown.company === JOBS.suggested.companyName
        && shown.score.startsWith("Nota:")
        && shown.recruiter === RUI.fullName
        && shown.note === "Fits you"
        && marker === 1
        && decided === "accepted",
      JSON.stringify({ pending, navCount, shown, marker, decided }),
    );
  });

  /* ------------- E2E-019: cadastrar vaga nova e sugerir; E2E-020: recusar ------------- */
  const registered = `Vaga cadastrada E2E ${Date.now()}`;
  await scenario("E2E-019", async () => {
    const page = rui.page;
    await open(page, `/jobs/new?suggestFor=${anaId}`);
    const notice = await text(page.locator('[data-testid="jobs-new-suggest-for"]'));
    await page.fill("#title", registered);
    await page.fill("#companyName", "Registro Lab");
    await page.fill("#description", "Vaga cadastrada pelo recrutador na jornada E2E, para sugerir à Ana.");
    await page.fill('[data-testid="jobs-new-note"]', "Cadastrei para você");
    await page.locator('[data-testid="post-job"]').click();
    await page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    const status = await suggestionRow(page, registered).getAttribute("data-status").catch(() => null);
    check(
      "E2E-019 /jobs/new?suggestFor=Ana diz a quem vai, publica e volta à página da Ana com a sugestão Pendente",
      notice.includes("Ana E2E") && status === "pending",
      JSON.stringify({ notice, status }),
    );
  });

  await scenario("E2E-020", async () => {
    await open(ana.page, "/pipeline");
    const before = await ana.page.locator('[data-testid^="pipeline-job-"]').count();
    await open(ana.page, "/suggestions");
    const item = candidateItem(ana.page, registered);
    await item.locator('[data-testid="suggestion-decline"]').click();
    await ana.page.waitForFunction(() =>
      document.querySelector('[data-testid="mutation-feedback"]')?.textContent?.includes("Sugestão recusada"),
    );
    await open(ana.page, "/pipeline");
    const after = await ana.page.locator('[data-testid^="pipeline-job-"]').count();
    const inFunnel = await ana.page.locator("main").filter({ hasText: registered }).count();
    await open(rui.page, `/recruiter/${anaId}`);
    const status = await suggestionRow(rui.page, registered).getAttribute("data-status").catch(() => null);
    check(
      "E2E-020 Ana recusa: o funil não muda, e o Rui vê Recusada",
      before === after && inFunnel === 0 && status === "declined",
      JSON.stringify({ before, after, inFunnel, status }),
    );
  });

  /* ------------- E2E-022: /suggestions, currículo e sugerir em 375 px, com axe ------------- */
  await scenario("E2E-022", async () => {
    const narrowRui = await signIn(RUI.email, { viewport: { width: 375, height: 812 }, track: false });
    await open(narrowRui.page, `/recruiter/${anaId}/cv`);
    const cv = await measure(narrowRui.page);
    await open(narrowRui.page, `/recruiter/${anaId}/suggest?q=Backend`);
    const suggest = await measure(narrowRui.page);
    // Deixa uma sugestão pendente para a tela da Ana e para E2E-023.
    await narrowRui.page.locator(`[data-testid="suggest-job-${JOBS.pending.id}"] input`).check();
    await narrowRui.page.locator('[data-testid="suggest-submit"]').click();
    await narrowRui.page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 15_000 });
    await narrowRui.context.close();
    const narrowAna = await signIn(ANA.email, { viewport: { width: 375, height: 812 }, track: false });
    await open(narrowAna.page, "/suggestions");
    const suggestions = await measure(narrowAna.page);
    const pendingItems = await narrowAna.page.locator('[data-testid="suggestion-item"][data-status="pending"]').count();
    await narrowAna.context.close();
    const ok = (measured) => measured.overflow <= 0 && measured.offscreen === 0 && measured.violations.length === 0;
    check(
      "E2E-022 /suggestions, o currículo e a tela de sugerir em 375 px: sem estouro, ações alcançáveis e sem violação axe",
      ok(cv) && ok(suggest) && ok(suggestions) && pendingItems === 1,
      JSON.stringify({ cv, suggest, suggestions, pendingItems }),
    );
  });

  /* ------------- E2E-023: sessão emprestada vê e não decide ------------- */
  await scenario("E2E-023", async () => {
    const admin = await signIn(E2E_EMAIL);
    await open(admin.page, "/admin/users");
    await admin.page
      .locator("main ul > li")
      .filter({ hasText: ANA.email })
      .locator('[data-testid="impersonate-user"]')
      .first()
      .click();
    await admin.page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 }).catch(() => {});
    await open(admin.page, "/suggestions");
    const view = {
      items: await admin.page.locator('[data-testid="suggestion-item"]').count(),
      borrowed: await admin.page.locator('[data-testid="suggestions-borrowed"]').count(),
      accept: await admin.page.locator('[data-testid="suggestion-accept"]').count(),
      decline: await admin.page.locator('[data-testid="suggestion-decline"]').count(),
    };
    await admin.context.close();
    check(
      "E2E-023 o admin assumindo a Ana vê as sugestões, sem Aceitar nem Recusar",
      view.items > 0 && view.borrowed === 1 && view.accept === 0 && view.decline === 0,
      JSON.stringify(view),
    );
  });

  /* ------------- E2E-021: revogar corta; link do e-mail depois do login ------------- */
  await scenario("E2E-021", async () => {
    await open(ana.page, "/account");
    const row = ana.page.locator('[data-testid="recruiter-grant"]').filter({ hasText: RUI.email });
    await row.locator('[data-testid="recruiter-grant-revoke"]').click();
    await row.locator('[data-testid="recruiter-grant-revoke-confirm"]').click();
    await row.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    const statuses = {};
    for (const path of [`/recruiter/${anaId}`, `/recruiter/${anaId}/cv`, `/recruiter/${anaId}/suggest`]) {
      statuses[path] = (await rui.page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }))?.status();
    }
    // Sem sessão: o link do e-mail de acesso concedido leva ao login e, depois
    // dele, à página do candidato — a do Zé, que ainda vale.
    const signedOut = await fresh({ track: false });
    await signedOut.page.goto(`${BASE}/recruiter/${zeId}`, { waitUntil: "networkidle" });
    const atLogin = new URL(signedOut.page.url()).pathname === "/login";
    await login(signedOut.page, RUI.email);
    await signedOut.page.waitForURL((url) => url.pathname === `/recruiter/${zeId}`, { timeout: 15_000 }).catch(() => {});
    const landed = new URL(signedOut.page.url()).pathname;
    const revoked = (await signedOut.page.goto(`${BASE}/recruiter/${anaId}`, { waitUntil: "networkidle" }))?.status();
    await signedOut.context.close();
    check(
      "E2E-021 depois da revogação, a página, o currículo e sugerir da Ana dão 404; sem sessão, o link leva ao login e depois à página do Zé; o da Ana, 404",
      Object.values(statuses).every((status) => status === 404) && atLogin && landed === `/recruiter/${zeId}` && revoked === 404,
      JSON.stringify({ statuses, atLogin, landed, revoked }),
    );
  });

  await rui.context.close();
  await ana.context.close();
}
