// Área `recruiter-directory` do E2E de navegador: diretório de perfis para
// recrutadores (#465, ADR-013), por papel (G16). Contas e perfis fixos em
// `../recruiter-directory-fixtures.mjs`, gravados por `setup.mjs`.
import AxeBuilder from "@axe-core/playwright";
import { DIRECTORY_FIXTURES } from "../recruiter-directory-fixtures.mjs";
import { RECRUITER_SWEEP } from "../routes.mjs";
import { makePortugueseLeaks } from "./shared.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const { paula, rita, pedro } = DIRECTORY_FIXTURES;
/** O que nunca pode aparecer em tela do diretório (E2E-027). */
const SECRETS = [...paula.secrets, ...rita.secrets, ...pedro.secrets];

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole } = ctx;
  const portugueseLeaks = makePortugueseLeaks(ctx);

  /** Uma sessão nova, com idioma e largura próprios. */
  async function signIn(email, { locale = "pt-BR", viewport = { width: 1280, height: 900 }, track = true } = {}) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: "jho_locale", value: locale, url: BASE }]);
    const page = await context.newPage();
    if (track) trackConsole(page);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => undefined);
    return { context, page };
  }

  /** O id do cartão cujo nome é este, ou `null`. */
  async function cardId(page, name) {
    const card = page.locator('[data-testid^="directory-card-"]', { hasText: name });
    if ((await card.count()) === 0) return null;
    return Number((await card.first().getAttribute("data-testid")).replace("directory-card-", ""));
  }

  /** Busca pela tela: preenche, envia e espera a lista da busca nova. */
  async function searchFor(page, text) {
    await page.fill('[data-testid="directory-q"]', text);
    await page.locator('[data-testid="directory-submit"]').click();
    await page.waitForURL((url) => url.searchParams.get("q") === text, { timeout: 15_000 });
    await page.locator('[data-testid="directory-chip-q"]').waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
  }

  const seen = [];
  const remember = async (page) => seen.push(`${new URL(page.url()).pathname}\n${await page.locator("main").innerText()}`);

  /* ---------------- E2E-024: busca, filtro e leitura do perfil -------------- */
  const recruiter = await signIn(DIRECTORY_FIXTURES.recruiter.email);
  const page = recruiter.page;
  {
    const failures = [];
    const opened = await page.goto(`${BASE}/recruiter/directory`, { waitUntil: "networkidle" });
    if (opened?.status() !== 200) failures.push(`/recruiter/directory deu ${opened?.status()}`);
    if ((await page.locator('[data-testid="nav-directory"]').count()) === 0) failures.push("sem link do diretório na navegação");
    await remember(page);

    await searchFor(page, "react");
    await remember(page);
    const paulaId = await cardId(page, paula.name);
    const ritaId = await cardId(page, rita.name);
    if (paulaId === null) failures.push("'react' não achou Paula (Público)");
    if (ritaId === null) failures.push("'react' não achou Rita (Recrutadores)");
    if ((await cardId(page, pedro.name)) !== null) failures.push("'react' achou Pedro (Privado)");

    // Remoto: Paula mostra o modelo; Rita guarda remoto sem "mostrar".
    await page.selectOption('[data-testid="directory-work-model"]', "remote");
    await page.locator('[data-testid="directory-submit"]').click();
    await page.waitForURL((url) => url.searchParams.get("workModel") === "remote", { timeout: 15_000 });
    const chip = page.locator('[data-testid="directory-chip-workModel"]');
    await chip.waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await remember(page);
    if (!(await chip.isVisible())) failures.push("o filtro remoto não aparece como chip");
    if ((await cardId(page, paula.name)) === null) failures.push("remoto tirou Paula, que mostra o modelo");
    if ((await cardId(page, rita.name)) !== null) failures.push("remoto achou Rita pelo valor escondido");
    await chip.click();
    await page.waitForURL((url) => !url.searchParams.has("workModel"), { timeout: 15_000 });
    await page.locator('[data-testid="directory-chip-workModel"]').waitFor({ state: "detached", timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    if ((await cardId(page, rita.name)) === null) failures.push("tirar o chip não devolveu Rita");

    // Paula: lista de permissão, CV filtrado e link `/p/`.
    if (paulaId !== null) {
      await page.locator(`[data-testid="directory-open-${paulaId}"]`).click();
      await page.locator('[data-testid="route-recruiter-directory-profile"]').waitFor({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");
      await remember(page);
      const cvText = (await page.locator('[data-testid="public-cv"]').textContent()) ?? "";
      if (!cvText.includes("acessibilidade")) failures.push("o CV consentido de Paula não aparece");
      const publicHref = await page.locator('[data-testid="directory-public-link"]').getAttribute("href");
      if (publicHref !== `/p/${paula.slug}`) failures.push(`link público de Paula: ${publicHref}`);
      if ((await page.locator('main form, main button').count()) !== 0) failures.push("perfil tem controle (formulário ou botão)");
      if ((await page.locator('[data-testid="directory-grant-link"]').count()) !== 0) failures.push("link de concessão sem concessão");
    }

    // Rita: marcação como texto, sem `/p/`.
    if (ritaId !== null) {
      await page.goto(`${BASE}/recruiter/directory/${ritaId}`, { waitUntil: "networkidle" });
      await remember(page);
      const headline = (await page.locator("main [data-user-content]").nth(1).textContent()) ?? "";
      if (!headline.includes("<i>markup</i>")) failures.push(`marcação não saiu como texto: ${headline}`);
      if ((await page.locator("main i").count()) !== 0) failures.push("a marcação virou elemento");
      if ((await page.locator('[data-testid="directory-public-link"]').count()) !== 0) failures.push("Rita (Recrutadores) com link /p/");
      if ((await page.locator('[data-testid="public-cv"]').count()) !== 0) failures.push("CV de Rita sem consentimento");
    }
    ctx.state.directoryIds = { paula: paulaId, rita: ritaId };
    check("E2E-024 recrutador busca, filtra e lê só a lista de permissão", failures.length === 0, failures.join(" | "));
  }

  /* ------- E2E-029 e E2E-025: dicas e visibilidade decidindo a descoberta ------- */
  {
    const failures = [];
    const candidateSide = await signIn(rita.account);
    const own = candidateSide.page;
    await own.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const options = await own.locator('input[name="visibility"]').evaluateAll((inputs) => inputs.map((input) => input.value));
    const hints = {};
    for (const option of ["private", "recruiters", "public"]) {
      hints[option] = ((await own.locator(`[data-testid="visibility-hint-${option}"]`).textContent()) ?? "").trim();
    }
    const consent = (await own.locator('[data-testid="visibility-form"]').innerText()) ?? "";
    check(
      "E2E-029 /candidate oferece as três visibilidades com dica, e Recrutadores nomeia quem se cadastrou sozinho",
      options.join(",") === "private,recruiters,public"
        && Object.values(hints).every((hint) => hint.length > 10)
        && /se cadastrou sozinho como recrutador/.test(hints.recruiters)
        && (await own.locator('[data-testid="visibility-public-cv"]').count()) === 1
        && /Recrutadores e Público/.test(consent),
      JSON.stringify({ options, hints }),
    );

    const setVisibility = async (value) => {
      await own.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
      await own.check(`input[name="visibility"][value="${value}"]`);
      await own.locator('[data-testid="save-visibility"]').click();
      await own.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({ timeout: 15_000 });
      await own.reload({ waitUntil: "networkidle" });
      return own.locator('input[name="visibility"]:checked').getAttribute("value");
    };
    // Sondas de 404 em contexto próprio, fora do coletor de console da suíte.
    const probe = await signIn(DIRECTORY_FIXTURES.recruiter.email, { track: false });

    const ritaId = ctx.state.directoryIds?.rita;
    if ((await setVisibility("private")) !== "private") failures.push("Privado não persistiu");
    await page.goto(`${BASE}/recruiter/directory?q=${encodeURIComponent(rita.name)}`, { waitUntil: "networkidle" });
    if ((await cardId(page, rita.name)) !== null) failures.push("Rita em Privado continua na busca");
    if (ritaId) {
      const status = (await probe.page.goto(`${BASE}/recruiter/directory/${ritaId}`, { waitUntil: "networkidle" }))?.status();
      if (status !== 404) failures.push(`perfil de Rita em Privado respondeu ${status}`);
    }
    if ((await setVisibility("recruiters")) !== "recruiters") failures.push("Recrutadores não persistiu");
    await page.goto(`${BASE}/recruiter/directory?q=${encodeURIComponent(rita.name)}`, { waitUntil: "networkidle" });
    if ((await cardId(page, rita.name)) === null) failures.push("Rita de volta em Recrutadores não aparece");

    for (const q of [pedro.name, "Pedro Privado"]) {
      await page.goto(`${BASE}/recruiter/directory?q=${encodeURIComponent(q)}`, { waitUntil: "networkidle" });
      await remember(page);
      if ((await cardId(page, pedro.name)) !== null) failures.push(`'${q}' achou Pedro`);
      if ((await page.locator('[data-testid="directory-empty"]').count()) !== 1) failures.push(`'${q}' sem o vazio`);
    }
    check("E2E-025 a visibilidade decide a descoberta na requisição seguinte; Privado nunca aparece", failures.length === 0, failures.join(" | "));
    await probe.context.close();
    await candidateSide.context.close();
  }

  /* --------------------- E2E-026: quem não é recrutador --------------------- */
  {
    const failures = [];
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(`${BASE}/recruiter/directory?q=react`, { waitUntil: "networkidle" });
    const landed = new URL(anonymousPage.url());
    if (landed.pathname !== "/login") failures.push(`sem sessão caiu em ${landed.pathname}`);
    if (landed.searchParams.get("next") !== "/recruiter/directory?q=react") failures.push(`next=${landed.searchParams.get("next")}`);
    await anonymous.close();

    for (const email of ["e2e-candidato@local.test", DIRECTORY_FIXTURES.admin.email]) {
      const other = await signIn(email, { track: false });
      for (const path of ["/recruiter/directory", `/recruiter/directory/${ctx.state.directoryIds?.paula ?? 1}`]) {
        const status = (await other.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status();
        const text = (await other.page.locator("body").innerText()) ?? "";
        if (status !== 403) failures.push(`${email} ${path} respondeu ${status}`);
        if (text.includes(paula.name) || text.includes(rita.name)) failures.push(`${email} ${path} mostrou perfil`);
      }
      await other.context.close();
    }
    check("E2E-026 sem sessão vai ao login; candidato e admin recebem a recusa", failures.length === 0, failures.join(" | "));
  }

  /* ----------------- E2E-027: campos privados nunca aparecem ---------------- */
  {
    const leaks = [];
    for (const text of seen) {
      for (const secret of SECRETS) if (text.includes(secret)) leaks.push(`${text.split("\n")[0]}: ${secret}`);
    }
    check(
      "E2E-027 nenhuma tela do diretório mostra piso, nota, e-mail ou telefone das fixtures",
      seen.length >= 6 && leaks.length === 0,
      `${seen.length} telas · ${leaks.join(" | ")}`,
    );
  }
  await recruiter.context.close();

  /* ------------- E2E-028: 375 px, axe e inglês, como recrutador ------------- */
  {
    const failures = [];
    // Fora do coletor de console, como `a11y.mjs`: o axe busca as folhas de
    // estilo de outra origem para medir contraste, e a CSP recusa — o erro é
    // da ferramenta, não da tela. Hidratação e console da tela já são medidos
    // na sessão de E2E-024.
    const narrow = await signIn(DIRECTORY_FIXTURES.recruiter.email, {
      locale: "en",
      viewport: { width: 375, height: 812 },
      track: false,
    });
    const profilePath = `/recruiter/directory/${ctx.state.directoryIds?.paula ?? 0}`;
    for (const path of RECRUITER_SWEEP) {
      for (const target of [path, profilePath]) {
        const response = await narrow.page.goto(`${BASE}${target}`, { waitUntil: "networkidle" });
        if (response?.status() !== 200) {
          failures.push(`${target}: HTTP ${response?.status()}`);
          continue;
        }
        const overflow = await narrow.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 1) failures.push(`${target}: estoura ${overflow}px em 375`);
        const result = await new AxeBuilder({ page: narrow.page }).withTags(AXE_TAGS).analyze();
        for (const violation of result.violations) failures.push(`${target}: axe ${violation.id}`);
      }
      const leaks = await portugueseLeaks([path, profilePath], narrow.page);
      for (const leak of leaks) failures.push(`inglês: ${leak}`);
    }
    check("E2E-028 diretório e perfil cabem em 375 px, sem violação axe nem português", failures.length === 0, failures.join(" | "));
    await narrow.context.close();
  }
}
