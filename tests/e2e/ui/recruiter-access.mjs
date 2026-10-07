// Área `recruiter-access` do E2E de navegador: o candidato concede, convida,
// limita e revoga o acesso de recrutador; o admin revoga; a sessão emprestada
// só vê (#465, task_02, E2E-001 – E2E-009, G16).
//
// Contas próprias (`recruiter-access-fixtures.mjs`), devolvidas a "nada
// compartilhado" por `setup.mjs` a cada execução. Os e-mails saem pelo sink em
// arquivo do `run-isolated`. Cada papel em contexto próprio; o do recrutador
// sem coletor de console, porque a sonda de 404 depois da revogação é esperada.
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { ACCESS_FIXTURES } from "../recruiter-access-fixtures.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  const sink = process.env.E2E_MAIL_SINK;
  const [{ getDb }, { authUser }] = await Promise.all([
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
  ]);
  const [ana] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, ACCESS_FIXTURES.candidate.email));
  const anaId = ana.candidateId;
  const RUI = ACCESS_FIXTURES.recruiter.email;
  const NOVA = ACCESS_FIXTURES.invited.email;

  async function fresh({ viewport = { width: 1280, height: 900 }, track = true } = {}) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    if (track) trackConsole(page);
    return { context, page };
  }

  async function signIn(page, email) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
  }

  // Clique com a casca ainda `inert` (antes da hidratação) cai no vazio sem
  // erro: toda carga da conta espera a casca liberar antes de agir.
  async function ready(page) {
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    await page.locator('[data-testid="recruiter-access"]').waitFor({ timeout: 15_000 });
  }

  async function openAccount(page) {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await ready(page);
  }

  async function reload(page) {
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
  }

  async function mailsTo(email) {
    if (!sink) return [];
    return (await readdir(sink).catch(() => []))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")))
      .filter((mail) => mail.to === email);
  }

  const text = async (locator) => ((await locator.first().textContent().catch(() => "")) ?? "").trim();
  const grantRow = (page, email) => page.locator('[data-testid="recruiter-grant"]').filter({ hasText: email });
  const inviteRow = (page, email) => page.locator('[data-testid="recruiter-invite"]').filter({ hasText: email });
  const dayIn = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000);
  const ymd = (date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const medium = (date) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);

  // Cada cenário no seu próprio `try`: um passo que estoura vira a verificação
  // reprovada dele, e não apaga o veredito do resto da suíte (docs/qa/README.md).
  async function scenario(id, run) {
    try {
      await run();
    } catch (error) {
      check(`${id} terminou sem exceção`, false, String(error).replace(/\s+/g, " ").slice(0, 300));
    }
  }

  async function submitGrant(page, email, endDate = "") {
    await page.locator('[data-testid="recruiter-access-email"]').fill(email);
    await page.locator('[data-testid="recruiter-access-end-date"]').fill(endDate);
    await page.locator('[data-testid="recruiter-access-submit"]').click();
  }

  const owner = await fresh();
  await signIn(owner.page, ACCESS_FIXTURES.candidate.email);
  await openAccount(owner.page);
  const page = owner.page;

  /* ------------- E2E-001: concede ao Rui, que já tem conta ----------------- */
  await scenario("E2E-001", async () => {
    const empty = await page.locator('[data-testid="recruiter-access-empty"]').count();
    const scope = await text(page.locator('[data-testid="recruiter-access-scope"]'));
    await submitGrant(page, RUI);
    await grantRow(page, RUI).waitFor({ timeout: 15_000 });
    await reload(page);
    const row = grantRow(page, RUI);
    const shown = {
      status: await text(row.locator('[data-testid="recruiter-grant-status"]')),
      since: await text(row.locator('[data-testid="recruiter-grant-since"]')),
      end: await text(row.locator('[data-testid="recruiter-grant-end"]')),
      last: await text(row.locator('[data-testid="recruiter-grant-last-access"]')),
      name: await text(row.locator('[data-testid="recruiter-grant-name"]')),
      markup: await row.locator('[data-testid="recruiter-grant-name"] i').count(),
    };

    const recruiter = await fresh({ track: false });
    await signIn(recruiter.page, RUI);
    await recruiter.page.goto(`${BASE}/recruiter`, { waitUntil: "networkidle" });
    const listed = await recruiter.page.locator(`[data-testid="recruiter-candidate-${anaId}"]`).count();
    await recruiter.context.close();
    const granted = (await mailsTo(RUI)).find((mail) => mail.subject === "Ana E2E deu acesso a você no Master Jobs");

    check(
      "E2E-001 Ana concede ao Rui: lista Ativo, hoje, sem fim, nunca acessou, nome como texto; Rui vê Ana; e-mail no sink",
      empty === 1
        && /Nunca vê/.test(scope)
        && shown.status === "Ativo"
        && shown.since === `Desde ${medium(new Date())}`
        && shown.end === "Sem data de fim"
        && shown.last === "Último acesso: nunca"
        && shown.name === "Rui <i>E2E</i>"
        && shown.markup === 0
        && listed === 1
        && (!sink || granted?.text.includes(`/recruiter/${anaId}`) === true),
      JSON.stringify({ empty, shown, listed, mail: Boolean(granted) }),
    );
  });

  /* -------------- E2E-002: convida quem ainda não tem conta ---------------- */
  await scenario("E2E-002", async () => {
    await submitGrant(page, NOVA);
    await inviteRow(page, NOVA).waitFor({ timeout: 15_000 });
    const validity = await text(inviteRow(page, NOVA).locator('[data-testid="recruiter-invite-valid-until"]'));
    const invite = (await mailsTo(NOVA)).at(-1);
    check(
      "E2E-002 convite aparece em Convites pendentes com o link válido por 7 dias, e o e-mail sai em pt-BR",
      validity === `Link válido até ${medium(dayIn(7))}`
        && (!sink || invite?.subject === "Ana E2E convidou você para acompanhar a busca no Master Jobs"),
      JSON.stringify({ validity, subject: invite?.subject }),
    );
  });

  /* ------------------- E2E-003: recusas com erro no campo ------------------ */
  await scenario("E2E-003", async () => {
    const fieldError = (testId) => text(page.locator(`[data-testid="${testId}"]`));
    await submitGrant(page, "ana.x.com");
    await page.locator('[data-testid="recruiter-access-email-error"]').waitFor({ timeout: 10_000 });
    const malformed = await fieldError("recruiter-access-email-error");
    const kept = await page.locator('[data-testid="recruiter-access-email"]').inputValue();
    await submitGrant(page, "");
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="recruiter-access-email-error"]')?.textContent?.includes("Informe o e-mail"),
    );
    const blank = await fieldError("recruiter-access-email-error");
    await submitGrant(page, ACCESS_FIXTURES.candidate.email);
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="recruiter-access-email-error"]')?.textContent?.includes("si mesmo"),
    );
    const self = await fieldError("recruiter-access-email-error");
    await submitGrant(page, "outro@local.test", ymd(new Date()));
    await page.locator('[data-testid="recruiter-access-date-error"]').waitFor({ timeout: 10_000 });
    const today = await fieldError("recruiter-access-date-error");
    const typed = await page.locator('[data-testid="recruiter-access-email"]').inputValue();
    check(
      "E2E-003 e-mail malformado, vazio, o próprio e data de hoje: erro no campo e o que foi digitado fica",
      malformed === "Informe um e-mail válido."
        && kept === "ana.x.com"
        && blank === "Informe o e-mail do recrutador."
        && self === "Você não pode dar acesso a si mesmo."
        && today === "Escolha uma data futura."
        && typed === "outro@local.test"
        && (await inviteRow(page, "outro@local.test").count()) === 0,
      JSON.stringify({ malformed, kept, blank, self, today, typed }),
    );
  });

  /* ------------------- E2E-009: 375 px e axe na seção ---------------------- */
  await scenario("E2E-009", async () => {
    // Sem coletor de console: o axe baixa as folhas de estilo de outra origem
    // para medir contraste, e a CSP recusa a conexão às fontes do Google — o
    // aviso é do instrumento, não da tela (`a11y.mjs` também roda à parte).
    const narrow = await fresh({ viewport: { width: 375, height: 812 }, track: false });
    await signIn(narrow.page, ACCESS_FIXTURES.candidate.email);
    await openAccount(narrow.page);
    const layout = await narrow.page.evaluate(() => {
      // Só os visíveis: os botões de dentro dos diálogos fechados medem zero.
      const visible = [...document.querySelectorAll('[data-testid="recruiter-access"] button')].filter(
        (button) => button.getBoundingClientRect().width > 0,
      );
      const actions = visible.map((button) => {
        const rect = button.getBoundingClientRect();
        return { right: rect.right, height: rect.height };
      });
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        actions,
        viewport: innerWidth,
      };
    });
    const axe = await new AxeBuilder({ page: narrow.page }).include('[data-testid="recruiter-access"]').withTags(TAGS).analyze();
    check(
      "E2E-009 seção de acesso em 375 px: sem rolagem horizontal, ações alcançáveis e sem violação axe",
      layout.overflow <= 0
        && layout.actions.length > 0
        && layout.actions.every((action) => action.right <= layout.viewport + 1 && action.height >= 44)
        && axe.violations.length === 0,
      JSON.stringify({ layout, violations: axe.violations.map((violation) => violation.id) }),
    );
    await narrow.context.close();
  });

  /* -------- E2E-005: data de fim, tirar; reenviar e cancelar o convite ----- */
  await scenario("E2E-005", async () => {
    const row = grantRow(page, RUI);
    const target = dayIn(30);
    await row.locator('[data-testid="recruiter-grant-end-date"]').fill(ymd(target));
    await row.locator('[data-testid="recruiter-grant-save-end"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="recruiter-grant-end"]')?.textContent?.startsWith("Até"),
    );
    await reload(page);
    const ends = await text(grantRow(page, RUI).locator('[data-testid="recruiter-grant-end"]'));
    await grantRow(page, RUI).locator('[data-testid="recruiter-grant-clear-end"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="recruiter-grant-end"]')?.textContent === "Sem data de fim",
    );
    const cleared = await text(grantRow(page, RUI).locator('[data-testid="recruiter-grant-end"]'));

    const invitesBefore = (await mailsTo(NOVA)).length;
    await inviteRow(page, NOVA).locator('[data-testid="recruiter-invite-resend"]').click();
    // O aviso do passo anterior ("Data de fim salva.") ainda pode estar na
    // tela: esperar só pelo aviso recarregaria antes de o reenvio terminar.
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="mutation-feedback"]')?.textContent?.includes("Convite reenviado"),
    );
    await reload(page);
    const resentValidity = await text(inviteRow(page, NOVA).locator('[data-testid="recruiter-invite-valid-until"]'));
    const invitesAfter = (await mailsTo(NOVA)).length;

    const invite = inviteRow(page, NOVA);
    await invite.locator('[data-testid="recruiter-invite-cancel"]').click();
    await invite.locator('[data-testid="recruiter-invite-cancel-dialog"]').waitFor({ state: "visible" });
    await invite.locator('[data-testid="recruiter-invite-cancel-confirm"]').click();
    await inviteRow(page, NOVA).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await reload(page);
    const gone = await inviteRow(page, NOVA).count();
    check(
      "E2E-005 Ana põe e tira a data de fim do Rui, reenvia o convite (nova validade, novo e-mail) e o cancela com confirmação",
      ends.startsWith(`Até ${medium(target)}`)
        && cleared === "Sem data de fim"
        && resentValidity === `Link válido até ${medium(dayIn(7))}`
        && (!sink || invitesAfter === invitesBefore + 1)
        && gone === 0,
      JSON.stringify({ ends, cleared, resentValidity, invitesBefore, invitesAfter, gone }),
    );
  });

  /* ------- E2E-004: revogar — voltar não muda; confirmar corta o Rui -------- */
  await scenario("E2E-004", async () => {
    const row = grantRow(page, RUI);
    await row.locator('[data-testid="recruiter-grant-revoke"]').click();
    await row.locator('[data-testid="recruiter-grant-revoke-dialog"]').waitFor({ state: "visible" });
    await row.locator('[data-testid="recruiter-grant-revoke-keep"]').click();
    await row.locator('[data-testid="recruiter-grant-revoke-dialog"]').waitFor({ state: "hidden" });
    await reload(page);
    const keptAfterCancel = await grantRow(page, RUI).count();

    await grantRow(page, RUI).locator('[data-testid="recruiter-grant-revoke"]').click();
    await grantRow(page, RUI).locator('[data-testid="recruiter-grant-revoke-confirm"]').click();
    await grantRow(page, RUI).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await reload(page);
    const goneAfterRevoke = await grantRow(page, RUI).count();

    const recruiter = await fresh({ track: false });
    await signIn(recruiter.page, RUI);
    const probe = await recruiter.page.goto(`${BASE}/recruiter/${anaId}`, { waitUntil: "networkidle" });
    await recruiter.context.close();
    const ended = (await mailsTo(RUI)).find((mail) => mail.subject === "Seu acesso ao perfil de Ana E2E terminou");
    check(
      "E2E-004 voltar no diálogo não revoga; confirmar tira o Rui da lista, a página dele dá 404 e o aviso de fim sai",
      keptAfterCancel === 1
        && goneAfterRevoke === 0
        && probe?.status() === 404
        && (!sink || Boolean(ended)),
      JSON.stringify({ keptAfterCancel, goneAfterRevoke, status: probe?.status(), mail: Boolean(ended) }),
    );
  });

  /* ------------ E2E-006: histórico, mais novo primeiro; vazio --------------- */
  await scenario("E2E-006", async () => {
    const kinds = await page
      .locator('[data-testid="recruiter-access-history-entry"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-kind")));
    const empty = await fresh();
    await signIn(empty.page, ACCESS_FIXTURES.fresh.email);
    await openAccount(empty.page);
    const nothing = await text(empty.page.locator('[data-testid="recruiter-access-history-empty"]'));
    await empty.context.close();
    check(
      "E2E-006 o histórico lista o que aconteceu, do mais novo ao mais antigo; quem nunca compartilhou vê o vazio",
      JSON.stringify(kinds) ===
        JSON.stringify([
          "access_revoked",
          "invite_cancelled",
          "invite_resent",
          "end_date_changed",
          "end_date_changed",
          "invite_sent",
          "grant_created",
        ])
        && nothing === "Nada compartilhado ainda.",
      JSON.stringify({ kinds, nothing }),
    );
  });

  /* ------- E2E-007: o admin revoga; nenhum controle de conceder no admin ---- */
  await scenario("E2E-007", async () => {
    await submitGrant(page, RUI);
    await grantRow(page, RUI).waitFor({ timeout: 15_000 });

    const admin = await fresh();
    await signIn(admin.page, E2E_EMAIL);
    await admin.page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    await admin.page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    const anaRow = admin.page.locator("main ul > li").filter({ hasText: ACCESS_FIXTURES.candidate.email });
    const block = anaRow.locator('[data-testid="admin-recruiter-access"]');
    const listed = await block.locator('[data-testid="admin-recruiter-grant"]').filter({ hasText: RUI }).count();
    const grantControls = await admin.page.locator('[data-testid^="recruiter-access-"]').count();
    await block.locator('[data-testid="admin-recruiter-grant-revoke"]').first().click();
    await block.locator('[data-testid="admin-recruiter-grant-revoke-confirm"]').first().click();
    await admin.page.locator('[data-testid="mutation-feedback"]').waitFor({ timeout: 15_000 }).catch(() => {});
    const feedback = await text(admin.page.locator('[data-testid="mutation-feedback"]'));
    await admin.context.close();

    await openAccount(page);
    const latest = await text(page.locator('[data-testid="recruiter-access-history-entry"]'));
    check(
      "E2E-007 o admin vê as concessões da Ana, revoga uma; o histórico dela diz 'por um administrador (nome)'; nada de conceder no admin",
      listed === 1
        && grantControls === 0
        && feedback === "Acesso revogado."
        && /revogado por um administrador \(.+\)/.test(latest)
        && (await grantRow(page, RUI).count()) === 0,
      JSON.stringify({ listed, grantControls, feedback, latest }),
    );
  });

  /* ------------- E2E-008: sessão emprestada só lê a seção ------------------- */
  await scenario("E2E-008", async () => {
    const admin = await fresh();
    await signIn(admin.page, E2E_EMAIL);
    await admin.page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    await admin.page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert"));
    await admin.page
      .locator("main ul > li")
      .filter({ hasText: ACCESS_FIXTURES.candidate.email })
      .locator('[data-testid="impersonate-user"]')
      .first()
      .click();
    await admin.page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 }).catch(() => {});
    await openAccount(admin.page);
    const section = admin.page.locator('[data-testid="recruiter-access"]');
    const view = {
      borrowed: await section.locator('[data-testid="recruiter-access-borrowed"]').count(),
      history: await section.locator('[data-testid="recruiter-access-history-entry"]').count(),
      forms: await section.locator("form").count(),
      buttons: await section.locator("button").count(),
    };
    await admin.context.close();
    check(
      "E2E-008 o admin assumindo a Ana vê lista e histórico sem formulário nem botão de ação",
      view.borrowed === 1 && view.history > 0 && view.forms === 0 && view.buttons === 0,
      JSON.stringify(view),
    );
  });

  await owner.context.close();
}
