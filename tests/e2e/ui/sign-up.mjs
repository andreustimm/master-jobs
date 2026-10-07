// Área `sign-up` do E2E de navegador: cadastro aberto em tela única (#464),
// social (emissor OIDC falso) e manual (código lido do sink de e-mail), por
// papel (G16), com o limite por IP, a etapa do código e 375 px.
//
// Cada cenário abre um contexto próprio e se apresenta com um IP próprio
// (`x-forwarded-for`, que o servidor fora da Vercel aceita como o IP do
// cliente): o limite de três cadastros por IP por hora não pode vazar de um
// cenário para outro.
import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { setRemoteBehavior } from "../fake-oidc.mjs";
import { codeIn, mailsTo, waitForMail } from "../mail-sink.mjs";
import { ptBR } from "./shared.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSWORD = "senha-do-cadastro-e2e-42";

export async function run(ctx) {
  const { BASE, browser, check, trackConsole } = ctx;
  const fake = process.env.E2E_FAKE_OIDC;
  const sink = process.env.E2E_MAIL_SINK;
  const ipSecret = process.env.JHO_SIGNUP_IP_SECRET;
  if (!fake || !sink || !ipSecret) {
    // Fora do `run-isolated` não há emissor falso nem sink, e o servidor alvo
    // nem os aceitaria fora de `JHO_ENV=e2e`. Avisa, sem fingir que provou.
    console.warn("[e2e] sign-up pulada: E2E_FAKE_OIDC, E2E_MAIL_SINK ou JHO_SIGNUP_IP_SECRET ausente (rode pelo run-isolated)");
    return;
  }
  const [{ eq }, { getDb }, { authSignup, authUser, candidate }, { pdfComTexto }] = await Promise.all([
    import("drizzle-orm"),
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
    import("../../support/synthetic-pdf.ts"),
  ]);

  let ipCounter = 0;
  async function fresh(viewport = { width: 1280, height: 900 }) {
    ipCounter += 1;
    const ip = `198.51.100.${100 + ipCounter}`;
    // `serviceWorkers: "block"`, como nas outras áreas que interceptam rota: o
    // service worker refaria as requisições por conta própria, fora do `route`.
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    // Só nas requisições ao app: num cabeçalho do contexto inteiro ele iria
    // também às fontes de terceiros, cuja checagem de CORS o recusa.
    await context.route(`${BASE}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    const page = await context.newPage();
    trackConsole(page);
    return { context, page, ip };
  }

  /**
   * Espera a troca de tela terminar. Durante a transição a casca fica `inert`
   * (`navigation-transition.tsx`): digitar ali não chega ao campo, e o axe
   * mediria o conteúdo esmaecido.
   */
  async function settled(page) {
    await page.waitForFunction(
      () => !document.getElementById("application-shell")?.hasAttribute("inert")
        && !document.getElementById("application-shell")?.hasAttribute("aria-busy")
        && document.querySelector('[data-testid="navigation-transition"]') === null,
      null,
      { timeout: 15_000 },
    ).catch(() => undefined);
  }

  /**
   * Largura e axe numa aba própria do mesmo contexto (mesmos cookies), sem
   * rastreio de console — como em `a11y.mjs`: o axe busca as folhas de estilo
   * por XHR para montar o CSSOM, e a CSP recusa a das fontes, o que não é erro
   * da tela medida.
   */
  async function measure(context, path) {
    const probe = await context.newPage();
    try {
      await probe.setViewportSize({ width: 375, height: 812 });
      await probe.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await settled(probe);
      const overflow = await overflowOf(probe);
      const axe = await new AxeBuilder({ page: probe }).withTags(TAGS).analyze();
      return {
        at: new URL(probe.url()).pathname,
        overflow,
        violations: axe.violations.map((violation) => [violation.id, violation.nodes.map((node) => node.target)]),
      };
    } finally {
      await probe.close();
    }
  }

  const cvPdf = (marker) =>
    Buffer.from(pdfComTexto([Array.from({ length: 6 }, (_, i) => `${marker}, entrega ${i + 1}, com observabilidade e testes`)]));
  const hasSession = async (context) => (await context.cookies()).some((cookie) => cookie.name === "jho_session");
  const errorText = async (page) =>
    ((await page.locator('[data-testid="signup-error"]').textContent({ timeout: 10_000 }).catch(() => "")) ?? "").trim();
  const overflowOf = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const userByEmail = async (email) => (await getDb().select().from(authUser).where(eq(authUser.email, email)))[0] ?? null;

  /** Da tela de cadastro para o provedor e de volta para `/signup` no modo social. */
  async function socialToSignup(page, provider, behavior) {
    await setRemoteBehavior(fake, provider, behavior);
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await page.locator(`[data-testid="signup-social-${provider}"]`).click();
    await page.waitForURL((url) => url.origin === BASE && url.pathname === "/signup", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await settled(page);
  }

  async function submitAndLand(page, path) {
    await page.locator('[data-testid="signup-submit"]').click();
    await page.waitForURL((url) => url.origin === BASE && url.pathname === path, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await settled(page);
  }

  /** Envia o formulário manual e espera a etapa do código, pronta para digitar. */
  async function submitToVerify(page) {
    await page.locator('[data-testid="signup-submit"]').click();
    await page.waitForURL((url) => url.pathname === "/signup/verify", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="verify-code"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await settled(page);
  }

  /** Formulário manual de candidato, com o PDF; não envia. */
  async function fillManualCandidate(page, { name, email, marker }) {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await settled(page);
    await page.locator('[data-testid="signup-role-candidate"]').check();
    await page.fill('[data-testid="signup-name"]', name);
    await page.fill('[data-testid="signup-headline"]', "Engenharia de plataforma");
    await page.locator('[data-testid="signup-cv-file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: cvPdf(marker) });
    await page.fill('[data-testid="signup-email"]', email);
    await page.fill('[data-testid="signup-password"]', PASSWORD);
    await page.locator('[data-testid="signup-terms"]').check();
  }

  async function enterCode(page, code) {
    await settled(page);
    await page.fill('[data-testid="verify-code"]', code);
    await page.locator('[data-testid="verify-submit"]').click();
  }

  /* ------------------- E2E-011 candidato pelo Google ------------------- */
  {
    const email = "e2e-cadastro-google@local.test";
    const marker = "Migracao de plataforma Kubernetes liderada no cadastro social";
    const { context, page } = await fresh();
    await socialToSignup(page, "google", { sub: "e2e-cadastro-google", email });
    const shown = ((await page.locator('[data-testid="signup-verified-email"]').textContent().catch(() => "")) ?? "").trim();
    const roles = await page.locator('input[name="role"]').evaluateAll((inputs) => inputs.map((input) => input.value));
    const noCredentials =
      (await page.locator('[data-testid="signup-email"]').count()) === 0 && (await page.locator('[data-testid="signup-password"]').count()) === 0;
    const html = await page.content();
    check(
      "E2E-011 /signup volta do Google com o e-mail confirmado só para leitura, sem senha, só Candidato e Recrutador",
      shown === email && noCredentials && JSON.stringify(roles) === JSON.stringify(["candidate", "recruiter"]) && !/value="admin"/.test(html),
      JSON.stringify({ shown, roles, noCredentials }),
    );

    // 375 px no modo social (E2E-024).
    await page.setViewportSize({ width: 375, height: 812 });
    check("E2E-024 /signup no modo social cabe em 375 px", (await overflowOf(page)) <= 1);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.fill('[data-testid="signup-name"]', "Cadastro Google E2E");
    await page.fill('[data-testid="signup-headline"]', "Engenharia de plataforma");
    await page.locator('[data-testid="signup-cv-file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: cvPdf(marker) });
    await page.locator('[data-testid="signup-terms"]').check();
    await submitAndLand(page, "/");
    const landed = new URL(page.url()).pathname;
    const welcome = await waitForMail(sink, email, (mail) => mail.subject === ptBR.email.welcomeSubject);
    const user = await userByEmail(email);
    const [own] = user?.candidateId ? await getDb().select().from(candidate).where(eq(candidate.id, user.candidateId)) : [];
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const cvShown = (await page.locator('textarea[name="content"]').inputValue().catch(() => "")).includes(marker);
    check(
      "E2E-011 conclui no cockpit, com conta candidata nova, CV do PDF e boas-vindas no sink",
      landed === "/" && (await hasSession(context)) && welcome !== null && user?.roles?.[0] === "candidate" && own?.isDefault === false && cvShown,
      JSON.stringify({ landed, welcome: welcome?.subject ?? null, roles: user?.roles, isDefault: own?.isDefault, cvShown }),
    );
    // Só o próprio dado: o candidato do dono (o padrão) não é o desta conta.
    const ownerCandidate = (await getDb().select().from(candidate).where(eq(candidate.isDefault, true)))[0];
    const foreign = ownerCandidate ? await page.request.get(`${BASE}/recruiter/${ownerCandidate.id}`, { maxRedirects: 0 }) : null;
    // Recusa ou desvio, nunca a página servida: 403/404 ou redirecionamento
    // para fora do candidato alheio.
    check(
      "E2E-011 a conta nova não alcança o candidato de outra pessoa",
      ownerCandidate !== undefined && ownerCandidate.id !== user?.candidateId && foreign !== null && foreign.status() !== 200
        && !(foreign.headers().location ?? "").includes(`/recruiter/${ownerCandidate.id}`),
      `status=${foreign?.status()} location=${foreign?.headers().location ?? ""}`,
    );
    await context.close();
  }

  /* ----------------------- E2E-012 sem pendência ------------------------ */
  {
    const { context, page } = await fresh();
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    check(
      "E2E-012 /signup sem pendência social mostra o formulário manual, sem e-mail só para leitura",
      new URL(page.url()).pathname === "/signup"
        && (await page.locator('[data-testid="signup-email"]').count()) === 1
        && (await page.locator('[data-testid="signup-verified-email"]').count()) === 0,
    );
    await context.close();
  }

  /* -------------------- E2E-013 recusas que mantêm campos ---------------- */
  {
    const email = "e2e-cadastro-recusa@local.test";
    const { context, page } = await fresh();
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await settled(page);
    await page.fill('[data-testid="signup-name"]', "Recusa E2E");
    await page.fill('[data-testid="signup-email"]', email);
    await page.fill('[data-testid="signup-password"]', PASSWORD);
    await page.locator('[data-testid="signup-cv-file"]').setInputFiles({
      name: "nao-e-cv.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("texto renomeado para parecer PDF"),
    });
    await page.locator('[data-testid="signup-submit"]').click();
    const noTerms = await errorText(page);
    await page.locator('[data-testid="signup-terms"]').check();
    await page.locator('[data-testid="signup-submit"]').click();
    await page.waitForFunction(
      (previous) => document.querySelector('[data-testid="signup-error"]')?.textContent?.trim() !== previous,
      noTerms,
      { timeout: 10_000 },
    ).catch(() => undefined);
    const notPdf = await errorText(page);
    const kept = await page.locator('[data-testid="signup-name"]').inputValue();
    const created = (await userByEmail(email)) !== null || (await getDb().select().from(authSignup).where(eq(authSignup.email, email))).length > 0;
    check(
      "E2E-013 sem aceite e com arquivo que não é PDF: as duas mensagens, campos mantidos, nada criado",
      noTerms === ptBR.signup.errorTerms && notPdf === ptBR.onboarding.pdfNotPdf && kept === "Recusa E2E" && !created,
      JSON.stringify({ noTerms, notPdf, kept, created }),
    );
    await context.close();
  }

  /* ---------------- E2E-014 recrutador pelo LinkedIn ---------------- */
  {
    const email = "e2e-cadastro-linkedin@local.test";
    const { context, page } = await fresh();
    await socialToSignup(page, "linkedin", { sub: "e2e-cadastro-linkedin", email, emailVerified: true });
    await page.locator('[data-testid="signup-role-recruiter"]').check();
    const candidateFieldsHidden = !(await page.locator('[data-testid="signup-headline"]').isVisible());
    await page.fill('[data-testid="signup-name"]', "Recrutadora E2E");
    await page.locator('[data-testid="signup-terms"]').check();
    await submitAndLand(page, "/recruiter");
    const emptyState = (await page.locator('[data-testid="recruiter-empty-state"]').count()) === 1;
    const user = await userByEmail(email);
    const welcome = await waitForMail(sink, email, (mail) => mail.subject === ptBR.email.welcomeSubject);
    check(
      "E2E-014 recrutador pelo LinkedIn: sem campos de candidato, cai no estado vazio que explica o acesso",
      candidateFieldsHidden && new URL(page.url()).pathname === "/recruiter" && emptyState
        && user?.roles?.[0] === "recruiter" && user?.candidateId === null && welcome !== null,
      JSON.stringify({ candidateFieldsHidden, at: page.url().replace(BASE, ""), emptyState, roles: user?.roles }),
    );
    // E2E-024: o estado vazio em 375 px e no axe.
    const measured = await measure(context, "/recruiter");
    check(
      "E2E-024 estado vazio do recrutador em 375 px, sem violação axe",
      measured.at === "/recruiter" && measured.overflow <= 1 && measured.violations.length === 0,
      JSON.stringify(measured),
    );
    await context.close();
  }

  /* ------------------------ E2E-015 limite por IP ------------------------ */
  {
    const { context, page, ip } = await fresh();
    // Três cadastros concluídos deste IP na última hora, gravados como o
    // servidor grava: HMAC do IP com a chave da execução, nunca o IP cru.
    const ipHmac = createHmac("sha256", ipSecret).update(ip).digest("hex");
    const at = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) {
      await getDb().insert(authSignup).values({
        kind: "social",
        tokenHash: createHmac("sha256", "e2e").update(`limite-${ip}-${i}`).digest("hex"),
        email: `e2e-limite-${i}@local.test`,
        locale: "pt-BR",
        ipHmac,
        createdAt: at,
        expiresAt: at,
        completedAt: at,
      });
    }
    const email = "e2e-cadastro-quarto@local.test";
    await socialToSignup(page, "google", { sub: "e2e-cadastro-quarto", email });
    await page.fill('[data-testid="signup-name"]', "Quarto Cadastro");
    await page.locator('[data-testid="signup-role-recruiter"]').check();
    await page.locator('[data-testid="signup-terms"]').check();
    await page.locator('[data-testid="signup-submit"]').click();
    const message = await errorText(page);
    check(
      "E2E-015 o quarto cadastro do mesmo IP na hora vê o limite, e nada é criado",
      message === ptBR.signup.errorIpCap && (await userByEmail(email)) === null && !(await hasSession(context)),
      message,
    );
    await context.close();
  }

  /* --------- E2E-025/027 manual com código, depois entra com senha -------- */
  const manualEmail = "e2e-cadastro-manual@local.test";
  {
    const { context, page } = await fresh();
    await fillManualCandidate(page, { name: "Cadastro Manual E2E", email: manualEmail, marker: "Plataforma de dados do cadastro manual" });
    await submitToVerify(page);
    const notice = ((await page.locator('[data-testid="verify-expiry"]').textContent().catch(() => "")) ?? "").trim();
    const shownEmail = ((await page.locator('[data-testid="verify-email"]').textContent().catch(() => "")) ?? "").trim();
    const noAccountYet = (await userByEmail(manualEmail)) === null;
    const codeMail = await waitForMail(sink, manualEmail, (mail) => mail.subject === ptBR.email.codeSubject);
    const code = codeIn(codeMail);
    check(
      "E2E-025 envio manual leva a 'Confira seu e-mail' com o aviso de 15 minutos, e a conta ainda não existe",
      new URL(page.url()).pathname === "/signup/verify" && shownEmail === manualEmail && notice.includes("15 minutos")
        && noAccountYet && code !== null,
      JSON.stringify({ at: page.url().replace(BASE, ""), shownEmail, notice, noAccountYet, code: code !== null }),
    );
    // 375 px e axe na etapa do código com pendência ativa (E2E-024).
    const measured = await measure(context, "/signup/verify");
    check(
      "E2E-024 /signup/verify com pendência em 375 px, sem violação axe",
      measured.at === "/signup/verify" && measured.overflow <= 1 && measured.violations.length === 0,
      JSON.stringify(measured),
    );

    await enterCode(page, code ?? "000000");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    const welcome = await waitForMail(sink, manualEmail, (mail) => mail.subject === ptBR.email.welcomeSubject);
    const user = await userByEmail(manualEmail);
    check(
      "E2E-025 o código do sink cria a conta e entra no cockpit; boas-vindas no sink",
      new URL(page.url()).pathname === "/" && (await hasSession(context)) && welcome !== null && user?.emailVerifiedAt !== null,
      JSON.stringify({ at: page.url().replace(BASE, ""), welcome: welcome !== null }),
    );
    await context.close();
  }
  {
    const { context, page } = await fresh();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await settled(page);
    await page.fill('input[name="email"]', manualEmail);
    await page.fill('input[name="password"]', PASSWORD);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => undefined);
    check(
      "E2E-027 a conta confirmada entra com e-mail e senha",
      new URL(page.url()).pathname === "/" && (await hasSession(context)),
      page.url().replace(BASE, ""),
    );
    await context.close();
  }

  /* -------------------- E2E-026 e-mail já cadastrado --------------------- */
  {
    const registered = process.env.E2E_EMAIL ?? "e2e@local.test";
    const before = (await mailsTo(sink, registered)).length;
    const { context, page } = await fresh();
    await fillManualCandidate(page, { name: "Tentativa Repetida", email: registered, marker: "Tentativa com e-mail que ja tem conta" });
    await submitToVerify(page);
    const notice = await waitForMail(sink, registered, (mail) => mail.subject === ptBR.email.existsSubject);
    const after = await mailsTo(sink, registered);
    check(
      "E2E-026 e-mail com conta vê o mesmo 'Confira seu e-mail'; o sink tem o aviso de conta existente, sem código",
      new URL(page.url()).pathname === "/signup/verify"
        && (await page.locator('[data-testid="verify-code"]').count()) === 1
        && notice !== null && codeIn(notice) === null && after.length === before + 1,
      JSON.stringify({ at: page.url().replace(BASE, ""), notice: notice?.subject ?? null }),
    );
    await context.close();
  }

  /* ------------- E2E-028 código errado e reenvio com espera -------------- */
  {
    const email = "e2e-cadastro-reenvio@local.test";
    const { context, page } = await fresh();
    await fillManualCandidate(page, { name: "Reenvio E2E", email, marker: "Cadastro que testa o reenvio do codigo" });
    await submitToVerify(page);
    const first = codeIn(await waitForMail(sink, email, (mail) => mail.subject === ptBR.email.codeSubject));
    const wrong = first === "000000" ? "111111" : "000000";
    await enterCode(page, wrong);
    const wrongMessage = ((await page.locator('[data-testid="verify-error"]').textContent({ timeout: 10_000 }).catch(() => "")) ?? "").trim();
    const resend = page.locator('[data-testid="verify-resend"]');
    const waiting = { disabled: await resend.isDisabled(), label: ((await resend.textContent()) ?? "").trim() };
    check(
      "E2E-028 código errado diz quantas tentativas restam; o reenvio fica desabilitado com contagem",
      wrongMessage === ptBR.signup.verifyWrong.replace("{count}", "4") && waiting.disabled && /\d+ s$/.test(waiting.label),
      JSON.stringify({ wrongMessage, waiting }),
    );

    // O relógio da espera é o `code_sent_at` da pendência: recuá-lo 61 s é o
    // mesmo que esperar, sem dormir na suíte.
    const past = new Date(Date.now() - 61_000).toISOString();
    await getDb().update(authSignup).set({ codeSentAt: past }).where(eq(authSignup.email, email));
    await page.reload({ waitUntil: "networkidle" });
    await settled(page);
    const enabled = await resend.isEnabled();
    await resend.click();
    await page.locator('[data-testid="verify-status"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
    const status = ((await page.locator('[data-testid="verify-status"]').textContent().catch(() => "")) ?? "").trim();
    const codes = (await mailsTo(sink, email)).filter((mail) => mail.subject === ptBR.email.codeSubject);
    const disabledAgain = await resend.isDisabled();
    check(
      "E2E-028 passada a espera, o reenvio habilita, manda outro código e volta a contar",
      enabled && status === ptBR.signup.verifyResent && codes.length === 2 && disabledAgain,
      JSON.stringify({ enabled, status, codes: codes.length, disabledAgain }),
    );
    await enterCode(page, codeIn(codes[1]) ?? "000000");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 }).catch(() => undefined);
    check("E2E-028 o código reenviado confirma o cadastro", new URL(page.url()).pathname === "/", page.url().replace(BASE, ""));
    await context.close();
  }

  /* ------------------ E2E-029 "Já tenho um código" ---------------------- */
  {
    const email = "e2e-cadastro-volta@local.test";
    const { context, page } = await fresh();
    await fillManualCandidate(page, { name: "Volta Depois E2E", email, marker: "Cadastro que sai e volta com o codigo" });
    await submitToVerify(page);
    const code = codeIn(await waitForMail(sink, email, (mail) => mail.subject === ptBR.email.codeSubject));
    // Sai para outra página e volta ao cadastro.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await settled(page);
    const offered = (await page.locator('[data-testid="signup-have-code"]').count()) === 1;
    await page.locator('[data-testid="signup-have-code"]').click();
    await page.waitForURL((url) => url.pathname === "/signup/verify", { timeout: 20_000 }).catch(() => undefined);
    await page.locator('[data-testid="verify-code"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await enterCode(page, code ?? "000000");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 }).catch(() => undefined);
    check(
      "E2E-029 voltar a /signup oferece 'Já tenho um código', e ele confirma o cadastro",
      offered && new URL(page.url()).pathname === "/" && (await userByEmail(email)) !== null,
      JSON.stringify({ offered, at: page.url().replace(BASE, "") }),
    );
    await context.close();
  }

  /* --------------------- E2E-024 telas em 375 px ------------------------- */
  {
    const { context, page } = await fresh({ width: 375, height: 812 });
    const widths = {};
    for (const path of ["/signup", "/signup/verify", "/terms", "/privacy"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      widths[path] = await overflowOf(page);
    }
    check(
      "E2E-024 /signup, /signup/verify, /terms e /privacy cabem em 375 px",
      Object.values(widths).every((overflow) => overflow <= 1),
      JSON.stringify(widths),
    );
    await context.close();
  }
}
