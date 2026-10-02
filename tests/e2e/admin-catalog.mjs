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
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
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
    // A verificação global usa o piso de fit padrão; as vagas desta suíte não têm
    // nota, então quem quer vê-las passa `verifyMinFit: 0` (o que a CLI faz com --min-fit).
    // Com piso 0 o "nota 55 ou mais" da frase global NÃO fica provado aqui: o corte
    // padrão é provado em tests/job-check-events.test.ts (vagas dos dois lados do corte).
    const verify = { limit: opts.verifyLimit ?? 20, ...(opts.verifyMinFit === undefined ? {} : { minFit: opts.verifyMinFit }) };
    return await executeSourceRun(runId, { concurrency: 2, verify });
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

/**
 * A verificação global olha as vagas abertas de TODAS as fontes. Para não sondar
 * nem alterar vagas de outras áreas do E2E (que moram no mesmo banco e têm URL
 * por nome de host), as alheias ficam fechadas só enquanto `body` roda e voltam
 * a abertas depois, sem terem sido tocadas.
 */
const PARKED = "e2e-admin-catalog-estacionada";
async function withOnlyOwnJobsOpen(db, ownSourceIds, body) {
  await db.update(job).set({ closedAt: PARKED }).where(and(isNull(job.closedAt), notInArray(job.sourceId, ownSourceIds)));
  try {
    return await body();
  } finally {
    await db.update(job).set({ closedAt: null }).where(eq(job.closedAt, PARKED));
  }
}

