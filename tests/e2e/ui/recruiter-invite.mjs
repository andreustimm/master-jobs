// Área `recruiter-invite` do E2E de navegador: o convite de recrutador do link
// do e-mail até o acesso (#465, task_03, E2E-010 – E2E-015, ADR-018, G16).
//
// A candidata convida pela própria conta; cada pessoa convidada abre o link
// numa janela sem sessão e se cadastra pelo Google falso ou pelo código lido
// do sink. Cada cenário em contexto próprio e com IP próprio (`x-forwarded-for`):
// o limite de três cadastros por IP por hora não pode vazar de um para outro.
import AxeBuilder from "@axe-core/playwright";
import { setRemoteBehavior } from "../fake-oidc.mjs";
import { codeIn, waitForMail } from "../mail-sink.mjs";
import { ACCESS_FIXTURES } from "../recruiter-access-fixtures.mjs";
import { INVITE_FIXTURES } from "../recruiter-invite-fixtures.mjs";
import { ptBR } from "./shared.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSWORD = "senha-do-convite-e2e-42";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  const fake = process.env.E2E_FAKE_OIDC;
  const sink = process.env.E2E_MAIL_SINK;
  if (!fake || !sink) {
    // Fora do `run-isolated` não há emissor falso nem sink: o link do convite
    // só existe no e-mail. Avisa, sem fingir que provou.
    console.warn("[e2e] recruiter-invite pulada: E2E_FAKE_OIDC ou E2E_MAIL_SINK ausente (rode pelo run-isolated)");
    return;
  }
  const [{ eq }, { getDb }, { authUser, recruiterInvite }] = await Promise.all([
    import("drizzle-orm"),
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
  ]);
  const [inviter] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, INVITE_FIXTURES.inviter.email));
  const anaId = inviter.candidateId;
  const ANA = INVITE_FIXTURES.inviter.name;
  const masked = (email) => `${email.slice(0, 1)}•••${email.slice(email.lastIndexOf("@"))}`;

  let ipCounter = 0;
  async function fresh({ viewport = { width: 1280, height: 900 }, track = true } = {}) {
    ipCounter += 1;
    const ip = `203.0.113.${60 + ipCounter}`;
    // `serviceWorkers: "block"`, como em `sign-up.mjs`: o service worker
    // refaria as requisições por conta própria, fora do `route`.
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    await context.route(`${BASE}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    if (track) trackConsole(page);
    return { context, page };
  }

  /** Espera a troca de tela terminar: com a casca `inert`, clique e digitação caem no vazio. */
  async function settled(page) {
    await page.waitForFunction(
      () => !document.getElementById("application-shell")?.hasAttribute("inert")
        && !document.getElementById("application-shell")?.hasAttribute("aria-busy")
        && document.querySelector('[data-testid="navigation-transition"]') === null,
      null,
      { timeout: 15_000 },
    ).catch(() => undefined);
  }

  async function signIn(page, email, password = E2E_PASSWORD) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await settled(page);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
  }

  async function openAccount(page) {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await settled(page);
    await page.locator('[data-testid="recruiter-access"]').waitFor({ timeout: 15_000 });
  }

  const text = async (locator) => ((await locator.first().textContent().catch(() => "")) ?? "").trim();
  const inviteRow = (page, email) => page.locator('[data-testid="recruiter-invite"]').filter({ hasText: email });
  const grantRow = (page, email) => page.locator('[data-testid="recruiter-grant"]').filter({ hasText: email });
  const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const hasInviteCookie = async (context) => (await context.cookies()).some((cookie) => cookie.name === "jho_invite");
  const pathOf = (page) => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  };

  async function scenario(id, body) {
    try {
      await body();
    } catch (error) {
      check(`${id} terminou sem exceção`, false, String(error).replace(/\s+/g, " ").slice(0, 300));
    }
  }

  /** A candidata convida pela seção de acesso; devolve o caminho do link que o sink recebeu. */
  async function invite(page, email) {
    await page.locator('[data-testid="recruiter-access-email"]').fill(email);
    await page.locator('[data-testid="recruiter-access-end-date"]').fill("");
    await page.locator('[data-testid="recruiter-access-submit"]').click();
    await inviteRow(page, email).waitFor({ timeout: 15_000 });
    const mail = await waitForMail(sink, email, (item) => /\/signup\/invite\?token=/.test(item.text));
    const href = /(https?:\/\/[^\s]+\/signup\/invite\?token=[A-Za-z0-9_%-]+)/.exec(mail?.text ?? "")?.[1] ?? null;
    if (href === null) throw new Error(`convite sem link no sink: ${email}`);
    const url = new URL(href);
    return `${url.pathname}${url.search}`;
  }

  /** Abre o link sem sessão e clica em "Criar conta de recrutador". */
  async function startFromLink(page, link) {
    await page.goto(`${BASE}${link}`, { waitUntil: "networkidle" });
    await settled(page);
    await page.locator('[data-testid="invite-create-account"]').click();
    await page.waitForURL((url) => url.pathname === "/signup", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await settled(page);
  }

  /** Cadastro manual de recrutador a partir de `/signup`, até o código do sink. */
  async function manualRecruiter(page, { name, email }) {
    await page.fill('[data-testid="signup-name"]', name);
    await page.fill('[data-testid="signup-email"]', email);
    await page.fill('[data-testid="signup-password"]', PASSWORD);
    await page.locator('[data-testid="signup-terms"]').check();
    await page.locator('[data-testid="signup-submit"]').click();
    await page.waitForURL((url) => url.pathname === "/signup/verify", { timeout: 20_000 }).catch(() => undefined);
    await page.locator('[data-testid="verify-code"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await settled(page);
    const code = codeIn(await waitForMail(sink, email, (mail) => mail.subject === ptBR.email.codeSubject));
    await page.fill('[data-testid="verify-code"]', code ?? "000000");
    await page.locator('[data-testid="verify-submit"]').click();
  }

  /* ------------------ A candidata convida quatro endereços ------------------ */
  const owner = await fresh();
  await signIn(owner.page, INVITE_FIXTURES.inviter.email);
  await openAccount(owner.page);
  const links = {};
  for (const key of ["social", "manual", "invited", "cancelled"]) {
    links[key] = await invite(owner.page, INVITE_FIXTURES[key].email);
  }
  // Cancela o da Eva antes de alguém abrir (E2E-013).
  const eva = inviteRow(owner.page, INVITE_FIXTURES.cancelled.email);
  await eva.locator('[data-testid="recruiter-invite-cancel"]').click();
  await eva.locator('[data-testid="recruiter-invite-cancel-dialog"]').waitFor({ state: "visible" });
  await eva.locator('[data-testid="recruiter-invite-cancel-confirm"]').click();
  await inviteRow(owner.page, INVITE_FIXTURES.cancelled.email).waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});

  /* ----------- E2E-013: link cancelado e token inventado, mesma página ------ */
  await scenario("E2E-013", async () => {
    const { context, page } = await fresh();
    await page.goto(`${BASE}${links.cancelled}`, { waitUntil: "networkidle" });
    const cancelled = await page.locator("main").innerHTML();
    const neutral = await page.locator('[data-testid="invite-neutral"]').count();
    await page.goto(`${BASE}/signup/invite?token=${"x".repeat(43)}`, { waitUntil: "networkidle" });
    const random = await page.locator("main").innerHTML();
    const cookie = await hasInviteCookie(context);
    await context.close();
    check(
      "E2E-013 link cancelado e token inventado mostram a mesma página neutra, sem cookie de convite",
      neutral === 1 && cancelled === random && cancelled.includes(ptBR.recruiterInvite.neutralTitle) && !cookie,
      JSON.stringify({ neutral, same: cancelled === random, cookie }),
    );
  });

  /* -------- E2E-014: sessão de outra conta abre o link válido da Bia -------- */
  await scenario("E2E-014", async () => {
    const { context, page } = await fresh();
    await signIn(page, ACCESS_FIXTURES.recruiter.email);
    await page.goto(`${BASE}${links.social}`, { waitUntil: "networkidle" });
    const message = await text(page.locator('[data-testid="invite-other-email-message"]'));
    const body = await page.locator("main").innerText();
    const actions = await page.locator('[data-testid="invite-accept"], [data-testid="invite-create-account"]').count();
    const [row] = await getDb()
      .select({ status: recruiterInvite.status })
      .from(recruiterInvite)
      .where(eq(recruiterInvite.email, INVITE_FIXTURES.social.email));
    await context.close();
    check(
      "E2E-014 Rui com sessão vê 'Este convite é para b•••@… Saia para continuar.', sem o nome da candidata nem botão; o convite segue pendente",
      message === `${ptBR.recruiterInvite.otherEmail} ${masked(INVITE_FIXTURES.social.email)}. ${ptBR.recruiterInvite.signOutToContinue}`
        && !body.includes(ANA)
        && actions === 0
        && row?.status === "pending",
      JSON.stringify({ message, actions, status: row?.status }),
    );
  });

  /* ---------------- E2E-015: estados da página em 375 px e axe -------------- */
  await scenario("E2E-015", async () => {
    const measure = async (page, path) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await settled(page);
      const axe = await new AxeBuilder({ page }).include("main").withTags(TAGS).analyze();
      return { overflow: await overflowOf(page), violations: axe.violations.map((violation) => violation.id) };
    };
    // Sem coletor de console: o axe baixa as folhas de estilo de outra origem
    // para medir contraste, e a CSP recusa as fontes — aviso do instrumento.
    const anonymous = await fresh({ viewport: { width: 375, height: 812 }, track: false });
    const states = {
      anonymous: await measure(anonymous.page, links.social),
      neutral: await measure(anonymous.page, links.cancelled),
    };
    await anonymous.context.close();
    const other = await fresh({ viewport: { width: 375, height: 812 }, track: false });
    await signIn(other.page, ACCESS_FIXTURES.recruiter.email);
    states.otherEmail = await measure(other.page, links.social);
    await other.context.close();
    check(
      "E2E-015 /signup/invite sem sessão, neutra e com outra conta: 375 px sem rolagem horizontal e sem violação axe",
      Object.values(states).every((state) => state.overflow <= 1 && state.violations.length === 0),
      JSON.stringify(states),
    );
  });

  /* ------- E2E-010: Bia pelo Google, com o e-mail convidado, chega na Ana ---- */
  await scenario("E2E-010", async () => {
    const { context, page } = await fresh();
    await page.goto(`${BASE}${links.social}`, { waitUntil: "networkidle" });
    await settled(page);
    const landing = {
      candidate: await text(page.locator('[data-testid="invite-candidate"]')),
      expected: await text(page.locator('[data-testid="invite-expected-email"]')),
      signIn: await page.locator('[data-testid="invite-sign-in"]').count(),
    };
    await page.locator('[data-testid="invite-create-account"]').click();
    await page.waitForURL((url) => url.pathname === "/signup", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await settled(page);
    const beforeProvider = {
      at: pathOf(page),
      recruiter: await page.locator('[data-testid="signup-role-recruiter"]').isChecked(),
      invited: await text(page.locator('[data-testid="signup-invited"]')),
      cookie: await hasInviteCookie(context),
    };

    await setRemoteBehavior(fake, "google", { sub: INVITE_FIXTURES.social.sub, email: INVITE_FIXTURES.social.email });
    await page.locator('[data-testid="signup-social-google"]').click();
    await page.waitForURL((url) => url.origin === BASE && url.pathname === "/signup", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await settled(page);
    const afterProvider = {
      verified: await text(page.locator('[data-testid="signup-verified-email"]')),
      recruiter: await page.locator('[data-testid="signup-role-recruiter"]').isChecked(),
      invited: await text(page.locator('[data-testid="signup-invited"]')),
    };
    await page.fill('[data-testid="signup-name"]', INVITE_FIXTURES.social.name);
    await page.locator('[data-testid="signup-terms"]').check();
    await page.locator('[data-testid="signup-submit"]').click();
    await page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 20_000 }).catch(() => undefined);
    const landed = new URL(page.url()).pathname;
    const cookieAfter = await hasInviteCookie(context);
    await context.close();

    await openAccount(owner.page);
    const status = await text(grantRow(owner.page, INVITE_FIXTURES.social.email).locator('[data-testid="recruiter-grant-status"]'));
    const kinds = await owner.page
      .locator('[data-testid="recruiter-access-history-entry"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-kind")));
    const granted = await waitForMail(sink, INVITE_FIXTURES.social.email, (mail) => mail.subject.includes("deu acesso"));
    check(
      "E2E-010 o link nomeia a Ana e b•••@…; 'Criar conta' leva a /signup com Recrutador marcado e 'Convidado por'; o Google com o e-mail convidado cai na página da Ana",
      landing.candidate === ANA
        && landing.expected === masked(INVITE_FIXTURES.social.email)
        && landing.signIn === 1
        && beforeProvider.at === "/signup?role=recruiter"
        && beforeProvider.recruiter
        && beforeProvider.invited.includes(ANA)
        && beforeProvider.cookie
        && afterProvider.verified === INVITE_FIXTURES.social.email
        && afterProvider.recruiter
        && afterProvider.invited.includes(ANA)
        && landed === `/recruiter/${anaId}`
        && !cookieAfter,
      JSON.stringify({ landing, beforeProvider, afterProvider, landed, cookieAfter }),
    );
    check(
      "E2E-010 a lista da Ana mostra a Bia Ativa, o histórico 'convite aceito' e a Bia recebe o e-mail de acesso",
      status === ptBR.recruiterAccess.statusActive
        && kinds.includes("invite_accepted")
        && kinds.indexOf("grant_created") < kinds.indexOf("invite_accepted")
        && granted !== null
        && granted.text.includes(`/recruiter/${anaId}`),
      JSON.stringify({ status, kinds, mail: granted?.subject ?? null }),
    );
  });

  /* --------- E2E-011: Caio pelo cadastro manual, com o código do sink -------- */
  await scenario("E2E-011", async () => {
    const { context, page } = await fresh();
    await startFromLink(page, links.manual);
    const preselected = await page.locator('[data-testid="signup-role-recruiter"]').isChecked();
    await manualRecruiter(page, INVITE_FIXTURES.manual);
    await page.waitForURL((url) => url.pathname === `/recruiter/${anaId}`, { timeout: 20_000 }).catch(() => undefined);
    const landed = new URL(page.url()).pathname;
    await context.close();
    await openAccount(owner.page);
    const status = await text(grantRow(owner.page, INVITE_FIXTURES.manual.email).locator('[data-testid="recruiter-grant-status"]'));
    check(
      "E2E-011 o cadastro manual com o e-mail convidado e o código do sink cai na página da Ana, e ela vê o Caio Ativo",
      preselected && landed === `/recruiter/${anaId}` && status === ptBR.recruiterAccess.statusActive,
      JSON.stringify({ preselected, landed, status }),
    );
  });

  /* ---------- E2E-012: cadastro pelo link de Dani com outro endereço --------- */
  await scenario("E2E-012", async () => {
    const { context, page } = await fresh();
    await startFromLink(page, links.invited);
    await manualRecruiter(page, INVITE_FIXTURES.other);
    await page.waitForURL((url) => url.pathname === "/recruiter", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    const at = pathOf(page);
    const notice = page.locator('[data-testid="recruiter-invite-notice"]');
    const shown = { kind: await notice.getAttribute("data-notice").catch(() => null), message: await text(notice) };
    const candidateLinks = await page.locator(`[data-testid="recruiter-candidate-${anaId}"]`).count();
    const body = await page.locator("main").innerText();
    await context.close();
    const [row] = await getDb()
      .select({ status: recruiterInvite.status })
      .from(recruiterInvite)
      .where(eq(recruiterInvite.email, INVITE_FIXTURES.invited.email));
    check(
      "E2E-012 outro e-mail pelo link: conta criada, /recruiter avisa o descompasso sem nada da Ana, e o convite de Dani segue pendente",
      at === "/recruiter?invite=mismatch"
        && shown.kind === "mismatch"
        && shown.message === ptBR.recruiterInvite.noticeMismatch
        && candidateLinks === 0
        && !body.includes(ANA)
        && row?.status === "pending",
      JSON.stringify({ at, shown, candidateLinks, status: row?.status }),
    );
  });

  await owner.context.close();
}
