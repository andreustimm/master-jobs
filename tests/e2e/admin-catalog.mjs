// E2E-001, E2E-002 e E2E-003 — Plataformas e Execuções (#223, tarefa 03).
//
// E2E-001: admin cadastra um handle, sonda, habilita e pede "Buscar agora"; o
// detalhe da execução sobrevive a refresh, primeiro na fila (sem credencial de
// disparo, com o motivo visível) e depois com as contagens.
// E2E-002: candidato, recrutador e sessão emprestada abrem as rotas por link
// direto e recebem 403 sem ver configuração; `/jobs` segue pesquisável.
// E2E-003: "Buscar em todas" com uma fonte falhando dá `partial`, com
// "desconhecido" onde faltou contagem; "Tentar de novo" só a falha; "Atualizar
// status" de uma fonte conta vivas, fechadas e inconclusivas.
//
// Quem executa é o mesmo `executeSourceRun` que `jho jobs sync --run` chama,
// rodado neste processo com a porta HTTP falsa na borda: o servidor do E2E não
// tem credencial de disparo nem permissão de ingestão, e nenhum teste fala com
// board real. A sondagem pela tela, por isso, responde com a recusa do
// ambiente — que é a mensagem que um preview de verdade mostraria.
import { eq, inArray } from "drizzle-orm";
import { executeSourceRun } from "../../src/contexts/operations/index.ts";
import { getDb } from "../../src/core/db/client.ts";
import { job, source, sourceRun } from "../../src/core/db/schema.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../../src/core/sources/http-port.ts";
import "../../src/core/sources/http.ts";

const OK = "greenhouse:e2e-catalogo";
const BROKEN = "lever:e2e-quebrada";
const IP = "93.184.216.34";
const ACCENT = /[À-ÿ]/;