export async function checkAdminCatalog(browser, base, accounts, check) {
  const db = getDb();
  const detail = `${base}/admin/plataformas/${encodeURIComponent(OK)}`;

  /* ------------------------------ E2E-001 ------------------------------ */
  const admin = await login(browser, base, accounts.admin.email, accounts.admin.password);
  let captureRun = null;
  // Execuções de verificação vistas em pt-BR, relidas depois em inglês (#439).
  const verifyRuns = [];
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

    // #439: a completude de uma verificação não é a da captura. Completa, diz que
    // conferiu tudo; cortada pelo limite, diz isso — nenhuma das duas fala de
    // "fechar por ausência", que a verificação nunca faz (só 404 e 410 fecham).
    const completeness = async () => (await page.getByTestId("run-completeness").innerText()).trim();
    const capturePhrase = /aus[eê]ncia|janela|lista completa/i;
    const completeText = await completeness();
    check("E2E-003 verificação completa mostra a conferência completa, sem texto de captura",
      completeText.startsWith("conferência completa") && completeText.includes("da fonte")
        && !capturePhrase.test(completeText), completeText);
    // #447: o total vencido é gravado, e a frase diz quantas de quantas.
    const [completeRow] = await db.select().from(sourceRun).where(eq(sourceRun.id, verifyRun));
    check("E2E-003 verificação completa grava o total vencido e mostra N de M",
      completeRow?.dueTotal === 2 && completeRow?.fetched === 2 && completeText.includes("2 de 2 vagas")
        && (await page.getByTestId("run-completeness").getAttribute("data-due-known")) === "true",
      `${completeRow?.fetched}/${completeRow?.dueTotal} | ${completeText}`);
    verifyRuns.push({ id: verifyRun, global: false, partial: false, count: "2 of 2" });

    // Reabre a vaga fechada para haver duas vagas vencidas e corta a conferência em uma.
    await db.update(job).set({ closedAt: null }).where(eq(job.sourceId, OK));
    await page.goto(detail, { waitUntil: "networkidle" });
    await page.getByTestId("platform-verify").click();
    await page.waitForURL((url) => /\/admin\/execucoes\/\d+$/.test(url.pathname) && Number(url.pathname.split("/").pop()) !== verifyRun);
    const cutRun = runIdOf(page);
    await execute(cutRun, {}, { fetchImpl: async () => new Response(null, { status: 200 }), verifyLimit: 1 });
    await page.reload({ waitUntil: "networkidle" });
    const [cutRow] = await db.select().from(sourceRun).where(eq(sourceRun.id, cutRun));
    const cutText = await completeness();
    check("E2E-003 verificação cortada pelo limite diz isso, sem texto de captura",
      cutRow?.completeness === "partial" && cutText.startsWith("conferência cortada pelo limite")
        && cutText.includes("da fonte") && !capturePhrase.test(cutText),
      `${cutRow?.completeness} | ${cutText}`);
    check("E2E-003 verificação cortada pelo limite mostra N de M com o total gravado",
      cutRow?.dueTotal === 2 && cutRow?.fetched === 1 && cutText.includes("1 de 2 vagas"),
      `${cutRow?.fetched}/${cutRow?.dueTotal} | ${cutText}`);
    check("E2E-003 completude da verificação sobrevive a refresh e cabe em 375 px",
      (await completeness()) === cutText && (await fitsPhone(page)));
    verifyRuns.push({ id: cutRun, global: false, partial: true, count: "1 of 2" });

    // Execução gravada antes da coluna `due_total` (#447): sem o total, a frase
    // continua a de antes, sem número — desconhecido não vira "1 de 0".
    const [legacy] = await db.insert(sourceRun).values({
      scopeKind: "verify",
      sourceId: OK,
      idempotencyKey: `verify:${OK}@e2e-antiga`,
      configSnapshot: { sources: [] },
      status: "partial",
      queuedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      fetched: 1,
      alive: 1,
      closed: 0,
      inconclusive: 0,
      completeness: "partial",
    }).returning({ id: sourceRun.id });
    await page.goto(`${base}/admin/execucoes/${legacy.id}`, { waitUntil: "networkidle" });
    const legacyText = await completeness();
    check("E2E-003 execução antiga, sem total gravado, mantém a frase sem N de M",
      legacyText === "conferência cortada pelo limite ou pelo orçamento de requisições: parte das vagas abertas da fonte com link público ficou sem checar"
        && (await page.getByTestId("run-completeness").getAttribute("data-due-known")) === "false"
        && (await fitsPhone(page)),
      legacyText);

    // Verificação GLOBAL ("Atualizar status de todas"): sem fonte, vale o universo
    // das vagas elegíveis, e o texto não pode prometer "todas as vagas abertas".
    // As vagas alheias ficam estacionadas só durante a execução. O "N de M" abaixo
    // conta as vagas sem nota (piso 0), não as de "nota 55 ou mais" da frase.
    const runGlobal = async (verifyLimit) => {
      await page.goto(`${base}/admin/execucoes`, { waitUntil: "networkidle" });
      const before = new Set((await db.select({ id: sourceRun.id }).from(sourceRun)).map((row) => row.id));
      await page.getByTestId("runs-verify-all").click();
      await page.waitForURL((url) => /\/admin\/execucoes\/\d+$/.test(url.pathname) && !before.has(Number(url.pathname.split("/").pop())));
      const id = runIdOf(page);
      await withOnlyOwnJobsOpen(db, [OK, BROKEN], () =>
        execute(id, {}, { fetchImpl: async () => new Response(null, { status: 200 }), verifyLimit, verifyMinFit: 0 }));
      await page.reload({ waitUntil: "networkidle" });
      const [row] = await db.select().from(sourceRun).where(eq(sourceRun.id, id));
      return { id, row, text: await completeness() };
    };
    const globalCut = await runGlobal(1);
    check("E2E-003 verificação global cortada pelo limite fala das vagas elegíveis, sem texto de captura",
      globalCut.row?.scopeKind === "verify" && globalCut.row?.sourceId === null && globalCut.row?.completeness === "partial"
        && globalCut.text.startsWith("conferência cortada pelo limite") && globalCut.text.includes("elegíveis")
        && !globalCut.text.includes("da fonte") && !capturePhrase.test(globalCut.text),
      `${globalCut.row?.completeness} | ${globalCut.text}`);
    check("E2E-003 verificação global cortada grava o total vencido e mostra N de M das elegíveis",
      globalCut.row?.dueTotal === 2 && globalCut.row?.fetched === 1 && globalCut.text.includes("1 de 2 vagas elegíveis"),
      `${globalCut.row?.fetched}/${globalCut.row?.dueTotal} | ${globalCut.text}`);
    verifyRuns.push({ id: globalCut.id, global: true, partial: true, count: "1 of 2" });
    const globalFull = await runGlobal(50);
    check("E2E-003 verificação global completa fala das vagas elegíveis, sem texto de captura",
      globalFull.row?.completeness === "complete" && globalFull.text.startsWith("conferência completa")
        && globalFull.text.includes("elegíveis") && !globalFull.text.includes("da fonte") && !capturePhrase.test(globalFull.text),
      `${globalFull.row?.completeness} | ${globalFull.text}`);
    check("E2E-003 verificação global completa mostra N de M das elegíveis",
      globalFull.row?.dueTotal === 2 && globalFull.row?.fetched === 2 && globalFull.text.includes("2 de 2 vagas elegíveis"),
      `${globalFull.row?.fetched}/${globalFull.row?.dueTotal} | ${globalFull.text}`);
    check("E2E-003 verificação global cabe em 375 px e a completude sobrevive a refresh",
      (await completeness()) === globalFull.text && (await fitsPhone(page)));
    verifyRuns.push({ id: globalFull.id, global: true, partial: false, count: "2 of 2" });

    await page.goto(`${base}/admin/execucoes/${captureRun}`, { waitUntil: "networkidle" });
    check("E2E-003 a captura segue com o texto da listagem da fonte",
      (await completeness()) === "lista completa: fecha por ausência");

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
    // As quatro frases novas da verificação, lidas em inglês: cada execução mostra a
    // chave certa do escopo e do estado, e nenhuma vaza português.
    const readings = [];
    for (const run of verifyRuns) {
      const path = `${base}/admin/execucoes/${run.id}`;
      await page.goto(path, { waitUntil: "networkidle" });
      const shown = (await page.getByTestId("run-completeness").innerText()).trim();
      readings.push({ ...run, shown });
      for (const text of await interfaceTexts(page)) {
        if (ACCENT.test(text) || portuguese.has(text.toLowerCase())) leaks.push(`${path}: ${text.slice(0, 40)}`);
      }
    }
    check("E2E-003 detalhes em inglês sem texto português fora do dado do usuário", leaks.length === 0, leaks.join(" | "));
    check("E2E-003 verificação lida em inglês: plataforma e global, completa e cortada, cada uma com a sua frase e o N of M",
      verifyRuns.length === 4 && readings.every((r) =>
        r.shown.startsWith(r.partial ? "check cut by the limit" : "full check")
        && (r.global ? r.shown.includes("eligible") && !r.shown.includes("of the source") : r.shown.includes("of the source"))
        && r.shown.includes(`${r.count} `)
        && !/absence|window|listing/i.test(r.shown)),
      readings.map((r) => r.shown).join(" | "));
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