async function login(browser, base, email, password, locale = "pt-BR") {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addCookies([{ name: "jho_locale", value: locale, url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

const fitsPhone = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** Os nós de texto da interface, sem dado do usuário. */
const interfaceTexts = (page) =>
  page.evaluate(() => {
    const clone = document.querySelector("main")?.cloneNode(true);
    if (!clone) return [];
    for (const node of clone.querySelectorAll("[data-user-content]")) node.remove();
    const out = [];
    const walk = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (text) out.push(text);
    }
    return out;
  });

/**
 * Os mesmos dois critérios da varredura de `ui.mjs`: texto que É valor do
 * dicionário português (e não do inglês), e texto acentuado. Acento sozinho
 * deixaria passar "Sondar" ou "Tentar de novo".
 */
async function portugueseDictionary() {
  const { ptBR } = await import("../../src/core/i18n/pt-BR.ts");
  const { en } = await import("../../src/core/i18n/en.ts");
  const flatten = (dict) => Object.values(dict).flatMap((section) => Object.values(section));
  const shared = new Set(flatten(en).map((v) => v.toLowerCase()));
  return new Set(flatten(ptBR).map((v) => v.toLowerCase()).filter((v) => v.length > 2 && !shared.has(v)));
}

/** Roda neste processo, com ingestão liberada só enquanto dura. */
async function execute(runId, fixtures, opts = {}) {
  const saved = { env: process.env.JHO_ENV, optIn: process.env.JHO_INGESTION_OPT_IN, fetch: globalThis.fetch };
  process.env.JHO_ENV = "local";
  process.env.JHO_INGESTION_OPT_IN = "true";
  setHttpPort(fixtureHttp(fixtures));
  if (opts.fetchImpl) globalThis.fetch = opts.fetchImpl;
  try {
    return await executeSourceRun(runId, { concurrency: 2, verify: { limit: 20 } });
  } finally {
    resetHttpPort();
    globalThis.fetch = saved.fetch;
    if (saved.env === undefined) delete process.env.JHO_ENV;
    else process.env.JHO_ENV = saved.env;
    if (saved.optIn === undefined) delete process.env.JHO_INGESTION_OPT_IN;
    else process.env.JHO_INGESTION_OPT_IN = saved.optIn;
  }
}

const board = {
  "boards-api.greenhouse.io": {
    jobs: [
      { id: 71, title: "Arquiteta E2E Catálogo", absolute_url: `https://${IP}/e2e-catalogo/71`, content: "" },
      { id: 72, title: "Staff E2E Catálogo", absolute_url: `https://${IP}/e2e-catalogo/72`, content: "" },
    ],
  },
};

const runIdOf = (page) => Number(new URL(page.url()).pathname.split("/").pop());

export async function checkAdminCatalog(browser, base, accounts, check) {
  const db = getDb();
  const detail = `${base}/admin/plataformas/${encodeURIComponent(OK)}`;

  /* ------------------------------ E2E-001 ------------------------------ */
  const admin = await login(browser, base, accounts.admin.email, accounts.admin.password);
  let captureRun = null;
  try {
    const { page } = admin;
    await page.goto(`${base}/admin/plataformas`, { waitUntil: "networkidle" });
    check("E2E-001 Plataformas abre para o admin e cabe em 375 px",
      (await page.getByTestId("route-admin-platforms").count()) === 1 && (await fitsPhone(page)));

    for (const [id, label] of [[OK, "Catálogo E2E"], [BROKEN, "Quebrada E2E"]]) {
      const [kind, handle] = id.split(":");
      await page.getByTestId("platforms-register-kind").selectOption(kind);
      await page.getByTestId("platforms-register-handle").fill(handle);
      await page.getByTestId("platforms-register-label").fill(label);
      await page.getByTestId("platforms-register-submit").click();
      await page.getByTestId("mutation-feedback").waitFor();
      await page.getByTestId("mutation-feedback-dismiss").click();
    }
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-001 cadastro aparece na lista, desabilitado",
      (await page.getByTestId(`platform-state-${OK}`).innerText()).trim() === "desabilitada");

    await page.getByTestId("platforms-register-kind").selectOption("greenhouse");
    await page.getByTestId("platforms-register-handle").fill("e2e-catalogo");
    await page.getByTestId("platforms-register-label").fill("Repetida");
    await page.getByTestId("platforms-register-submit").click();
    const duplicate = page.getByTestId("mutation-feedback");
    await duplicate.waitFor();
    check("E2E-001 duplicado recusado com o motivo", (await duplicate.innerText()).includes("já está no catálogo"));

    await page.goto(detail, { waitUntil: "networkidle" });
    check("E2E-001 detalhe da plataforma cabe em 375 px", await fitsPhone(page));
    check("E2E-001 capacidades aparecem com o motivo do que falta",
      (await page.getByTestId("platform-capabilities").innerText()).includes("nenhum adaptador prova"));
    await page.getByTestId("platform-probe").click();
    const probe = page.getByTestId("mutation-feedback");
    await probe.waitFor();
    const probed = await db.select({ id: job.id }).from(job).where(eq(job.sourceId, OK));
    check("E2E-001 sondagem responde sem gravar vaga",
      (await probe.innerText()).length > 0 && probed.length === 0, await probe.innerText());

    // O aviso da sondagem ainda está na tela: esperar por "algum aviso" passaria
    // antes de a action de habilitar gravar. Espera-se o estado no banco.
    await page.getByTestId("mutation-feedback-dismiss").click();
    await page.getByTestId("platform-toggle").click();
    for (let i = 0; i < 100; i++) {
      const [row] = await db.select({ enabled: source.enabled }).from(source).where(eq(source.id, OK));
      if (row?.enabled) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-001 habilitar vale depois de refresh", (await page.getByTestId("platform-state").innerText()).trim() === "habilitada");
    await page.goto(`${base}/admin/plataformas/${encodeURIComponent(BROKEN)}`, { waitUntil: "networkidle" });
    await page.getByTestId("platform-toggle").click();
    await page.getByTestId("mutation-feedback").waitFor();

    await page.goto(detail, { waitUntil: "networkidle" });
    await page.getByTestId("platform-capture").click();
    await page.waitForURL((url) => url.pathname.startsWith("/admin/execucoes/"));
    captureRun = runIdOf(page);
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-001 Buscar agora cria execução na fila, com o motivo, que sobrevive a refresh",
      (await page.getByTestId(`run-status-${captureRun}`).getAttribute("data-status")) === "queued"
        && (await page.getByTestId("run-reason").count()) === 1);

    const result = await execute(captureRun, board);
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-001 executada: detalhe mostra concluída com contagens", result.ok
      && (await page.getByTestId(`run-status-${captureRun}`).getAttribute("data-status")) === "succeeded"
      && (await page.getByTestId(`run-count-${captureRun}-inserted`).innerText()).trim() === "2", JSON.stringify(result));
    check("E2E-001 detalhe da execução cabe em 375 px", await fitsPhone(page));

    /* ------------------------------ E2E-003 ------------------------------ */
    await page.goto(`${base}/admin/execucoes`, { waitUntil: "networkidle" });
    await page.getByTestId("runs-capture-all").click();
    await page.waitForURL((url) => /\/admin\/execucoes\/\d+$/.test(url.pathname));
    const allRun = runIdOf(page);
    await execute(allRun, board);
    await page.reload({ waitUntil: "networkidle" });
    const children = await db.select().from(sourceRun).where(eq(sourceRun.parentId, allRun));
    const failed = children.find((child) => child.sourceId === BROKEN);
    check("E2E-003 todas com uma fonte falhando fica parcial, sem esconder a que deu certo",
      (await page.getByTestId(`run-status-${allRun}`).getAttribute("data-status")) === "partial"
        && children.some((child) => child.sourceId === OK && child.status === "succeeded")
        && failed?.status === "failed");
    check("E2E-003 contagem que faltou aparece como desconhecida, não zero",
      (await page.getByTestId(`run-count-${failed?.id}-fetched`).getAttribute("data-known")) === "false");

    await page.goto(`${base}/admin/execucoes/${failed.id}`, { waitUntil: "networkidle" });
    await page.getByTestId("run-retry").click();
    await page.waitForURL((url) => url.pathname !== `/admin/execucoes/${failed.id}`);
    const retryRun = runIdOf(page);
    const [retryRow] = await db.select().from(sourceRun).where(eq(sourceRun.id, retryRun));
    const [original] = await db.select().from(sourceRun).where(eq(sourceRun.id, failed.id));
    check("E2E-003 nova tentativa só da falha, ligada à original, que não muda",
      retryRow?.retryOf === failed.id && retryRow?.sourceId === BROKEN && original?.status === "failed");

    await page.goto(detail, { waitUntil: "networkidle" });
    await page.getByTestId("platform-verify").click();
    await page.waitForURL((url) => /\/admin\/execucoes\/\d+$/.test(url.pathname));
    const verifyRun = runIdOf(page);
    const probeFetch = async (input) => new Response(null, { status: String(input).endsWith("/71") ? 404 : 200 });
    await execute(verifyRun, {}, { fetchImpl: probeFetch });
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-003 Atualizar status conta vivas e fechadas da fonte",
      (await page.getByTestId(`run-count-${verifyRun}-alive`).innerText()).trim() === "1"
        && (await page.getByTestId(`run-count-${verifyRun}-closed`).innerText()).trim() === "1");

    await page.goto(`${base}/admin/execucoes`, { waitUntil: "networkidle" });
    check("E2E-003 lista de execuções paginada cabe em 375 px",
      (await page.getByTestId("runs-page").count()) === 1 && (await fitsPhone(page)));
  } finally {
    await admin.context.close();
  }

  const english = await login(browser, base, accounts.admin.email, accounts.admin.password, "en");
  try {
    const { page } = english;
    const leaks = [];
    const portuguese = await portugueseDictionary();
    for (const path of [detail, `${base}/admin/execucoes/${captureRun}`]) {
      await page.goto(path, { waitUntil: "networkidle" });
      for (const text of await interfaceTexts(page)) {
        if (ACCENT.test(text) || portuguese.has(text.toLowerCase())) leaks.push(`${path}: ${text.slice(0, 40)}`);
      }
    }
    check("E2E-003 detalhes em inglês sem texto português fora do dado do usuário", leaks.length === 0, leaks.join(" | "));
  } finally {
    await english.context.close();
  }

  /* ------------------------------ E2E-002 ------------------------------ */
  const paths = ["/admin/plataformas", "/admin/execucoes", `/admin/plataformas/${encodeURIComponent(OK)}`, `/admin/execucoes/${captureRun}`];
  for (const [who, account] of [["candidato", accounts.candidate], ["recrutador", accounts.recruiter]]) {
    const denied = await login(browser, base, account.email, account.password);
    try {
      const { page } = denied;
      const outcomes = [];
      for (const path of paths) {
        const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        const html = await page.content();
        // O handle está na própria URL pedida; o que não pode vazar é a configuração.
        outcomes.push({ path, status: response?.status(), leaked: html.includes("Catálogo E2E") || html.includes("platform-capabilities") });
      }
      check(`E2E-002 ${who} é negado por link direto sem ver configuração`,
        outcomes.every((o) => o.status === 403 && !o.leaked), JSON.stringify(outcomes));
      const jobs = await page.goto(`${base}/jobs`, { waitUntil: "networkidle" });
      check(`E2E-002 ${who} continua pesquisando /jobs`, jobs?.status() === 200);
    } finally {
      await denied.context.close();
    }
  }

  const borrowed = await login(browser, base, accounts.admin.email, accounts.admin.password);
  try {
    const { page } = borrowed;
    await page.goto(`${base}/admin/users`, { waitUntil: "networkidle" });
    await page.locator("li").filter({ hasText: accounts.impersonationTarget }).first()
      .locator('[data-testid="impersonate-user"]').first().click();
    await page.waitForSelector('[data-testid="stop-impersonating"]');
    const outcomes = [];
    for (const path of paths) {
      const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      outcomes.push({ path, status: response?.status() });
    }
    check("E2E-002 sessão emprestada é negada nas rotas do catálogo", outcomes.every((o) => o.status === 403), JSON.stringify(outcomes));
    await page.click('[data-testid="stop-impersonating"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="stop-impersonating"]'));
  } finally {
    await borrowed.context.close();
  }

  // As fontes, vagas, eventos e execuções são desta verificação; as seguintes
  // contam o acervo e a saúde das fontes.
  const ids = [OK, BROKEN];

  await db.delete(job).where(inArray(job.sourceId, ids));
  await db.update(sourceRun).set({ parentId: null, retryOf: null });
  await db.delete(sourceRun);
  await db.delete(source).where(inArray(source.id, ids));
}
