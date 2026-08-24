/**
 * Checks that only a real browser can make.
 *
 * Every bug this file exists to catch was invisible to the unit tests, and each
 * one shipped:
 *
 *  - The tooltip rendered its trigger, looked correct in the HTML, and did
 *    nothing on hover, because a Server Component cannot hand pointer handlers
 *    to Base UI.
 *  - The Content-Security-Policy written during the security review blocked
 *    Google Fonts, so the whole design system fell back to the system font
 *    while every stylesheet said otherwise.
 *
 * Both are only observable by loading the page, waiting for fonts, and moving a
 * mouse. Hence Playwright, and hence this being separate from `pnpm check`:
 * it needs the dev server up.
 *
 * `pnpm test:e2e` owns an isolated build, server and database. To target an
 * already-running environment deliberately, set E2E_BASE and
 * TURSO_DATABASE_URL and run `pnpm test:e2e:external`.
 */
import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";
import { TASK04_FIXTURES } from "./task04-fixtures.mjs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";

/**
 * Credenciais da conta dedicada, criada por `tests/e2e/setup.mjs`.
 *
 * Conta separada de propósito: apontar o teste para a conta real faria trocar
 * a própria senha quebrar a suíte, e a credencial de verdade não deve estar
 * escrita em arquivo nenhum do repositório.
 */
const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";
const E2E_RESET_EXPIRED_TOKEN = process.env.E2E_RESET_EXPIRED_TOKEN ?? TASK04_FIXTURES.resetExpiredToken;
const E2E_RESET_CONSUMED_TOKEN = process.env.E2E_RESET_CONSUMED_TOKEN ?? TASK04_FIXTURES.resetConsumedToken;
const E2E_RESET_RACE_TOKEN = process.env.E2E_RESET_RACE_TOKEN ?? TASK04_FIXTURES.resetRaceToken;
const E2E_LOGIN_EXPIRED_TOKEN = process.env.E2E_LOGIN_EXPIRED_TOKEN ?? TASK04_FIXTURES.loginExpiredToken;
const E2E_LOGIN_RACE_TOKEN = process.env.E2E_LOGIN_RACE_TOKEN ?? TASK04_FIXTURES.loginRaceToken;
const E2E_CLOSED_JOB_ID = process.env.E2E_CLOSED_JOB_ID ?? String(TASK04_FIXTURES.closedJobId);
const E2E_DELETED_JOB_ID = process.env.E2E_DELETED_JOB_ID ?? String(TASK04_FIXTURES.deletedJobId);
const PACKAGE_VERSION = JSON.parse(await readFile("package.json", "utf8")).version;
const results = [];
let failed = 0;
let comparisonJobId = null;
const createdJobFixtures = new Map();

function rememberCreatedJob(url, title, companyName) {
  const parsed = new URL(url);
  const pathId = parsed.pathname.match(/^\/jobs\/(\d+)$/)?.[1];
  const id = Number(parsed.searchParams.get("job") ?? pathId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`created job id missing from ${url}`);
  createdJobFixtures.set(id, { title, companyName });
  return id;
}

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
const changelogRoleSnapshots = [];

function trackConsole(targetPage) {
  targetPage.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = message.text().slice(0, 200);
    if (value === "{}" && targetPage.url().includes("/transition-test?error=unparseable-")) return;
    if (EXPECTED_CONSOLE.test(value)) return;
    consoleErrors.push(value);
  });
  targetPage.on("pageerror", (error) =>
    consoleErrors.push("pageerror: " + String(error).slice(0, 200)),
  );
}

async function openChangelog(targetPage) {
  const trigger = targetPage.locator('[data-testid="changelog-open"]');
  await trigger.click();
  const dialog = targetPage.locator('[data-testid="changelog-dialog"]');
  await dialog.waitFor({ state: "visible" });
  return { trigger, dialog };
}

async function readModalSpacing(modal) {
  return modal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const header = element.querySelector("header");
    const headerStyle = header ? getComputedStyle(header) : null;
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      headerPaddingTop: headerStyle?.paddingTop ?? null,
      headerPaddingBottom: headerStyle?.paddingBottom ?? null,
    };
  });
}

async function changelogSnapshot(targetPage) {
  const { dialog } = await openChangelog(targetPage);
  const snapshot = await dialog.evaluate((element) => ({
    releases: [...element.querySelectorAll('[data-testid^="changelog-release-"]')].map(
      (button) => ({
        id: button.getAttribute("data-testid"),
        text: button.textContent?.replace(/\s+/g, " ").trim() ?? "",
        expanded: button.getAttribute("aria-expanded"),
        controls: button.getAttribute("aria-controls"),
        publication: button.querySelector("time")
          ? {
              dateTime: button.querySelector("time")?.getAttribute("datetime"),
              text: button.querySelector("time")?.textContent?.trim() ?? "",
            }
          : null,
      }),
    ),
    panels: [...element.querySelectorAll('[id^="changelog-release-"][id$="-content"]')].map(
      (panel) => ({
        id: panel.id,
        hidden: panel.hasAttribute("hidden"),
        text: panel.textContent?.replace(/\s+/g, " ").trim() ?? "",
      }),
    ),
  }));
  await targetPage.locator('[data-testid="changelog-close"]').click();
  return snapshot;
}

/**
 * Erros que ESTE arquivo provoca de propósito.
 *
 * A verificação de impersonação abre `/admin/users` com sessão emprestada para
 * provar que a política nega — e o 403 que ela espera aparece no console como
 * recurso que falhou. Contá-lo como defeito faria o teste reprovar justamente
 * quando funciona.
 *
 * Estreito de propósito: só 403, e só de rede. Um `pageerror` continua contando,
 * e um 500 também — que é o que apareceu aqui antes de `requirePage` passar a
 * responder 403 em vez de deixar a exceção subir.
 */
const EXPECTED_CONSOLE = /Failed to load resource.*403|TRANSITION_TEST_ROUTE_FAILURE/i;

trackConsole(page);

try {
  // Fixa o idioma para o texto ser previsível. Onde o alvo é um controle e não
  // uma frase, o teste usa `data-testid`: buscar botão por texto num sistema
  // bilíngue é um teste que quebra quando alguém traduz uma palavra.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  /* ------------------------------ Autenticação ----------------------------- */

  // Antes de qualquer coisa: nada deve responder sem sessão.
  const anonymous = await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  check("página protegida redireciona para login", page.url().includes("/login"), page.url());
  void anonymous;

  const exportResponse = await page.request.get(`${BASE}/api/export`, { maxRedirects: 0 });
  // O export carrega o acervo inteiro em CSV; ele vazando é o pior caso.
  check(
    "API de export não responde sem sessão",
    exportResponse.status() >= 300 && exportResponse.status() < 400,
    String(exportResponse.status()),
  );

  await page.context().addCookies([
    { name: "jho_session", value: "cookie-forjado", url: BASE },
  ]);
  const forgedExport = await page.request.get(`${BASE}/api/export`, { maxRedirects: 0 });
  check(
    "API de export rejeita cookie forjado",
    forgedExport.status() >= 300 && forgedExport.status() < 400,
    String(forgedExport.status()),
  );
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', "senha-propositalmente-errada");
  await page.click('[data-testid="login-submit"]');
  await page.waitForTimeout(900);
  check("senha errada não entra", page.url().includes("/login"), page.url());
  check(
    "erro aparece na tela",
    (await page.locator("form").textContent())?.includes("incorretos") ?? false,
  );

  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForTimeout(1400);
  check("senha correta entra", !page.url().includes("/login"), page.url());

  const sessionCookie = (await page.context().cookies()).find((c) => c.name === "jho_session");
  // httpOnly é o que impede um XSS de ler a sessão.
  check("cookie de sessão é httpOnly", sessionCookie?.httpOnly === true);
  check("cookie de sessão é sameSite lax", (sessionCookie?.sameSite ?? "").toLowerCase() === "lax");

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  /* ------------------------------- Tipografia ------------------------------ */

  const typography = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
        size: cs.fontSize,
        weight: cs.fontWeight,
      };
    };
    return {
      body: read("body"),
      h1: read("h1"),
      loaded: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family))],
    };
  });

  // Declarar a fonte não é aplicá-la: a CSP pode bloquear o download e a
  // página cair no fallback sem nenhum sinal no CSS.
  check("fonte do DESIGN.md realmente carregada", typography.loaded.includes("Inter"), typography.loaded.join(", "));
  check("body renderiza na fonte do sistema de design", typography.body?.family === "Inter", typography.body?.family);
  // A escala é Minor Third (1.2×) a partir de 16px, e o PESO vem do tema —
  // HP em 500, Huly em 600, Graphy em 700. Fixar o peso aqui obrigaria a
  // mudar o teste a cada tema novo, que é exatamente o acoplamento que o
  // sistema de temas existe para evitar.
  check(
    "h1 segue a escala tipográfica (display-md, 30px)",
    typography.h1?.size === "30px",
    JSON.stringify(typography.h1),
  );
  check(
    "peso do display vem do tema",
    ["500", "600", "700"].includes(typography.h1?.weight ?? ""),
    typography.h1?.weight,
  );

  const spacingSnapshots = [];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const mainPadding = {};
    for (const path of ["/", "/jobs", "/compare"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      mainPadding[path] = await page.locator("main").evaluate(
        (main) => getComputedStyle(main).paddingTop,
      );
    }
    const expectedMainPadding = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const value =
        Number.parseFloat(style.getPropertyValue("--spacing-xl")) +
        Number.parseFloat(style.getPropertyValue("--spacing-md"));
      return `${value}px`;
    });

    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const { dialog } = await openChangelog(page);
    const changelogSpacing = await readModalSpacing(dialog);
    await page.locator('[data-testid="changelog-close"]').click();
    spacingSnapshots.push({ width, mainPadding, expectedMainPadding, changelogSpacing });
  }
  check(
    "espaçamento principal segue a referência no desktop e no mobile",
    spacingSnapshots.every(
      ({ mainPadding, expectedMainPadding }) =>
        Object.values(mainPadding).every((padding) => padding === expectedMainPadding),
    ),
    JSON.stringify(spacingSnapshots),
  );
  check(
    "modal de novidades respeita topo e padding no desktop e no mobile",
    spacingSnapshots.every(
      ({ changelogSpacing }) =>
        changelogSpacing.top >= 24 &&
        changelogSpacing.bottom <= changelogSpacing.viewportHeight - 24 &&
        changelogSpacing.headerPaddingTop === "24px" &&
        changelogSpacing.headerPaddingBottom === "24px" &&
        changelogSpacing.left >= 0 &&
        changelogSpacing.right <= changelogSpacing.viewportWidth,
    ),
    JSON.stringify(spacingSnapshots),
  );
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--safe-area-top", "47px");
    root.setProperty("--safe-area-right", "20px");
    root.setProperty("--safe-area-bottom", "34px");
    root.setProperty("--safe-area-left", "44px");
  });
  const { dialog: asymmetricDialog } = await openChangelog(page);
  const asymmetricSpacing = await readModalSpacing(asymmetricDialog);
  await page.locator('[data-testid="changelog-close"]').click();
  await page.evaluate(() => {
    const root = document.documentElement.style;
    for (const property of [
      "--safe-area-top",
      "--safe-area-right",
      "--safe-area-bottom",
      "--safe-area-left",
    ]) {
      root.removeProperty(property);
    }
  });
  check(
    "modal respeita safe areas assimétricas de uma PWA móvel",
    asymmetricSpacing.top === 47 &&
      asymmetricSpacing.bottom === 812 - 34 &&
      asymmetricSpacing.left === 44 &&
      asymmetricSpacing.right === 375 - 20,
    JSON.stringify(asymmetricSpacing),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });

  /* -------------------------- Modal de novidades -------------------------- */

  const changelogImageRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/export") {
      changelogImageRequests.push(request.url());
    }
  });
  const changelogUrl = page.url();
  const portugueseResponse = await page.content();
  let opened = await openChangelog(page);
  const focusEntered = await opened.dialog.evaluate((dialog) =>
    dialog.contains(document.activeElement),
  );
  check(
    "E2E-001 abre diálogo nativo com título e versão sem navegar",
    (await opened.dialog.getAttribute("open")) !== null &&
      (await opened.dialog.locator("#changelog-dialog-title").isVisible()) &&
      ((await opened.dialog.textContent()) ?? "").includes(`v${PACKAGE_VERSION}`) &&
      page.url() === changelogUrl && focusEntered,
  );

  await page.locator('[data-testid="changelog-close"]').click();
  check(
    "E2E-002 fechar visível restaura foco ao gatilho",
    !(await opened.dialog.isVisible()) &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ===
        "changelog-open",
  );

  opened = await openChangelog(page);
  await page.keyboard.press("Escape");
  check(
    "E2E-003 Escape fecha e restaura foco",
    !(await opened.dialog.isVisible()) &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ===
        "changelog-open",
  );

  opened = await openChangelog(page);
  await opened.dialog.locator("header").click({ position: { x: 40, y: 40 } });
  const insideKeptOpen = await opened.dialog.isVisible();
  await page.mouse.click(4, 4);
  await opened.dialog.waitFor({ state: "hidden" });
  check("E2E-004 backdrop fecha e clique no painel não", insideKeptOpen);

  opened = await openChangelog(page);
  let releaseButtons = opened.dialog.locator('[data-testid^="changelog-release-"]');
  check(
    "E2E-005 somente a versão mais nova começa expandida",
    (await releaseButtons.count()) === 100 &&
      (await opened.dialog.locator('[data-testid^="changelog-release-"][aria-expanded="true"]').count()) === 1 &&
      (await releaseButtons.first().getAttribute("aria-expanded")) === "true",
  );

  await releaseButtons.nth(1).click();
  await releaseButtons.nth(2).click();
  check(
    "E2E-006 três versões permanecem expandidas",
    (await opened.dialog.locator('[aria-expanded="true"]').count()) === 3,
  );

  await releaseButtons.nth(1).click();
  const statesAfterMiddleCollapse = await Promise.all(
    [0, 1, 2].map((index) => releaseButtons.nth(index).getAttribute("aria-expanded")),
  );
  check(
    "E2E-007 fechar a intermediária preserva as demais sem duplicar",
    statesAfterMiddleCollapse.join(",") === "true,false,true" &&
      (await opened.dialog.locator('[id$="-content"]').count()) === 100,
    statesAfterMiddleCollapse.join(","),
  );

  await page.locator('[data-testid="changelog-close"]').click();
  opened = await openChangelog(page);
  releaseButtons = opened.dialog.locator('[data-testid^="changelog-release-"]');
  check(
    "E2E-008 reabrir restaura newest-only",
    (await opened.dialog.locator('[aria-expanded="true"]').count()) === 1 &&
      (await releaseButtons.first().getAttribute("aria-expanded")) === "true",
  );

  const keyboardHeader = releaseButtons.nth(1);
  const keyboardChevron = keyboardHeader.locator("svg");
  await keyboardHeader.focus();
  await page.keyboard.press("Enter");
  const controls = await keyboardHeader.getAttribute("aria-controls");
  const enterState =
    (await keyboardHeader.getAttribute("aria-expanded")) === "true" &&
    Boolean(controls) &&
    (await opened.dialog.locator(`#${controls}`).isVisible()) &&
    (await keyboardHeader.getAttribute("data-state")) === "open" &&
    ((await keyboardChevron.getAttribute("class")) ?? "").includes("rotate-180");
  await page.keyboard.press("Space");
  const spaceState =
    (await keyboardHeader.getAttribute("aria-expanded")) === "false" &&
    !(await opened.dialog.locator(`#${controls}`).isVisible()) &&
    (await keyboardHeader.getAttribute("data-state")) === "closed" &&
    !((await keyboardChevron.getAttribute("class")) ?? "").includes("rotate-180");
  check("E2E-009 teclado sincroniza ARIA, região e chevron", enterState && spaceState);

  const newestContent = opened.dialog.locator('[id="changelog-release-1-1-0-content"]');
  const semantics = await newestContent.evaluate((element) => ({
    tags: ["p", "h3", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "hr", "a"]
      .filter((tag) => element.querySelector(tag)),
    text: element.textContent ?? "",
  }));
  check(
    "E2E-010 Markdown completo renderiza semântica e linhas envolvidas",
    semantics.tags.length === 12 &&
      !semantics.text.includes("**forte**") &&
      semantics.text.includes("continua na linha seguinte"),
    `${semantics.tags.length}/12 tags`,
  );
  const hostile = await newestContent.evaluate((element) => ({
    script: Boolean(element.querySelector("script")),
    raw: Boolean(element.querySelector("#changelog-raw-html")),
    unsafe: [...element.querySelectorAll("a")].some((anchor) =>
      /^(javascript|data):/i.test(anchor.getAttribute("href") ?? ""),
    ),
    image: Boolean(element.querySelector("img")),
    executed: globalThis.__changelogScriptRan === true,
  }));
  check(
    "E2E-011 HTML e destinos hostis permanecem inertes",
    !hostile.script && !hostile.raw && !hostile.unsafe && !hostile.image &&
      !hostile.executed && changelogImageRequests.length === 0,
    JSON.stringify({ ...hostile, imageRequests: changelogImageRequests }),
  );

  check(
    "E2E-012 edição portuguesa não mistura prose inglesa",
    semantics.text.includes("CONTEUDO_PT_EXCLUSIVO") &&
      !semantics.text.includes("ENGLISH_RELEASE_ONLY") &&
      portugueseResponse.includes("CONTEUDO_PT_EXCLUSIVO") &&
      !portugueseResponse.includes("ENGLISH_RELEASE_ONLY") &&
      ((await opened.dialog.textContent()) ?? "").includes("Novidades"),
  );
  await page.locator('[data-testid="changelog-close"]').click();

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  await page.reload({ waitUntil: "networkidle" });
  const englishResponse = await page.content();
  opened = await openChangelog(page);
  const englishText = (await opened.dialog.textContent()) ?? "";
  check(
    "E2E-013 edição inglesa não mistura prose portuguesa",
    englishText.includes("ENGLISH_RELEASE_ONLY") &&
      !englishText.includes("CONTEUDO_PT_EXCLUSIVO") &&
      englishResponse.includes("ENGLISH_RELEASE_ONLY") &&
      !englishResponse.includes("CONTEUDO_PT_EXCLUSIVO") &&
      englishText.includes("What's new"),
  );
  await page.locator('[data-testid="changelog-close"]').click();

  async function timezoneView(timezoneId, locale) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1280, height: 900 } });
    const target = await context.newPage();
    trackConsole(target);
    await context.addCookies([
      sessionCookie,
      { name: "jho_locale", value: locale, url: BASE },
    ]);
    await target.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const { dialog } = await openChangelog(target);
    const newest = dialog.locator('[data-testid="changelog-release-1.1.0"] time');
    await newest.waitFor();
    await target.waitForFunction(
      () => document.querySelector('[data-testid="changelog-release-1.1.0"] time')?.textContent?.trim(),
    );
    const boundaryTime = dialog.locator('time[datetime="2027-01-01T01:30:00.000Z"]');
    await boundaryTime.waitFor();
    const result = {
      newest: (await newest.textContent())?.trim() ?? "",
      newestDateTime: await newest.getAttribute("datetime"),
      boundary: (await boundaryTime.textContent())?.trim() ?? "",
      boundaryDateTime: await boundaryTime.getAttribute("datetime"),
      dateOnly: (await dialog.locator('[data-testid="changelog-release-1.0.0"] time').textContent())?.trim() ?? "",
    };
    await context.close();
    return result;
  }

  const saoPauloPt = await timezoneView("America/Sao_Paulo", "pt-BR");
  const saoPauloEn = await timezoneView("America/Sao_Paulo", "en");
  check("E2E-014 instante pt-BR usa hora local exata", saoPauloPt.newest === "22/08/2026 08:46", saoPauloPt.newest);
  check("E2E-015 instante en usa hora local exata", saoPauloEn.newest === "08/22/2026 08:46", saoPauloEn.newest);

  const tokyoEn = await timezoneView("Asia/Tokyo", "en");
  check(
    "E2E-016 timezones cruzam o dia preservando um ISO",
    saoPauloEn.boundary === "12/31/2026 22:30" &&
      tokyoEn.boundary === "01/01/2027 10:30" &&
      saoPauloEn.boundaryDateTime === "2027-01-01T01:30:00.000Z" &&
      tokyoEn.boundaryDateTime === saoPauloEn.boundaryDateTime,
    `${saoPauloEn.boundary} | ${tokyoEn.boundary}`,
  );
  check(
    "E2E-017 data histórica permanece sem hora nem drift",
    saoPauloPt.dateOnly === "21/08/2026" && saoPauloEn.dateOnly === "08/21/2026",
    `${saoPauloPt.dateOnly} | ${saoPauloEn.dateOnly}`,
  );

  await page.locator("#locale-popover-trigger").click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.locator('#locale-popover [lang="pt-BR"]').click(),
  ]);
  opened = await openChangelog(page);
  check(
    "E2E-018 troca de locale reabre edição coerente em newest-only",
    ((await opened.dialog.textContent()) ?? "").includes("CONTEUDO_PT_EXCLUSIVO") &&
      (await opened.dialog.locator('[aria-expanded="true"]').count()) === 1,
  );
  await page.locator('[data-testid="changelog-close"]').click();

  await page.setViewportSize({ width: 375, height: 812 });
  opened = await openChangelog(page);
  const narrow = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="changelog-dialog"]');
    const scrollArea = dialog?.querySelector("div.min-h-0.flex-1");
    const header = document.querySelector('[data-testid="changelog-release-1.1.0"]');
    const longHeader = document
      .querySelector('time[datetime="2027-01-01T01:30:00.000Z"]')
      ?.closest("button");
    const code = dialog?.querySelector("pre");
    const dialogRect = dialog?.getBoundingClientRect();
    const scrollRect = scrollArea?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const visibleHeaderHeight = scrollRect && headerRect
      ? Math.max(
          0,
          Math.min(scrollRect.bottom, headerRect.bottom) -
            Math.max(scrollRect.top, headerRect.top),
        )
      : 0;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 999,
      headerWidth: header?.getBoundingClientRect().width ?? 0,
      longHeaderOverflow: longHeader ? longHeader.scrollWidth - longHeader.clientWidth : 999,
      codeContained:
        code && dialog
          ? code.getBoundingClientRect().right <= dialog.getBoundingClientRect().right
          : false,
      codeScrolls: code ? code.scrollWidth > code.clientWidth : false,
      viewport: document.documentElement.clientWidth,
      viewportHeight: globalThis.visualViewport?.height ?? globalThis.innerHeight,
      dialogHeight: dialogRect?.height ?? 0,
      scrollAreaHeight: scrollRect?.height ?? 0,
      firstHeaderHeight: headerRect?.height ?? 0,
      visibleHeaderHeight,
    };
  });
  check(
    "E2E-019 375px contém strings longas e mantém controles alcançáveis",
    narrow.overflow <= 1 && narrow.dialogOverflow <= 1 &&
      narrow.headerWidth > 0 && narrow.headerWidth <= narrow.viewport &&
      narrow.longHeaderOverflow <= 1 && narrow.codeContained && narrow.codeScrolls,
    JSON.stringify(narrow),
  );
  check(
    "E2E-019b 375px reserva área vertical útil e mostra o primeiro card inteiro",
    narrow.dialogHeight >= narrow.viewportHeight * 0.7 &&
      narrow.scrollAreaHeight >= narrow.viewportHeight * 0.45 &&
      narrow.firstHeaderHeight >= 44 &&
      narrow.visibleHeaderHeight >= narrow.firstHeaderHeight - 1,
    JSON.stringify(narrow),
  );

  const webkitBrowser = await webkit.launch();
  try {
    const webkitContext = await webkitBrowser.newContext({ viewport: { width: 375, height: 812 } });
    const webkitPage = await webkitContext.newPage();
    trackConsole(webkitPage);
    if (sessionCookie) await webkitContext.addCookies([sessionCookie]);
    await webkitContext.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await webkitPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const { dialog: webkitDialog } = await openChangelog(webkitPage);
    const webkitVertical = await webkitDialog.evaluate((dialog) => {
      const scrollArea = dialog.querySelector("div.min-h-0.flex-1");
      const firstHeader = dialog.querySelector('[data-testid^="changelog-release-"]');
      const dialogRect = dialog.getBoundingClientRect();
      const scrollRect = scrollArea?.getBoundingClientRect();
      const headerRect = firstHeader?.getBoundingClientRect();
      return {
        viewportHeight: globalThis.visualViewport?.height ?? globalThis.innerHeight,
        dialogHeight: dialogRect.height,
        scrollAreaHeight: scrollRect?.height ?? 0,
        firstHeaderHeight: headerRect?.height ?? 0,
        visibleHeaderHeight: scrollRect && headerRect
          ? Math.max(
              0,
              Math.min(scrollRect.bottom, headerRect.bottom) -
                Math.max(scrollRect.top, headerRect.top),
            )
          : 0,
      };
    });
    check(
      "E2E-019c WebKit móvel reserva área vertical útil e mostra o primeiro card inteiro",
      webkitVertical.dialogHeight >= webkitVertical.viewportHeight * 0.7 &&
        webkitVertical.scrollAreaHeight >= webkitVertical.viewportHeight * 0.45 &&
        webkitVertical.firstHeaderHeight >= 44 &&
        webkitVertical.visibleHeaderHeight >= webkitVertical.firstHeaderHeight - 1,
      JSON.stringify(webkitVertical),
    );
  } finally {
    await webkitBrowser.close();
  }

  const scrollArea = opened.dialog.locator("div.min-h-0.flex-1");
  const headerTop = (await opened.dialog.locator("header").boundingBox())?.y;
  await opened.dialog.locator('[data-testid^="changelog-release-"]').evaluateAll((buttons) => {
    for (const button of buttons) {
      if (button.getAttribute("aria-expanded") === "false") button.click();
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="changelog-dialog"] [aria-expanded="true"]').length === 100,
  );
  await scrollArea.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const largeHistory = {
    expanded: await opened.dialog.locator('[aria-expanded="true"]').count(),
    scrolls: await scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight),
    closeVisible: await page.locator('[data-testid="changelog-close"]').isVisible(),
    headerTopAfter: (await opened.dialog.locator("header").boundingBox())?.y,
  };
  check(
    "E2E-020 100 releases mantêm header, close e scroll interno",
    largeHistory.expanded === 100 && largeHistory.scrolls && largeHistory.closeVisible &&
      Math.abs((largeHistory.headerTopAfter ?? 0) - (headerTop ?? 0)) <= 1,
    JSON.stringify(largeHistory),
  );

  // 200% browser zoom halves the CSS viewport while preserving the physical
  // window. Playwright exposes the resulting CSS viewport, which is the part
  // layout and reachability respond to.
  await page.setViewportSize({ width: 640, height: 450 });
  await page.locator('[data-testid="changelog-close"]').focus();
  let focusEscaped = false;
  const expectedReleaseControls = await releaseButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-testid")),
  );
  const reachedReleaseControls = new Set();
  for (let index = 0; index < expectedReleaseControls.length + 2; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await opened.dialog.evaluate((element) => ({
      inside: element.contains(document.activeElement),
      testId: document.activeElement?.getAttribute("data-testid") ?? null,
    }));
    if (!focus.inside) {
      focusEscaped = true;
      break;
    }
    if (focus.testId?.startsWith("changelog-release-")) {
      reachedReleaseControls.add(focus.testId);
    }
  }
  const closeAtZoom = await page.locator('[data-testid="changelog-close"]').boundingBox();
  check(
    "E2E-022 teclado e zoom mantêm foco e close alcançável",
    !focusEscaped && reachedReleaseControls.size === expectedReleaseControls.length &&
      Boolean(closeAtZoom) && closeAtZoom.y >= 0 && closeAtZoom.x >= 0,
    JSON.stringify({ closeAtZoom, reached: reachedReleaseControls.size }),
  );
  await page.locator('[data-testid="changelog-close"]').click();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.context().setOffline(true);
  await page.locator('[data-testid="changelog-open"]').evaluate((button) => {
    button.click();
    button.click();
  });
  await page.locator('[data-testid="changelog-release-1.0.0"]').click();
  await page.locator('[data-testid="changelog-release-1.0.0"]').click();
  const offlineState = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[data-testid="changelog-dialog"]').length,
    openDialogs: document.querySelectorAll('[data-testid="changelog-dialog"][open]').length,
    drift: [...document.querySelectorAll('[data-testid^="changelog-release-"]')].some((button) => {
      const controls = button.getAttribute("aria-controls");
      const region = controls ? document.getElementById(controls) : null;
      return !region || (button.getAttribute("aria-expanded") === "true") === region.hidden;
    }),
  }));
  check(
    "E2E-024 offline e interação rápida mantêm um diálogo e estado coerente",
    offlineState.dialogs === 1 && offlineState.openDialogs === 1 && !offlineState.drift,
    JSON.stringify(offlineState),
  );
  await page.locator('[data-testid="changelog-close"]').click();
  await page.context().setOffline(false);
  changelogRoleSnapshots.push({ role: "admin", snapshot: await changelogSnapshot(page) });

  /* -------------------------------- Tooltips ------------------------------- */

  const triggers = page.locator('[data-slot="tooltip-trigger"]');
  const total = await triggers.count();
  check("chips de filtro presentes", total > 0, `${total}`);

  let tooltipOpened = 0;
  let wellShaped = 0;
  const shapes = [];
  for (let i = 0; i < total; i++) {
    await triggers.nth(i).hover();
    await page.waitForTimeout(350);
    const popup = page.locator('[data-slot="tooltip-content"]').first();
    const visible = await popup.isVisible().catch(() => false);
    if (visible) {
      tooltipOpened++;
      const box = await popup.boundingBox();
      // Visível não basta. Uma versão anterior abria com 24px de largura e
      // 140px de altura, quebrando o texto letra por letra — passou por um
      // teste que só perguntava "está visível?". A forma é o que prova que
      // está legível.
      if (box && box.width >= 120 && box.height <= 200) wellShaped++;
      else shapes.push(`${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
  }
  check("todo chip abre seu tooltip no hover", tooltipOpened === total && total > 0, `${tooltipOpened}/${total}`);
  check("tooltip abre legível, não colapsado", wellShaped === total && total > 0, shapes.join(", "));

  /* ------------------------------ Outras telas ----------------------------- */

  for (const path of ["/", "/compare", "/candidate", "/pipeline", "/referrals", "/login"]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${path} responde`, response?.status() === 200, String(response?.status()));
  }

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  check("comparar vaga oferece descrição", (await page.locator('textarea[name="description"]').count()) === 1);
  check("comparar vaga oferece upload", (await page.locator('input[name="file"][type="file"]').count()) === 1);
  check("comparar vaga envia pela ação", (await page.locator('[data-testid="compare-submit"]').count()) === 1);

  const comparisonText =
    "Senior AI Software Architect responsible for TypeScript and Python services, distributed systems, LLM products, cloud architecture, observability, technical leadership, and remote delivery for teams in Brazil and LATAM.";
  const fillComparisonIdentity = async () => {
    await page.fill('input[name="title"]', "Senior AI Software Architect E2E");
    await page.fill('input[name="companyName"]', "E2E Comparison Lab");
    await page.fill('input[name="location"]', "Remote · Brazil");
    await page.fill('input[name="url"]', "https://e2e.invalid/comparison");
  };

  await fillComparisonIdentity();
  await page.fill('textarea[name="description"]', comparisonText);
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  comparisonJobId = rememberCreatedJob(
    page.url(),
    "Senior AI Software Architect E2E",
    "E2E Comparison Lab",
  );
  check("comparação colada persiste e redireciona", /[?&]job=\d+/.test(page.url()), page.url());
  check("comparação exibe score canônico", (await page.locator('[data-testid="comparison-score"]').count()) === 1);
  check("comparação exibe cobertura do currículo", (await page.locator('[data-testid="comparison-cv-coverage"]').count()) === 1);

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await fillComparisonIdentity();
  await page.locator('input[name="file"]').setInputFiles({
    name: "e2e-job.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`${comparisonText}\nUploaded through the real multipart form.`),
  });
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  rememberCreatedJob(page.url(), "Senior AI Software Architect E2E", "E2E Comparison Lab");
  check(
    "upload percorre extração, persistência e score",
    (await page.locator('[data-testid="comparison-result"]').textContent())?.includes("e2e-job.txt") ?? false,
  );

  await page.setViewportSize({ width: 375, height: 812 });
  const resultOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("resultado da comparação cabe no celular", resultOverflow <= 1, `${resultOverflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* --------------------------------- Mobile -------------------------------- */

  // Rolagem horizontal é a falha que passa despercebida no desktop, porque só
  // aparece quando a janela é estreita o bastante para o conteúdo não caber.
  const widths = [375, 390, 412, 768];
  const overflows = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of ["/", "/jobs", "/compare", "/candidate", "/candidate/skills", "/pipeline"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) overflows.push(`${width}px ${path}: ${overflow}px`);
    }
  }
  check("sem rolagem horizontal em nenhuma largura", overflows.length === 0, overflows.slice(0, 3).join(" · "));

  await page.setViewportSize({ width: 1280, height: 900 });

  /* ------------------------- Menu mobile fecha ao navegar ------------------------ */

  await page.setViewportSize({ width: 375, height: 812 });

  // Abre pelo botão do hambúrguer. O popover nativo é `#menu-mobile`.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile abre ao tocar no botão", await page.locator("#menu-mobile").isVisible());

  // Fecha com Escape — o light dismiss nativo não pode ter regredido.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("menu mobile fecha com Escape", !(await page.locator("#menu-mobile").isVisible()));

  // Fecha ao clicar fora — idem.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(200, 700);
  await page.waitForTimeout(250);
  check("menu mobile fecha ao tocar fora", !(await page.locator("#menu-mobile").isVisible()));

  // O defeito em si: clicar num item navega e o menu precisa fechar.
  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  await page.locator('#menu-mobile a[href="/jobs"]').click();
  await page.waitForURL("**/jobs", { timeout: 10000 });
  await page.waitForTimeout(250);
  check("menu mobile fecha ao navegar por um item", !(await page.locator("#menu-mobile").isVisible()));

  // Reabertura imediata: sem estado residual do fechamento por navegação.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile reabre sem estado residual", await page.locator("#menu-mobile").isVisible());
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 900 });

  /* ------------------------------- Aparência ------------------------------- */

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/referrals`, { waitUntil: "networkidle" });

  const triggerBox = await page.locator('[data-testid="appearance"]').boundingBox();
  await page.locator('[data-testid="appearance"]').click();
  await page.waitForTimeout(300);
  const panel = await page.locator("#appearance-popover").boundingBox();

  // Duas tentativas anteriores erraram aqui: com CSS Anchor Positioning o
  // painel caiu no centro da tela, e com canto fixo ele abriu longe do botão.
  // O certo é sob o botão, alinhado pela direita dele.
  const alignedToTrigger =
    Boolean(panel) &&
    Math.abs(panel.x + panel.width - (triggerBox.x + triggerBox.width)) < 6;
  const below = Boolean(panel) && panel.y >= triggerBox.y + triggerBox.height - 2;
  check(
    "painel de aparência abre sob o botão",
    alignedToTrigger && below,
    panel ? `painel@${Math.round(panel.x)} botão@${Math.round(triggerBox.x)}` : "não abriu",
  );

  await page.mouse.click(400, 600);
  await page.waitForTimeout(250);
  // `<details>` não fazia isto: ele só fecha pelo próprio summary.
  check("fecha ao clicar fora", !(await page.locator("#appearance-popover").isVisible()));

  await page.locator('[data-testid="appearance"]').click();
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("fecha com Escape", !(await page.locator("#appearance-popover").isVisible()));

  /* ------------------------ Temas, ambientes, contraste --------------------- */

  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const toRgb = (value) => (value.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map(Number);

  const backgrounds = new Set();
  let lowContrast = [];
  const changelogLowContrast = [];

  for (const theme of ["hp", "huly", "graphy"]) {
    for (const mode of ["light", "dark"]) {
      await page.context().addCookies([
        { name: "jho_theme", value: theme, url: BASE },
        { name: "jho_mode", value: mode, url: BASE },
      ]);
      await page.goto(`${BASE}/candidate/skills`, { waitUntil: "networkidle" });
      backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

      const samples = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll("button, a, h1, h2, p, .type-micro")) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          const label = (el.textContent ?? "").trim().slice(0, 24);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          let node = el;
          let bg = getComputedStyle(el).backgroundColor;
          while (node && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
            node = node.parentElement;
            if (!node) break;
            bg = getComputedStyle(node).backgroundColor;
          }
          out.push({ label, fg: getComputedStyle(el).color, bg: bg || "rgb(255,255,255)" });
        }
        return out.slice(0, 50);
      });

      for (const sample of samples) {
        const ratio = contrast(toRgb(sample.fg), toRgb(sample.bg));
        // 4.5:1 é o mínimo do WCAG AA para texto normal.
        if (ratio < 4.5) lowContrast.push(`${theme}/${mode} "${sample.label}" ${ratio.toFixed(2)}:1`);
      }

      await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
      const { dialog: themedDialog } = await openChangelog(page);
      const changelogSamples = await themedDialog.evaluate((dialog) => {
        const out = [];
        for (const element of dialog.querySelectorAll("h2, button, p, a, time, strong, code")) {
          const rect = element.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          let backgroundNode = element;
          let background = getComputedStyle(element).backgroundColor;
          while (backgroundNode && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
            backgroundNode = backgroundNode.parentElement;
            if (!backgroundNode) break;
            background = getComputedStyle(backgroundNode).backgroundColor;
          }
          out.push({
            label: (element.textContent ?? "").trim().slice(0, 24),
            fg: getComputedStyle(element).color,
            bg: background || getComputedStyle(dialog).backgroundColor,
          });
        }
        return out.slice(0, 60);
      });
      for (const sample of changelogSamples) {
        const ratio = contrast(toRgb(sample.fg), toRgb(sample.bg));
        if (ratio < 4.5) {
          changelogLowContrast.push(`${theme}/${mode} "${sample.label}" ${ratio.toFixed(2)}:1`);
        }
      }
      await page.locator('[data-testid="changelog-close"]').click();
    }
  }

  // Seis combinações têm de produzir seis fundos distintos; iguais significaria
  // um tema que não chegou a ser aplicado.
  check("cada tema e ambiente tem fundo próprio", backgrounds.size === 6, `${backgrounds.size}/6`);
  check(
    "todo texto passa em 4.5:1 nos seis ambientes",
    lowContrast.length === 0,
    lowContrast.slice(0, 3).join(" · "),
  );
  check(
    "E2E-021 modal passa contraste nos seis tema/modo",
    changelogLowContrast.length === 0,
    changelogLowContrast.slice(0, 4).join(" · "),
  );

  /* --------------------- Sintaxe do editor de markdown --------------------- */

  // O editor usava `defaultHighlightStyle` do CodeMirror: paleta de hex fixo
  // feita para fundo branco, aplicada também nos três temas escuros. Link dava
  // 1.44:1 e marcador 1.96:1 — não era "pouco contraste", era texto invisível,
  // e a suíte inteira passava porque nenhum teste olhava dentro do editor.
  //
  // A verificação lê o estilo COMPUTADO dos spans que o CodeMirror pintou, e
  // não os tokens do CSS. Um token correto com uma regra que não alcança o span
  // dá o mesmo resultado na tela: ilegível.
  const cmLow = [];
  const cmColours = new Set();
  const SAMPLE =
    "# Título\n**forte** *ênfase* `código` [rótulo](https://exemplo.com)\n> citação\n- item\n";

  for (const theme of ["hp", "huly", "graphy"]) {
    for (const mode of ["light", "dark"]) {
      await page.context().addCookies([
        { name: "jho_theme", value: theme, url: BASE },
        { name: "jho_mode", value: mode, url: BASE },
      ]);
      await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cm-content");
      // Digita em vez de confiar no currículo guardado: o teste precisa das
      // mesmas construções em toda execução. Nada é salvo — o formulário só
      // envia no clique em salvar.
      await page.click(".cm-content");
      await page.keyboard.type(SAMPLE, { delay: 0 });

      const painted = await page.evaluate(() => {
        const surface = getComputedStyle(document.querySelector(".cm-editor")).backgroundColor;
        const out = [];
        const seen = new Set();
        for (const span of document.querySelectorAll(".cm-line span")) {
          const text = (span.textContent ?? "").trim();
          if (!text) continue;
          const fg = getComputedStyle(span).color;
          const key = `${fg}|${text.slice(0, 12)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ text: text.slice(0, 18), fg, bg: surface });
        }
        return out;
      });

      for (const span of painted) {
        cmColours.add(`${theme}/${mode}:${span.fg}`);
        const ratio = contrast(toRgb(span.fg), toRgb(span.bg));
        if (ratio < 4.5) cmLow.push(`${theme}/${mode} "${span.text}" ${ratio.toFixed(2)}:1`);
      }
    }
  }

  check(
    "sintaxe do editor passa em 4.5:1 nos seis ambientes",
    cmLow.length === 0,
    cmLow.slice(0, 4).join(" | "),
  );
  // Um tom só em toda a amostra significaria realce desligado — legível, mas
  // sem a estrutura que faz o editor valer a pena.
  check(
    "editor realça a estrutura do markdown",
    cmColours.size >= 12,
    `${cmColours.size} tons distintos`,
  );


  /* -------------------- Reconferência: botão e enfileiramento -------------- */

  // Vaga não é permanente, e a sincronização não descobre isso sozinha: várias
  // fontes seguem listando anúncio morto. Medido ao ligar esta fila: 16% dos
  // links do Lever entre os melhores ranqueados devolviam 404.
  //
  // O que só o browser responde é se o clique enfileira de verdade e se o botão
  // passa a dizer isso. As regras de classificação (só 404/410 fecham) estão em
  // `tests/verify-queue.test.ts`, onde não precisam de rede.
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const recheckModalId = await page.evaluate(() => {
    for (const trigger of document.querySelectorAll("button[popovertarget^='job-modal']")) {
      const id = trigger.getAttribute("popovertarget");
      if (id && document.getElementById(id)?.querySelector('[data-testid="recheck-job"]')) {
        return id;
      }
    }
    return null;
  });
  if (recheckModalId) {
    await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
  }
  await page.waitForTimeout(300);

  const recheckBefore = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  check("botão de reconferir presente no detalhe", recheckBefore.label !== null, `${recheckBefore.label}`);

  if (recheckBefore.label && !recheckBefore.disabled) {
    await page.locator('[id^="job-modal"]:popover-open [data-testid="recheck-job"]').click();
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    if (recheckModalId) {
      await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
    }
    await page.waitForTimeout(300);
  }

  const recheckAfter = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  // Enfileirado, o botão desabilita: clicar de novo só duplicaria trabalho
  // contra site de terceiro, que é como se toma bloqueio.
  check(
    "reconferir enfileira e desabilita o botão",
    recheckAfter.disabled === true,
    `${recheckAfter.label}`,
  );


  /* ------------------- Visibilidade do perfil do candidato ----------------- */

  // A escolha que decide se um currículo é legível pela internet inteira. O
  // teste vai e volta para não deixar o perfil exposto se falhar no meio.
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const visibility = await page.evaluate(() => ({
    options: [...document.querySelectorAll('input[name="visibility"]')].map((i) => i.value),
    checked: document.querySelector('input[name="visibility"]:checked')?.value ?? null,
    warned: /legível por qualquer um/.test(document.body.textContent ?? ""),
  }));
  check(
    "candidato escolhe quem vê o perfil",
    visibility.options.join(",") === "private,recruiters,public",
    visibility.options.join(","),
  );
  // "Público" soa inofensivo; o que ele significa não. O aviso fica sempre
  // visível, inclusive para quem JÁ está público — que é quem mais precisa lê-lo.
  check("o que 'público' significa está escrito na tela", visibility.warned);

  const original = visibility.checked ?? "private";
  await page.check('input[name="visibility"][value="recruiters"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const saved = await page.evaluate(
    () => document.querySelector('input[name="visibility"]:checked')?.value ?? null,
  );
  check("a escolha persiste", saved === "recruiters", `${saved}`);

  // Devolve ao estado anterior: um teste que deixa o perfil mais exposto do que
  // encontrou é pior que teste nenhum.
  await page.check(`input[name="visibility"][value="${original}"]`);
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);


  /* ------------------- Cenários por papel, ponta a ponta (E-06) ------------ */

  // A matriz de PERMISSÃO já está coberta em teste puro — `auth-policy` afirma
  // papel × ação × posse × visibilidade sem banco nem browser, e reproduzir isso
  // aqui seria testar a mesma função através de seis camadas de framework.
  //
  // O que só o browser responde é a COMPOSIÇÃO: o que cada papel alcança depois
  // de entrar de verdade. E foi aqui que apareceu o defeito — um recrutador
  // entrava com a senha certa e recebia 403 em toda tela, porque
  // `passwordLoginAction` mandava todo mundo para `/` e `/` exige escopo de
  // candidato. Cada metade estava correta sozinha.
  const ROLE_SCENARIOS = [
    {
      role: "recrutador",
      email: "e2e-recrutador@local.test",
      lands: "/jobs",
      allowed: ["/jobs", "/jobs/new"],
      // Sem escopo de candidato: currículo, funil e cockpit são de outra pessoa.
      denied: ["/candidate", "/pipeline", "/admin/users"],
    },
    {
      role: "candidato",
      email: "e2e-candidato@local.test",
      lands: "/",
      allowed: ["/", "/jobs", "/candidate", "/pipeline", "/jobs/new"],
      // Candidato puro não administra contas.
      denied: ["/admin/users"],
    },
  ];

  for (const scenario of ROLE_SCENARIOS) {
    const roleCtx = await browser.newContext();
    const rolePage = await roleCtx.newPage();
    trackConsole(rolePage);
    await roleCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

    await rolePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await rolePage.fill('input[name="email"]', scenario.email);
    await rolePage.fill('input[name="password"]', E2E_PASSWORD);
    await rolePage.locator('[data-testid="login-submit"]').click();
    await rolePage.waitForTimeout(2000);

    const landed = rolePage.url().replace(BASE, "") || "/";
    check(
      `${scenario.role} entra e cai numa tela que é dele`,
      landed === scenario.lands,
      `caiu em ${landed}, esperado ${scenario.lands}`,
    );

    // `start_url` do manifest é "/" e não pode variar por papel. Instalada, a
    // PWA abre ali — então `/` precisa LEVAR cada papel a uma tela dele, e não
    // negar. É o defeito da E-06 tentando voltar pela porta do manifest.
    const fromStartUrl = await rolePage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check(
      `${scenario.role}: abrir pelo start_url da PWA leva a uma tela dele`,
      fromStartUrl?.status() === 200,
      `${fromStartUrl?.status()} em ${rolePage.url().replace(BASE, "")}`,
    );

    const wrong = [];
    for (const path of scenario.allowed) {
      const status = (await rolePage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status();
      if (status !== 200) wrong.push(`${path}=${status} (deveria abrir)`);
    }
    for (const path of scenario.denied) {
      const status = (await rolePage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status();
      // 403 ou 404; o que não pode é 200. Um 500 aqui também reprova: negação
      // que parece crash não distingue "não pode" de "quebrou".
      if (status === 200 || (status ?? 500) >= 500) wrong.push(`${path}=${status} (deveria negar)`);
    }
    check(`${scenario.role} alcança o que é dele e só isso`, wrong.length === 0, wrong.join(" | "));

    await rolePage.goto(`${BASE}${scenario.allowed[0]}`, { waitUntil: "networkidle" });
    changelogRoleSnapshots.push({
      role: scenario.role,
      snapshot: await changelogSnapshot(rolePage),
    });

    await roleCtx.close();
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


  /* --------------------- Recuperação de senha (F-05) ----------------------- */

  // Percorrido de um contexto ANÔNIMO: quem esqueceu a senha não tem sessão, e
  // testar isto logado provaria outra coisa.
  const lost = await browser.newContext();
  const lostPage = await lost.newPage();
  await lost.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await lostPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check(
    "a tela de login oferece recuperar a senha",
    (await lostPage.locator('[data-testid="forgot-password"]').count()) === 1,
  );

  // Endereço que NÃO existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', "nao-existe-de-jeito-nenhum@local.test");
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const unknown = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // Endereço que existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', E2E_EMAIL);
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const known = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // O invariante inteiro da tela: um formulário que responde "não encontramos
  // esta conta" é um oráculo de enumeração aberto ao mundo — dá para descobrir
  // quem está cadastrado sem nunca entrar.
  check(
    "conta existente e inexistente recebem a MESMA resposta",
    unknown.url === known.url && unknown.text === known.text,
    `${unknown.url} vs ${known.url}`,
  );
  check(
    "a confirmação é redigida sem afirmar que a conta existe",
    /se existir uma conta/i.test(known.text),
    known.text.slice(0, 60),
  );

  // Link morto não vira 500 nem tela em branco.
  await lostPage.goto(`${BASE}/login/reset?token=nunca-existiu`, { waitUntil: "networkidle" });
  const dead = ((await lostPage.locator("main").textContent()) ?? "").trim();
  check("link de recuperação inválido explica o que fazer", /não vale mais/i.test(dead),
    dead.slice(0, 60));
  // E não oferece o formulário: um campo de senha sob um token morto convida a
  // digitar uma senha que não vai a lugar nenhum.
  check(
    "link morto não mostra o formulário de senha",
    (await lostPage.locator('input[name="password"]').count()) === 0,
  );

  await lost.close();



  /* ------------------ Cadastro de vaga com rótulo de origem ---------------- */

  // O acervo é global e `job:write` é dos três papéis; o que distingue esta
  // vaga não é quem a criou, é a fonte que ela cria — `recruiter:<host>`, de
  // onde o rótulo deriva na leitura.
  const newJob = await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle" });
  check("formulário de cadastro responde", newJob?.status() === 200, `${newJob?.status()}`);

  const marker = `Recrutador E2E ${Date.now()}`;
  const privateMarkers = [
    E2E_EMAIL,
    E2E_PASSWORD,
    E2E_RESET_EXPIRED_TOKEN,
    E2E_RESET_CONSUMED_TOKEN,
    E2E_RESET_RACE_TOKEN,
    E2E_LOGIN_EXPIRED_TOKEN,
    E2E_LOGIN_RACE_TOKEN,
    "e2e-candidato@local.test",
    "e2e-recrutador@local.test",
    "e2e-alvo@local.test",
    "e2e-desabilitada@local.test",
    "E2E Candidate",
    marker,
  ];
  await page.fill('input[name="title"]', "Staff AI Engineer");
  await page.fill('input[name="companyName"]', marker);
  await page.fill('input[name="location"]', "Remote · Brazil");
  await page.fill(
    'textarea[name="description"]',
    "Staff AI Engineer com LangGraph, Python, observability e liderança técnica. " +
      "Remoto no Brasil, contrato B2B. Equity e plano de saúde.",
  );
  // `data-testid` e não `button[type=submit]`: o primeiro submit da página é o
  // "sair" do cabeçalho, e o teste passou a fazer logout achando que cadastrava.
  await page.locator('[data-testid="post-job"]').click();
  await page.waitForURL(/\/jobs\/\d+/, { timeout: 20_000 }).catch(() => {});
  rememberCreatedJob(page.url(), "Staff AI Engineer", marker);
  check("cadastrar leva à vaga criada", /\/jobs\/\d+/.test(page.url()), page.url());

  await page.goto(`${BASE}/jobs?q=${encodeURIComponent(marker)}`, { waitUntil: "networkidle" });
  const posted = await page.evaluate((needle) => {
    const article = [...document.querySelectorAll("article")].find((a) =>
      (a.textContent ?? "").includes(needle),
    );
    return { listed: Boolean(article), labelled: /recrutador/i.test(article?.textContent ?? "") };
  }, marker);

  // Pontuada na hora: sem score a vaga não entra em lista nenhuma e quem
  // cadastrou conclui que falhou.
  check("a vaga cadastrada aparece na lista", posted.listed);
  check("e vem rotulada como recrutador", posted.labelled);


  /* ---------------------- Portfólio público, sem sessão -------------------- */

  // A única rota que responde sem sessão. Verificada de um contexto ANÔNIMO —
  // testá-la com o cookie de sessão presente provaria outra coisa.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();

  const privateHit = await anonPage.goto(`${BASE}/p/default`, { waitUntil: "domcontentloaded" });
  // 404 e não 403: 403 confirmaria que o slug existe, e existência é informação.
  check("perfil não público responde 404 para anônimo", privateHit?.status() === 404,
    `${privateHit?.status()}`);

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  const publicHref = await page.evaluate(
    () => document.querySelector('a[href^="/p/"]')?.getAttribute("href") ?? null,
  );

  if (publicHref) {
    const publicHit = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("perfil público responde a quem não tem sessão", publicHit?.status() === 200,
      `${publicHit?.status()}`);

    const shown = await anonPage.evaluate(() => ({
      body: document.body.textContent ?? "",
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    }));
    // O que a página MOSTRA se corrige depois; o que ela VAZA não tem desfazer.
    check("perfil público não expõe e-mail", !/@zorbit|@local\.test/.test(shown.body));
    // Sem o segundo consentimento o currículo não sai, nem o piso salarial que
    // ele costuma conter — que é a posição de negociação do candidato.
    check("sem o segundo consentimento o currículo não sai", !/SUMMARY|EXPERIENCE/i.test(shown.body));
    // Alcançável sem sessão não é o mesmo que "quero aparecer no Google".
    check("perfil público pede noindex", shown.robots.includes("noindex"), shown.robots);
  } else {
    check("a tela mostra o endereço público", false, "link ausente");
  }

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  if (publicHref) {
    const closed = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("voltar a privado fecha a porta na hora", closed?.status() === 404, `${closed?.status()}`);
  }
  await anon.close();


  /* -------------------- Administração e impersonação ----------------------- */

  // O ciclo inteiro de assumir identidade, porque cada peça dele pode passar
  // isolada e a combinação falhar. Foi o que aconteceu: o campo
  // `impersonated_by` não estava no INSERT, então a sessão emprestada era
  // indistinguível de uma normal — sem banner, com o menu de administração
  // intacto e com poder de admin. A política estava certa; o dado que ela lê
  // nunca chegava.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const adminPage = await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  check("admin alcança a administração de contas", adminPage?.status() === 200);

  const accountRows = await page.locator("li").count();
  check("administração lista as contas", accountRows > 0, `${accountRows} conta(s)`);

  // Conta-alvo dedicada, criada pelo setup. Antes era "a primeira que não é a
  // de teste", e numa base recém-criada não havia nenhuma — a verificação
  // passava por falta de alvo em vez de por funcionar.
  const target = page.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
  const assume = target.locator('[data-testid="impersonate-user"]').first();

  const editTrigger = target.locator('[data-testid="user-edit-open"]').first();
  const editId = await editTrigger.getAttribute("popovertarget");
  check("conta-alvo oferece edição", Boolean(editId));

  if (editId) {
    const editModal = page.locator(`#${editId}`);
    async function readEditValues(modal) {
      return {
        fullName: await modal.locator('input[name="fullName"]').inputValue(),
        email: await modal.locator('input[name="email"]').inputValue(),
        roles: await modal.locator('input[name="roles"]:checked').evaluateAll(
          (roles) => roles.map((role) => role.value),
        ),
      };
    }

    async function delayNextEditAction() {
      const seenGate = Promise.withResolvers();
      const releaseGate = Promise.withResolvers();
      let waiting = true;
      const handler = async (route) => {
        const request = route.request();
        if (
          waiting &&
          request.method() === "POST" &&
          request.headers()["next-action"]
        ) {
          waiting = false;
          seenGate.resolve();
          await releaseGate.promise;
        }
        await route.continue();
      };
      await page.route("**/admin/users", handler);
      return {
        seen: seenGate.promise,
        release: releaseGate.resolve,
        stop: () => page.unroute("**/admin/users", handler),
      };
    }

    const adminModalSpacing = [];
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await editTrigger.click();
      const spacing = await readModalSpacing(editModal);
      adminModalSpacing.push({ width, ...spacing });
      await editModal.locator('[data-testid="user-edit-close"]').click();
    }
    check(
      "modal de usuário respeita topo e padding no desktop e no mobile",
      adminModalSpacing.every(
        ({
          top,
          bottom,
          left,
          right,
          viewportWidth,
          viewportHeight,
          headerPaddingTop,
          headerPaddingBottom,
        }) =>
          top >= 16 &&
          bottom <= viewportHeight - 16 &&
          left >= 0 &&
          right <= viewportWidth &&
          headerPaddingTop === "24px" &&
          headerPaddingBottom === "24px",
      ),
      JSON.stringify(adminModalSpacing),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    await editTrigger.click();
    const originalEditValues = await readEditValues(editModal);
    await editModal.locator('input[name="fullName"]').fill("Alteração abandonada");
    await editModal.locator('input[name="email"]').fill("abandonada@local.test");
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.setChecked(!(await role.isChecked()), { force: true });
    }
    await editModal.locator('[data-testid="user-edit-cancel"]').click();
    await editTrigger.click();
    const reopenedEditValues = await readEditValues(editModal);
    check(
      "fechar sem salvar restaura todos os campos",
      JSON.stringify(reopenedEditValues) === JSON.stringify(originalEditValues),
      JSON.stringify({ originalEditValues, reopenedEditValues }),
    );

    const delayedSave = await delayNextEditAction();
    await editModal.locator('input[name="fullName"]').fill("E2E Alvo atualizado");
    const delayedSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await delayedSave.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    await editModal.locator('input[name="fullName"]').fill("Rascunho depois de reabrir");
    delayedSave.release();
    await delayedSubmitClick;
    await page.locator('[data-testid="user-edit-notice"][role="status"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await delayedSave.stop();

    check(
      "salvamento anterior não fecha uma nova abertura da modal",
      (await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await editModal.locator('input[name="fullName"]').inputValue()) ===
          "Rascunho depois de reabrir",
    );
    check(
      "salvamento concluído depois de fechar ainda anuncia o sucesso",
      (await page.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
    );
    await editModal.locator('[data-testid="user-edit-cancel"]').click();

    const secondTarget = page.locator("li").filter({ hasText: "e2e-candidato@local.test" }).first();
    const secondTrigger = secondTarget.locator('[data-testid="user-edit-open"]').first();
    const secondId = await secondTrigger.getAttribute("popovertarget");
    check("segunda conta oferece edição", Boolean(secondId));
    if (secondId) {
      const secondModal = page.locator(`#${secondId}`);
      await secondTrigger.click();
      await secondModal.locator('input[name="fullName"]').fill("E2E Candidato atualizado");
      await secondModal.locator('[data-testid="user-edit-submit"]').click();
      await page.waitForFunction(
        (id) => !document.getElementById(id)?.matches(":popover-open"),
        secondId,
        { timeout: 15_000 },
      ).catch(() => {});
      check(
        "editar usuário fecha a modal depois do sucesso",
        !(await secondModal.evaluate((element) => element.matches(":popover-open"))),
      );
      check(
        "segunda edição substitui a confirmação anterior",
        (await target.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 0 &&
          (await secondTarget.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
      );
      await secondTarget.locator('[data-testid="user-edit-notice-dismiss"]').click();
      check(
        "notificação de sucesso pode ser fechada",
        (await page.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 0,
      );
    }

    await page.reload({ waitUntil: "networkidle" });
    check(
      "editar usuário persiste o valor depois de recarregar",
      (await target.locator('[data-user-content]').filter({ hasText: "E2E Alvo atualizado" }).count()) >= 1,
    );

    if (await editModal.evaluate((element) => element.matches(":popover-open"))) {
      await editModal.locator('[data-testid="user-edit-close"]').click();
    }

    await editTrigger.click();
    const closedSaveErrorsBefore = consoleErrors.length;
    const closedSave = await delayNextEditAction();
    await editModal.locator('input[name="fullName"]').fill("E2E Alvo salvo fechado");
    const closedSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await closedSave.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    closedSave.release();
    await closedSubmitClick;
    await target.locator('[data-testid="user-edit-notice"][role="status"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await closedSave.stop();
    check(
      "salvamento concluído com a modal fechada anuncia sem reabri-la",
      !(await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await target.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
    );
    check(
      "salvamento concluído com a modal fechada não causa erro no cliente",
      consoleErrors.length === closedSaveErrorsBefore,
      consoleErrors.slice(closedSaveErrorsBefore).join(" | "),
    );

    await editTrigger.click();
    check(
      "reabrir depois do salvamento fechado mostra o valor persistido",
      (await editModal.locator('input[name="fullName"]').inputValue()) ===
        "E2E Alvo salvo fechado",
    );
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const staleError = await delayNextEditAction();
    const staleErrorSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await staleError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    staleError.release();
    await staleErrorSubmitClick;
    await page.waitForFunction(
      (id) => !document.querySelector(`#${id} [data-testid="user-edit-submit"]`)?.disabled,
      editId,
      { timeout: 15_000 },
    );
    await staleError.stop();
    check(
      "erro de uma abertura anterior não aparece na nova modal",
      (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );

    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const closedError = await delayNextEditAction();
    const closedErrorSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await closedError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    closedError.release();
    await closedErrorSubmitClick;
    await target.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await closedError.stop();
    check(
      "erro concluído com a modal fechada aparece como notificação",
      !(await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await target.locator('[data-testid="user-edit-notice"][role="alert"]').textContent())
          ?.includes("Escolha ao menos um papel."),
    );
    await target.locator('[data-testid="user-edit-notice-dismiss"]').click();
    check(
      "notificação de erro pode ser fechada",
      (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0,
    );

    await editTrigger.click();
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const clearedClosedError = await delayNextEditAction();
    const clearedClosedErrorClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await clearedClosedError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    clearedClosedError.release();
    await clearedClosedErrorClick;
    await target.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await clearedClosedError.stop();
    await editTrigger.click();
    await page.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "detached",
      timeout: 15_000,
    });
    check(
      "reabrir a modal limpa a notificação de erro anterior",
      (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0 &&
        (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );

    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    await editModal.locator('[data-testid="user-edit-submit"]').click();
    await editModal.locator('[role="alert"]').waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});

    check(
      "erro de edição mantém a modal aberta",
      await editModal.evaluate((element) => element.matches(":popover-open")),
    );
    check(
      "erro de edição é anunciado dentro da modal",
      (await editModal.locator('[role="alert"]').count()) === 1,
    );
    check(
      "erro de edição usa a mensagem localizada esperada",
      (await editModal.locator('[role="alert"]').textContent())?.trim() === "Escolha ao menos um papel.",
    );
    check(
      "erro de edição preserva os campos inválidos",
      (await editModal.locator('input[name="roles"]:checked').count()) === 0,
    );

    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    check(
      "reabrir depois de erro inline limpa alerta e restaura o cadastro",
      (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="fullName"]').inputValue()) ===
          "E2E Alvo salvo fechado" &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );
    await editModal.locator('[data-testid="user-edit-close"]').click();

  }

  if ((await assume.count()) > 0) {
    await assume.click();
    // Espera pelo RESULTADO, não por `networkidle`: uma Server Action com
    // redirect termina depois que a rede sossega, e a verificação corria antes
    // da página nova existir.
    await page.waitForSelector('[data-testid="stop-impersonating"]', { timeout: 15_000 })
      .catch(() => {});

    const borrowed = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sessão emprestada mostra o aviso", borrowed.banner);
    // Operar como outra pessoa sem perceber é como se escreve no dado errado.
    check("sessão emprestada esconde o menu de administração", borrowed.adminLink === false);

    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    changelogRoleSnapshots.push({
      role: "impersonado",
      snapshot: await changelogSnapshot(page),
    });

    const denied = await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
    // 403 e não 500: negação que parece crash mostra stack em desenvolvimento e
    // não distingue "não pode" de "quebrou".
    check("sessão emprestada recebe 403 na administração", denied?.status() === 403,
      `${denied?.status()}`);

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.click('[data-testid="stop-impersonating"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="stop-impersonating"]'),
      { timeout: 15_000 },
    ).catch(() => {});

    const restored = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sair devolve o admin à própria sessão", !restored.banner && restored.adminLink);

    const roleReference = JSON.stringify(changelogRoleSnapshots[0]?.snapshot ?? null);
    const roleDrift = changelogRoleSnapshots.filter(
      ({ snapshot }) => JSON.stringify(snapshot) !== roleReference,
    );
    check(
      "E2E-023 conteúdo e disclosures são equivalentes entre papéis",
      changelogRoleSnapshots.length === 4 && roleDrift.length === 0 &&
        !roleReference.includes("@local.test"),
      `${changelogRoleSnapshots.map(({ role }) => role).join(", ")} · drift=${roleDrift.length}`,
    );
  } else {
    check("há uma conta para assumir", false, "nenhuma conta além da de teste");
  }


  /* ------------------- Ações do card: largura e alvo de toque -------------- */

  // As três ações ficavam em `flex flex-wrap`, então cada botão media o próprio
  // texto — 54px, 69px e 93px. Lado a lado no celular isso lê como um botão
  // menor que os outros, e foi assim que o defeito chegou. No desktop a coluna
  // já esticava todos: a inconsistência era entre as duas telas.
  //
  // Verificado em três larguras porque a regressão mora justamente na estreita:
  // três colunas fixas espremeriam "aplicar →" para fora da caixa em 320px.
  const actionProblems = [];
  for (const [width, label] of [[320, "320"], [391, "391"], [1440, "1440"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const group = await page.evaluate(() => {
      for (const trigger of document.querySelectorAll("button[popovertarget^='job-modal']")) {
        const box = trigger.parentElement;
        if (!box || box.children.length < 3) continue;
        return [...box.children].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: (el.textContent ?? "").trim().slice(0, 10),
            w: Math.round(r.width),
            h: Math.round(r.height),
            // Texto maior que a caixa é o modo de falhar de largura fixa.
            clipped: el.scrollWidth > el.clientWidth + 1,
          };
        });
      }
      return null;
    });
    if (!group) continue;

    const widths = new Set(group.map((g) => g.w));
    if (widths.size !== 1) {
      actionProblems.push(`${label}: larguras ${[...widths].join("/")}`);
    }
    for (const item of group) {
      if (item.clipped) actionProblems.push(`${label}: "${item.text}" cortado`);
      // No celular o alvo é o dedo. WCAG 2.5.8 pede 24px; 28px passava e
      // continuava apertado numa lista que se percorre rolando.
      const minimum = width < 640 ? 40 : 24;
      if (item.h < minimum) {
        actionProblems.push(`${label}: "${item.text}" ${item.h}px < ${minimum}px`);
      }
    }
  }
  check(
    "ações do card têm largura igual e alvo de toque adequado",
    actionProblems.length === 0,
    actionProblems.slice(0, 4).join(" | "),
  );
  await page.setViewportSize({ width: 1280, height: 900 });


  /* ---------------------- Histórico de versões do CV ----------------------- */

  // As regras (não excluir a atual, não excluir versão citada pelo funil,
  // restaurar acrescentando) estão travadas em `tests/candidate-versions.test.ts`,
  // onde é barato exercitá-las. O que só o browser responde é se o modal abre,
  // prende o foco, fecha no Escape — e se o botão destrutivo simplesmente NÃO
  // existe na linha da versão atual, que é a defesa que o usuário enxerga.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const historyTrigger = page.locator('[data-testid="version-history-open"]').first();
  check("botão de histórico presente", (await historyTrigger.count()) > 0);

  if ((await historyTrigger.count()) > 0) {
    await historyTrigger.click();
    const dialog = page.locator("dialog[open]");
    check("modal de versões abre", (await dialog.count()) === 1);

    // `<dialog>` nativo move o foco para dentro ao abrir com `showModal()`.
    const focusInside = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      return Boolean(d && d.contains(document.activeElement));
    });
    check("modal prende o foco", focusInside);

    const rows = dialog.locator("li");
    const rowCount = await rows.count();
    check("modal lista as versões", rowCount > 0, `${rowCount} versão(ões)`);

    // A linha da versão atual não pode oferecer excluir nem restaurar.
    const currentRow = rows.filter({ hasText: "atual" }).first();
    if ((await currentRow.count()) > 0) {
      const destructive = await currentRow.locator('[data-testid="version-delete"]').count();
      const restore = await currentRow.locator('[data-testid="version-restore"]').count();
      check("versão atual não oferece excluir nem restaurar", destructive === 0 && restore === 0);
    }

    // Visualizar carrega o conteúdo pela ação de servidor.
    await rows.first().locator('[data-testid="version-view-action"]').first().click();
    // `data-testid` e não um seletor por atributo genérico: `data-user-content`
    // também marca o rótulo da versão, e a primeira medição pegou os 40
    // caracteres do rótulo achando que era o documento.
    await page.waitForSelector('[data-testid="version-view"]', { timeout: 5000 });
    const viewed = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="version-view"]');
      return (panel?.textContent ?? "").trim().length;
    });
    check("visualizar mostra o conteúdo da versão", viewed > 50, `${viewed} caracteres`);

    await page.keyboard.press("Escape");
    check("modal fecha com Escape", (await page.locator("dialog[open]").count()) === 0);
  }


  // Volta ao padrão para não deixar o cookie sujo para a próxima execução.
  await page.context().addCookies([
    { name: "jho_theme", value: "hp", url: BASE },
    { name: "jho_mode", value: "system", url: BASE },
  ]);

  /* --------------------------------- Idioma -------------------------------- */

  // Traduzir é fácil de começar e fácil de deixar pela metade: a interface fica
  // 80% em inglês e ninguém percebe as 20% restantes até um usuário reclamar.
  //
  // A PRIMEIRA versão deste teste procurava uma lista de palavras portuguesas
  // escrita à mão. Ela passava com "Editar", "Dividido", "Visualizar",
  // "Vocabulário" e "Práticas" na tela — nenhuma estava na lista, porque a
  // lista era o inventário do que eu já tinha corrigido. Um teste assim
  // confirma a correção anterior e não detecta a próxima.
  //
  // Agora o critério é estrutural, em duas frentes:
  //
  //   1. Texto que É um valor do dicionário português. Exato, sem falso
  //      positivo, e cobre automaticamente toda string futura que passe pelo
  //      dicionário — que é para onde toda string de interface deve ir.
  //   2. Texto com marca gráfica que só o português tem (ã, õ, ç, acentos).
  //      Pega o que nunca chegou a dicionário nenhum, que é justamente o caso
  //      que a frente 1 não alcança.
  //
  // Conteúdo do usuário fica de fora: o currículo tem "São Paulo" e vai
  // continuar tendo com a interface em inglês. É para isso que as regiões de
  // dado do usuário carregam `data-user-content`.
  const { ptBR } = await import("../../src/core/i18n/pt-BR.ts");
  const { en } = await import("../../src/core/i18n/en.ts");

  const flatten = (dict) => Object.values(dict).flatMap((section) => Object.values(section));
  // Palavra igual nos dois idiomas ("Frameworks", "Referrals", "Cockpit") não é
  // vazamento — é a mesma palavra.
  const shared = new Set(flatten(en).map((v) => v.toLowerCase()));
  const portuguese = new Set(
    flatten(ptBR)
      .map((v) => v.toLowerCase())
      .filter((v) => v.length > 2 && !shared.has(v)),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  const leaks = [];
  for (const path of [
    "/",
    "/jobs",
    "/compare",
    "/pipeline",
    "/referrals",
    "/candidate",
    "/candidate/skills",
    "/candidate/vocabulary",
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const found = await page.evaluate((dictionary) => {
      const known = new Set(dictionary);
      const accented = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/;
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (!parent || text.length < 3) continue;
        if (["SCRIPT", "STYLE"].includes(parent.tagName)) continue;
        if (parent.closest("[data-user-content]")) continue;
        // `lang` explícito e diferente da página é declaração deliberada, não
        // vazamento: o nome de um idioma se escreve no próprio idioma.
        const declared = parent.closest("[lang]");
        if (declared && declared !== document.documentElement) continue;
        if (known.has(text.toLowerCase())) out.push(`dicionário: ${text}`);
        else if (accented.test(text)) out.push(`acento: ${text}`);
      }
      return out;
    }, [...portuguese]);
    for (const text of found) leaks.push(`${path} · ${text.slice(0, 52)}`);
  }
  check(
    "interface em inglês não vaza português",
    leaks.length === 0,
    [...new Set(leaks)].slice(0, 8).join(" | "),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  /* ------------- Limite de requisição no portfólio (E-05, jornada) --------- */

  // T5 e T10 do contrato em
  // `.compozy/tasks/_archived/1787413356948-b5a25d70-perfil-publico-limite/_tests.md`.
  //
  // Um IP exclusivo isola esta prova das demais jornadas. O primeiro acesso
  // retorna 200; os 29 seguintes retornam 404. Juntos eles esgotam exatamente
  // o limite de 30, então a requisição seguinte só pode retornar 429 se 200 e
  // 404 realmente consumirem o mesmo balde.
  let burstCtx = null;
  try {
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    await page.check('input[name="visibility"][value="public"]');
    const publishResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && response.request().headers()["next-action"] !== undefined,
    );
    await page.locator('[data-testid="save-visibility"]').click();
    await publishResponse;

    const rateLimitPublicLink = page.locator('a[href^="/p/"]').first();
    await rateLimitPublicLink.waitFor({ state: "visible", timeout: 5000 });
    const rateLimitPublicHref = await rateLimitPublicLink.getAttribute("href");

    const nonce = crypto.randomUUID().replaceAll("-", "");
    const rateLimitClient = `2001:db8:${nonce.slice(0, 4)}:${nonce.slice(4, 8)}:${nonce.slice(8, 12)}:${nonce.slice(12, 16)}::`;
    burstCtx = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": rateLimitClient },
    });
    const burstPage = await burstCtx.newPage();

    let first = null;
    let blocked = null;
    const missingStatuses = [];
    if (rateLimitPublicHref) {
      first = await burstPage.goto(`${BASE}${rateLimitPublicHref}`, {
        waitUntil: "domcontentloaded",
      });
      for (let i = 0; i < 29; i++) {
        const hit = await burstPage.goto(`${BASE}/p/varredura-${nonce}-${i}`, {
          waitUntil: "domcontentloaded",
        });
        missingStatuses.push(hit?.status());
      }
      blocked = await burstPage.goto(`${BASE}/p/varredura-${nonce}-bloqueada`, {
        waitUntil: "domcontentloaded",
      });
    }
    check("acesso isolado ao portfólio não é barrado", first?.status() === 200, `${first?.status()}`);
    check(
      "T5 · respostas 200 e 404 consomem o mesmo balde",
      missingStatuses.length === 29
        && missingStatuses.every((status) => status === 404)
        && blocked?.status() === 429,
      `200=${first?.status()} · 404=${missingStatuses.join(",")} · final=${blocked?.status()}`,
    );
    check("rajada no portfólio é recusada com 429", blocked?.status() === 429);
    check(
      "a recusa diz quando voltar",
      Number(blocked?.headers()["retry-after"] ?? 0) > 0,
      `retry-after=${blocked?.headers()["retry-after"]}`,
    );
  } finally {
    await burstCtx?.close();

    // A restauração fica no `finally`: falha de rede durante a rajada não pode
    // deixar mais público o perfil que o teste encontrou.
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    await page.check(`input[name="visibility"][value="${original}"]`);
    const restoreResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && response.request().headers()["next-action"] !== undefined,
    );
    await page.locator('[data-testid="save-visibility"]').click();
    await restoreResponse;
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const restoredAfterLimit = await page
      .locator(`input[name="visibility"][value="${original}"]`)
      .isChecked();
    check("prova do limite restaura a visibilidade original", restoredAfterLimit, `${original}`);
  }

  /* ------------------ Splash de transição do App Router ------------------ */

  const transitionOverlay = page.locator('[data-testid="navigation-transition"]');
  const transitionError = page.locator('[data-testid="navigation-route-error"]');
  const pushOn = async (targetPage, href) => {
    await targetPage.evaluate((target) => {
      const router = window.next?.router;
      if (!router?.push) throw new Error("App Router client instance unavailable");
      router.push(target);
    }, href);
  };
  const routerPush = (href) => pushOn(page, href);
  const waitForState = async (locator, state, label) => {
    try {
      await locator.waitFor({ state });
    } catch (error) {
      throw new Error(`${label}: ${String(error)}`);
    }
  };
  const resetTransitionDocument = async (locale = "pt-BR") => {
    await page.context().addCookies([{ name: "jho_locale", value: locale, url: BASE }]);
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    await waitForState(transitionOverlay, "detached", "transition reset did not detach overlay");
  };

  const observeNavigation = async (
    targetPage,
    activate,
    destination,
    label = destination,
    captureAtAttach = async () => ({}),
  ) => {
    const overlay = targetPage.locator('[data-testid="navigation-transition"]');
    try {
      await overlay.waitFor({ state: "detached" });
      await targetPage.evaluate(() => {
        globalThis.__e2eTransitionEvidence?.observer?.disconnect();
        const states = [];
        const record = () => {
          const current = document.querySelector('[data-testid="navigation-transition"]');
          if (!current) return;
          const state = {
            generation: Number(current.getAttribute("data-generation")),
            phase: current.getAttribute("data-phase"),
            status: current.querySelector('[role="status"]')?.textContent ?? "",
          };
          const previous = states.at(-1);
          if (!previous || previous.generation !== state.generation || previous.phase !== state.phase) {
            states.push(state);
          }
        };
        const observer = new MutationObserver(record);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-generation", "data-phase"],
          childList: true,
          subtree: true,
        });
        globalThis.__e2eTransitionEvidence = { observer, states };
      });
      const activation = activate();
      await overlay.waitFor({ state: "attached" });
      const snapshot = await overlay.evaluate((element) => ({
        count: document.querySelectorAll('[data-testid="navigation-transition"]').length,
        generation: Number(element.getAttribute("data-generation")),
        phase: element.getAttribute("data-phase"),
        rect: element.getBoundingClientRect().toJSON(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        text: element.textContent ?? "",
      }));
      const attachedEvidence = await captureAtAttach();
      await activation;
      await targetPage.locator(destination).waitFor({ state: "visible", timeout: 20_000 });
      await overlay.waitFor({ state: "detached", timeout: 20_000 });
      const transitionEvidence = await targetPage.evaluate(() => {
        const evidence = globalThis.__e2eTransitionEvidence;
        evidence?.observer?.disconnect();
        delete globalThis.__e2eTransitionEvidence;
        return evidence?.states ?? [];
      });
      return { ...snapshot, ...attachedEvidence, transitionEvidence };
    } catch (error) {
      throw new Error(`${label}: ${String(error)}`);
    }
  };

  const observeRedirectAction = async (targetPage, activate, destination) => {
    let actionRequests = 0;
    let actionResponses = 0;
    let actionResponseSeen = false;
    const countAction = (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) actionRequests += 1;
    };
    const countActionResponse = (response) => {
      const request = response.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actionResponses += 1;
        actionResponseSeen = true;
      }
    };
    targetPage.on("request", countAction);
    targetPage.on("response", countActionResponse);
    try {
      const snapshot = await observeNavigation(
        targetPage,
        activate,
        destination,
        destination,
        async () => ({ actionResponseSeenAtAttach: actionResponseSeen }),
      );
      return { ...snapshot, actionRequests, actionResponses };
    } finally {
      targetPage.off("request", countAction);
      targetPage.off("response", countActionResponse);
    }
  };

  const readCacheStorage = async (targetPage) => targetPage.evaluate(async () => {
    const names = await caches.keys();
    const entries = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({
          cache: name,
          url: request.url,
          body: response ? await response.clone().text() : "",
        });
      }
    }
    return { names, entries };
  });

  /* ------------ Task 04: first-party inventory and canonical flows -------- */
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopDestinations = [
    ["nav-cockpit", "route-cockpit"],
    ["nav-jobs", "route-jobs"],
    ["nav-compare", "route-compare"],
    ["nav-pipeline", "route-pipeline"],
    ["nav-referrals", "route-referrals"],
    ["nav-candidate", "route-candidate"],
    ["nav-admin-users", "route-admin-users"],
  ];
  const desktopFailures = [];
  const desktopIntegrationEvidence = [];
  for (const [control, destination] of desktopDestinations) {
    const source = control === "nav-jobs" ? "/compare" : "/jobs";
    await page.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    const snapshot = await observeNavigation(
      page,
      () => page.locator(`[data-testid="${control}"]:visible`).first().click(),
      `[data-testid="${destination}"]`,
    );
    desktopIntegrationEvidence.push(snapshot);
    if (
      snapshot.count !== 1 ||
      snapshot.rect.left !== 0 ||
      snapshot.rect.top !== 0 ||
      Math.round(snapshot.rect.width) !== snapshot.viewport.width ||
      Math.round(snapshot.rect.height) !== snapshot.viewport.height
    ) {
      desktopFailures.push(`${control}:${JSON.stringify(snapshot)}`);
    }
  }
  check(
    "task-04 E2E-001 menu desktop cobre todos os destinos com um splash full-screen",
    desktopFailures.length === 0,
    desktopFailures.slice(0, 2).join(" | "),
  );
  check(
    "task-04 IT-002 Link real e router hook coalescem em uma geração observável",
    desktopIntegrationEvidence.length === desktopDestinations.length
      && desktopIntegrationEvidence.every(({ count, generation, phase, transitionEvidence }) =>
        count === 1
          && generation === 1
          && phase === "loading"
          && transitionEvidence.filter((state) =>
            state.generation === 1 && state.phase === "loading"
          ).length === 1
      ),
    JSON.stringify(desktopIntegrationEvidence.map(({ count, generation, phase, transitionEvidence }) => ({
      count,
      generation,
      phase,
      transitionEvidence,
    }))),
  );

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileFailures = [];
  for (const [control, destination] of desktopDestinations) {
    const source = control === "nav-jobs" ? "/compare" : "/jobs";
    await page.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="mobile-nav-trigger"]').click();
    const popover = page.locator('[data-testid="mobile-nav-popover"]');
    await popover.waitFor({ state: "visible" });
    const snapshot = await observeNavigation(
      page,
      () => popover.locator(`[data-testid="${control}"]`).click(),
      `[data-testid="${destination}"]`,
    );
    const result = await page.evaluate(() => ({
      popoverOpen: document.querySelector('[data-testid="mobile-nav-popover"]')?.matches(":popover-open"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    if (snapshot.count !== 1 || result.popoverOpen || result.overflow > 1) {
      mobileFailures.push(`${control}:${JSON.stringify({ snapshot, result })}`);
    }
  }
  check(
    "task-04 E2E-002 menu móvel fecha antes do destino e mantém paridade sem overflow",
    mobileFailures.length === 0,
    mobileFailures.slice(0, 2).join(" | "),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const firstJobLink = page.locator('[data-testid^="job-link-"]').first();
  const contextualPhases = [];
  contextualPhases.push((await observeNavigation(page, () => firstJobLink.click(), '[data-testid="route-job-detail"]')).phase);
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="filters-query"]').fill("Task 04 typical fixture");
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const typicalCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="density-compact"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const densityState = {
    query: new URL(page.url()).searchParams.get("dense"),
    current: await page.locator('[data-testid="density-compact"]').getAttribute("aria-current"),
    layout: await page.locator('[data-density]').first().getAttribute("data-density"),
  };
  await page.locator('[data-testid="filters-query"]').fill("Task 04 bulk fixture");
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="page-size-200"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const bulkCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="pagination-next"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const paginationUrl = new URL(page.url());
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="preset-applicableToday"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const presetUrl = new URL(page.url());
  const contextualState = {
    pagination: {
      path: paginationUrl.pathname,
      query: paginationUrl.searchParams.get("q"),
      size: paginationUrl.searchParams.get("size"),
      page: paginationUrl.searchParams.get("page"),
    },
    preset: {
      path: presetUrl.pathname,
      fit: presetUrl.searchParams.get("fit"),
      unblocked: presetUrl.searchParams.get("unblocked"),
      named: presetUrl.searchParams.get("named"),
      stalePage: presetUrl.searchParams.get("page"),
    },
  };
  await page.locator('[data-testid="filters-query"]').fill(`zero-${crypto.randomUUID()}`);
  contextualPhases.push((await observeNavigation(
    page,
    () => page.locator('[data-testid="filters-submit"]').click(),
    '[data-testid="route-jobs"]',
  )).phase);
  const zeroCardinality = {
    cards: await page.locator('[data-testid^="job-link-"]').count(),
    summary: await page.locator('[data-testid="route-jobs"] > header > p').textContent(),
    next: await page.locator('[data-testid="pagination-next"]').count(),
  };
  check(
    "task-04 E2E-003 card, densidade, paginação e GET cobrem zero, típico e milhares",
    contextualPhases.length === 8
      && contextualPhases.every((phase) => phase === "loading")
      && typicalCardinality.cards === 7
      && /^7\s/.test(typicalCardinality.summary ?? "")
      && typicalCardinality.next === 0
      && densityState.query === "1"
      && densityState.current === "page"
      && densityState.layout === "compact"
      && bulkCardinality.cards === 200
      && /1[.,]001/.test(bulkCardinality.summary ?? "")
      && bulkCardinality.next === 1
      && contextualState.pagination.path === "/jobs"
      && contextualState.pagination.query === "Task 04 bulk fixture"
      && contextualState.pagination.size === null
      && contextualState.pagination.page === "2"
      && contextualState.preset.path === "/jobs"
      && contextualState.preset.fit === "60"
      && contextualState.preset.unblocked === "1"
      && contextualState.preset.named === "1"
      && contextualState.preset.stalePage === null
      && zeroCardinality.cards === 0
      && /^0\s/.test(zeroCardinality.summary ?? "")
      && zeroCardinality.next === 0,
    JSON.stringify({
      contextualPhases,
      typicalCardinality,
      densityState,
      bulkCardinality,
      contextualState,
      zeroCardinality,
    }),
  );

  const contextualFamilyFailures = [];
  const verifyContextualDestination = async (source, control, destination, expectedPath) => {
    await page.goto(`${BASE}${source}`, { waitUntil: "networkidle" });
    const link = page.locator(control).first();
    const targetPath = expectedPath ?? new URL(await link.getAttribute("href"), BASE).pathname;
    const snapshot = await observeNavigation(
      page,
      () => link.click(),
      destination,
      `${source} via ${control}`,
    );
    const actualPath = new URL(page.url()).pathname;
    if (snapshot.count !== 1 || actualPath !== targetPath) {
      contextualFamilyFailures.push(`${control}:${JSON.stringify({ count: snapshot.count, actualPath })}`);
    }
  };

  await verifyContextualDestination(
    "/candidate",
    '[data-testid="candidate-skills-link"]',
    '[data-testid="route-candidate-skills"]',
    "/candidate/skills",
  );
  await verifyContextualDestination(
    "/candidate/skills",
    '[data-testid="skills-vocabulary-link"]',
    '[data-testid="route-candidate-vocabulary"]',
    "/candidate/vocabulary",
  );
  await verifyContextualDestination(
    "/candidate/vocabulary",
    '[data-testid="vocabulary-candidate-link"]',
    '[data-testid="route-candidate"]',
    "/candidate",
  );
  await verifyContextualDestination(
    "/compare",
    '[data-testid="compare-candidate-link"]',
    '[data-testid="route-candidate"]',
    "/candidate",
  );
  await verifyContextualDestination(
    `/compare?job=${comparisonJobId}#comparison-result`,
    '[data-testid="compare-job-link"]',
    '[data-testid="route-job-detail"]',
    `/jobs/${comparisonJobId}`,
  );
  await verifyContextualDestination(
    `/jobs/${TASK04_FIXTURES.closedJobId}`,
    '[data-testid="job-detail-back"]',
    '[data-testid="route-jobs"]',
    "/jobs",
  );

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
  const pipelineRow = page.locator('[data-testid^="pipeline-job-"]').first();
  const pipelineHasRow = await pipelineRow.count() > 0;
  const pipelineControl = pipelineHasRow ? pipelineRow : page.locator('[data-testid="pipeline-empty-jobs"]');
  const pipelineExpected = pipelineHasRow
    ? new URL(await pipelineControl.getAttribute("href"), BASE).pathname
    : "/jobs";
  const pipelineSnapshot = await observeNavigation(
    page,
    () => pipelineControl.click(),
    pipelineHasRow ? '[data-testid="route-job-detail"]' : '[data-testid="route-jobs"]',
    "pipeline contextual destination",
  );
  if (pipelineSnapshot.count !== 1 || new URL(page.url()).pathname !== pipelineExpected) {
    contextualFamilyFailures.push(`pipeline:${page.url()}`);
  }

  await verifyContextualDestination(
    "/referrals",
    '[data-testid^="referral-job-"]',
    '[data-testid="route-job-detail"]',
    null,
  );
  check(
    "task-04 E2E-003 famílias contextuais chegam ao destino e preservam estado",
    contextualFamilyFailures.length === 0,
    contextualFamilyFailures.join(" | "),
  );

  const redirectEvidence = [];
  const actionLoginCtx = await browser.newContext();
  const actionLoginPage = await actionLoginCtx.newPage();
  await actionLoginCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await actionLoginPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await actionLoginPage.fill('input[name="email"]', E2E_EMAIL);
  await actionLoginPage.fill('input[name="password"]', E2E_PASSWORD);
  redirectEvidence.push(await observeRedirectAction(
    actionLoginPage,
    () => actionLoginPage.locator('[data-testid="login-submit"]').click(),
    '[data-testid="route-cockpit"]',
  ));
  await actionLoginCtx.close();

  const actionRecoveryCtx = await browser.newContext();
  const actionRecoveryPage = await actionRecoveryCtx.newPage();
  await actionRecoveryCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await actionRecoveryPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await actionRecoveryPage.fill('input[name="email"]', "nao-existe-task04@local.test");
  redirectEvidence.push(await observeRedirectAction(
    actionRecoveryPage,
    () => actionRecoveryPage.locator('[data-testid="request-reset"]').click(),
    '[data-testid="route-login-forgot"]',
  ));
  await actionRecoveryCtx.close();

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.fill('input[name="title"]', "Task 04 redirect fixture");
  await page.fill('input[name="companyName"]', "E2E Comparison Lab");
  await page.fill('textarea[name="description"]', comparisonText);
  redirectEvidence.push(await observeRedirectAction(
    page,
    () => page.locator('[data-testid="compare-submit"]').click(),
    '[data-testid="comparison-result"]',
  ));
  rememberCreatedJob(page.url(), "Task 04 redirect fixture", "E2E Comparison Lab");

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const jobFormEntry = await observeNavigation(
    page,
    () => routerPush("/jobs/new"),
    '[data-testid="route-jobs-new"]',
  );
  const task04RecruiterCompany = `Task 04 ${crypto.randomUUID()}`;
  const task04OneShotTitle = `Task 04 one-shot ${crypto.randomUUID()}`;
  await page.fill('input[name="title"]', task04OneShotTitle);
  await page.fill('input[name="companyName"]', task04RecruiterCompany);
  await page.fill('textarea[name="description"]', comparisonText);
  const oneShotRedirect = await observeRedirectAction(
    page,
    () => page.locator('[data-testid="post-job"]').click(),
    '[data-testid="route-job-detail"]',
  );
  redirectEvidence.push(oneShotRedirect);
  rememberCreatedJob(page.url(), task04OneShotTitle, task04RecruiterCompany);
  await page.goto(`${BASE}/jobs?q=${encodeURIComponent(task04OneShotTitle)}&size=200&fit=0`, {
    waitUntil: "networkidle",
  });
  const oneShotMutationCount = await page
    .locator('[data-testid^="job-link-"]')
    .filter({ hasText: task04OneShotTitle })
    .count();

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const administratorTransition = await observeNavigation(
    page,
    () => page.locator('[data-testid="nav-admin-users"]:visible').click(),
    '[data-testid="route-admin-users"]',
  );
  const administratorCache = await readCacheStorage(page);
  const task04Target = page.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
  const impersonationEntry = await observeRedirectAction(
    page,
    () => task04Target.locator('[data-testid="impersonate-user"]').click(),
    '[data-testid="stop-impersonating"]',
  );
  redirectEvidence.push(impersonationEntry);
  const impersonatedTransition = await observeNavigation(
    page,
    () => page.locator('[data-testid="nav-compare"]:visible').click(),
    '[data-testid="route-compare"]',
  );
  const impersonatedCache = await readCacheStorage(page);
  const impersonationExit = await observeRedirectAction(
    page,
    () => page.locator('[data-testid="stop-impersonating"]').click(),
    '[data-testid="route-admin-users"]',
  );
  const restoredAdministratorCache = await readCacheStorage(page);
  check(
    "task-04 E2E-004 redirects de login, recovery, compare, vaga e impersonação mutam uma vez",
    redirectEvidence.length === 5 && redirectEvidence.every(({ count, actionRequests }) => count === 1 && actionRequests === 1),
    JSON.stringify(redirectEvidence.map(({ count, actionRequests }) => ({ count, actionRequests }))),
  );
  check(
    "task-04 IT-012 Server Actions reais mutam uma vez e iniciam somente o redirect aceito",
    jobFormEntry.generation === 1
      && oneShotRedirect.generation === jobFormEntry.generation + 1
      && oneShotRedirect.count === 1
      && oneShotRedirect.actionRequests === 1
      && oneShotRedirect.actionResponses === 1
      && oneShotRedirect.actionResponseSeenAtAttach
      && oneShotRedirect.transitionEvidence.filter((state) =>
        state.generation === oneShotRedirect.generation && state.phase === "loading"
      ).length === 1
      && oneShotMutationCount === 1,
    JSON.stringify({ jobFormEntry, oneShotRedirect, oneShotMutationCount }),
  );

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await observeNavigation(page, () => page.locator('[data-testid="nav-compare"]:visible').click(), '[data-testid="route-compare"]');
  await observeNavigation(page, () => page.locator('[data-testid="nav-pipeline"]:visible').click(), '[data-testid="route-pipeline"]');
  const backToCompare = page.goBack({ waitUntil: "commit" });
  await transitionOverlay.waitFor({ state: "attached" });
  const firstHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await backToCompare;
  await page.locator('[data-testid="route-compare"]').waitFor({ state: "visible" });
  const backToJobs = page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(
    (generation) => Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation")) > generation,
    firstHistoryGeneration,
  );
  const secondHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await backToJobs;
  await page.locator('[data-testid="route-jobs"]').waitFor({ state: "visible" });
  const forwardToCompare = page.goForward({ waitUntil: "commit" });
  await page.waitForFunction(
    (generation) => Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation")) > generation,
    secondHistoryGeneration,
  );
  const finalHistoryGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await forwardToCompare;
  await page.locator('[data-testid="route-compare"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  const historyFocus = await page.evaluate(() => ({
    path: location.pathname,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    focusedOverlay: Boolean(document.activeElement?.closest('[data-testid="navigation-transition"]')),
  }));
  check(
    "task-04 E2E-005 histórico rápido multi-entry termina no dono final sem foco removido",
    firstHistoryGeneration < secondHistoryGeneration
      && secondHistoryGeneration < finalHistoryGeneration
      && historyFocus.path === "/compare"
      && historyFocus.overlays === 0
      && !historyFocus.focusedOverlay,
    JSON.stringify({ firstHistoryGeneration, secondHistoryGeneration, finalHistoryGeneration, historyFocus }),
  );
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const visibilityBeforeTask04 = await page.locator('input[name="visibility"]:checked').getAttribute("value") ?? "private";
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const task04PublicHref = await page.locator('a[href^="/p/"]').first().getAttribute("href");

  const publicCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const publicPage = await publicCtx.newPage();
  await publicCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const directRouteLayers = [];
  for (const path of [
    "/login",
    "/login/forgot",
    "/login/reset?token=nunca-existiu-task04-direct",
    `/login/callback?token=${E2E_LOGIN_EXPIRED_TOKEN}`,
    task04PublicHref,
  ].filter(Boolean)) {
    const directPage = await publicCtx.newPage();
    await directPage.goto(`${BASE}${path}`, { waitUntil: "commit" });
    await directPage.locator("#app-splash").waitFor({ state: "attached", timeout: 10_000 });
    directRouteLayers.push(await directPage.evaluate(() => ({
      path: location.pathname + location.search,
      startup: document.querySelectorAll("#app-splash").length,
      transition: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    })));
    await directPage.close();
  }
  await publicPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await publicPage.locator("#app-splash").waitFor({ state: "detached" });
  const publicPhases = [];
  publicPhases.push(await observeNavigation(
    publicPage,
    () => publicPage.locator('[data-testid="forgot-password"]').click(),
    '[data-testid="route-login-forgot"]',
  ));
  publicPhases.push(await observeNavigation(
    publicPage,
    () => publicPage.locator('[data-testid="login-back"]').click(),
    '[data-testid="route-login"]',
  ));
  const resetSoftTransition = await observeNavigation(
    publicPage,
    () => publicPage.evaluate(() => window.next?.router?.push?.("/login/reset?token=nunca-existiu-task04-soft")),
    '[data-testid="route-login-reset"]',
  );
  publicPhases.push(resetSoftTransition);
  publicPhases.push(await observeNavigation(
    publicPage,
    () => publicPage.evaluate(() => window.next?.router?.push?.("/login")),
    '[data-testid="route-login"]',
  ));
  const callbackSoftTransition = await observeNavigation(
    publicPage,
    () => publicPage.evaluate((token) => {
      window.next?.router?.push?.(`/login/callback?token=${encodeURIComponent(token)}`);
    }, E2E_LOGIN_EXPIRED_TOKEN),
    '[data-testid="route-login"]',
    "expired callback soft transition",
  );
  publicPhases.push(callbackSoftTransition);
  if (task04PublicHref) {
    publicPhases.push(await observeNavigation(
      publicPage,
      () => publicPage.evaluate((href) => window.next?.router?.push?.(href), task04PublicHref),
      '[data-testid="route-public-profile"]',
    ));
  }
  const publicUserText = task04PublicHref
    ? (await publicPage.locator('[data-testid="route-public-profile"] h1').textContent()) ?? ""
    : "missing-public-profile";
  const publicProfileMarkers = task04PublicHref
    ? (await publicPage.locator('[data-testid="route-public-profile"] [data-user-content]').allTextContents())
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== publicUserText)
    : [];
  const publicLeakMarkers = [publicUserText, ...publicProfileMarkers]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  check(
    "task-04 E2E-013 startup direto e auth/public soft usam uma camada sem conteúdo do usuário",
    directRouteLayers.length === 5
      && directRouteLayers.every(({ startup, transition }) => startup === 1 && transition === 0)
      && publicPhases.length === 6
      && publicProfileMarkers.length > 0
      && publicPhases.every(({ count, text }) =>
        count === 1
          && privateMarkers.every((term) => !text.includes(term))
          && publicLeakMarkers.every((term) => !text.includes(term))
      ),
    JSON.stringify({ directRouteLayers, phases: publicPhases.length, publicLeakMarkers }),
  );
  await publicPage.goto(`${BASE}/login/reset?token=nunca-existiu-task04`, { waitUntil: "networkidle" });
  const invalidReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  await publicPage.goto(`${BASE}/login/reset?token=${E2E_RESET_EXPIRED_TOKEN}`, { waitUntil: "networkidle" });
  const expiredReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  const expiredResetForms = await publicPage.locator('input[name="password"]').count();
  await publicPage.goto(`${BASE}/login/reset?token=${E2E_RESET_CONSUMED_TOKEN}`, { waitUntil: "networkidle" });
  const consumedReset = await publicPage.locator('[data-testid="route-login-reset"]').textContent();
  const consumedResetForms = await publicPage.locator('input[name="password"]').count();

  const resetRaceContexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const resetRacePages = await Promise.all(resetRaceContexts.map((context) => context.newPage()));
  const resetRacePosts = [0, 0];
  for (const [index, resetPage] of resetRacePages.entries()) {
    resetPage.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) resetRacePosts[index] += 1;
    });
    await resetPage.goto(`${BASE}/login/reset?token=${E2E_RESET_RACE_TOKEN}`, { waitUntil: "networkidle" });
    await resetPage.fill('input[name="password"]', `task04-race-password-${index + 1}!`);
  }
  await Promise.all(resetRacePages.map(async (resetPage) => {
    await Promise.all([
      resetPage.waitForURL((url) => url.pathname === "/login" || url.searchParams.get("error") === "invalid"),
      resetPage.locator('[data-testid="submit-reset"]').click(),
    ]);
  }));
  const resetRaceUrls = resetRacePages.map((resetPage) => resetPage.url().replace(BASE, ""));
  const resetWinnerIndex = resetRaceUrls.findIndex((url) => url === "/login?reset=1");
  if (resetWinnerIndex === -1) throw new Error("reset race produced no successful consumer");
  const resetReplayPage = resetRacePages[resetWinnerIndex];
  const consumedResetPath = `/login/reset?token=${E2E_RESET_RACE_TOKEN}`;
  await resetReplayPage.goto(`${BASE}${consumedResetPath}`, { waitUntil: "networkidle" });
  const resetReplayAfterConsume = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await resetReplayPage.reload({ waitUntil: "networkidle" });
  const resetReplayAfterReload = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await resetReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await resetReplayPage.goBack({ waitUntil: "networkidle" });
  const resetReplayAfterHistory = {
    url: resetReplayPage.url().replace(BASE, ""),
    forms: await resetReplayPage.locator('input[name="password"]').count(),
  };
  await Promise.all(resetRaceContexts.map((context) => context.close()));
  await publicPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_EXPIRED_TOKEN}`, { waitUntil: "networkidle" });
  const expiredCallback = new URL(publicPage.url());
  const expiredCallbackUrl = expiredCallback.pathname + expiredCallback.search;
  const loginRaceContexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const loginRacePages = await Promise.all(loginRaceContexts.map((context) => context.newPage()));
  await Promise.all(loginRacePages.map((loginPage) =>
    loginPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" })
  ));
  const loginRaceUrls = loginRacePages.map((loginPage) => {
    const url = new URL(loginPage.url());
    return url.pathname + url.search;
  });
  const loginRaceSessions = await Promise.all(loginRaceContexts.map(async (context) =>
    (await context.cookies()).some((cookie) => cookie.name === "jho_session")
  ));
  const loginWinnerIndex = loginRaceSessions.findIndex(Boolean);
  if (loginWinnerIndex === -1) throw new Error("login race produced no successful consumer");
  const loginReplayContext = loginRaceContexts[loginWinnerIndex];
  const loginReplayPage = loginRacePages[loginWinnerIndex];
  await loginReplayContext.clearCookies();
  await loginReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await loginReplayPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" });
  const loginReplayAfterConsumeUrl = new URL(loginReplayPage.url());
  const loginReplayAfterConsume = loginReplayAfterConsumeUrl.pathname + loginReplayAfterConsumeUrl.search;
  await loginReplayPage.reload({ waitUntil: "networkidle" });
  const loginReplayAfterReloadUrl = new URL(loginReplayPage.url());
  const loginReplayAfterReload = loginReplayAfterReloadUrl.pathname + loginReplayAfterReloadUrl.search;
  await loginReplayPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await loginReplayPage.goBack({ waitUntil: "networkidle" });
  const loginReplayAfterHistoryUrl = new URL(loginReplayPage.url());
  const loginReplayAfterHistory = loginReplayAfterHistoryUrl.pathname + loginReplayAfterHistoryUrl.search;
  const loginReplayRestoredSession = (await loginReplayContext.cookies())
    .some((cookie) => cookie.name === "jho_session");
  await Promise.all(loginRaceContexts.map((context) => context.close()));
  await publicPage.goto(`${BASE}/login/callback?token=${E2E_LOGIN_RACE_TOKEN}`, { waitUntil: "networkidle" });
  const replayCallback = new URL(publicPage.url());
  const replayCallbackUrl = replayCallback.pathname + replayCallback.search;
  const emptyProfileResponse = await publicPage.goto(`${BASE}/p/e2e-e2e-alvo`, { waitUntil: "networkidle" });
  const emptyProfile = await publicPage.evaluate(() => {
    const main = document.querySelector('[data-testid="route-public-profile"]');
    return {
      statusSurface: Boolean(main),
      heading: main?.querySelector("h1")?.textContent?.trim() ?? "",
      optionalParagraphs: main?.querySelectorAll("p").length ?? -1,
      optionalSections: main?.querySelectorAll("section").length ?? -1,
      optionalLinks: main?.querySelectorAll("a").length ?? -1,
      overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(
    "task-04 E2E-018 tokens inválidos, expirados, consumidos e raceados preservam resultado canônico",
    /não vale mais/i.test(invalidReset ?? "")
      && expiredReset === consumedReset
      && /não vale mais/i.test(expiredReset ?? "")
      && expiredResetForms === 0
      && consumedResetForms === 0
      && resetRacePosts.every((count) => count === 1)
      && resetRaceUrls.filter((url) => url === "/login?reset=1").length === 1
      && resetRaceUrls.filter((url) => url.includes("error=invalid")).length === 1
      && expiredCallbackUrl === "/login?error=invalid"
      && loginRaceUrls.filter((url) => url === "/login").length === 1
      && loginRaceUrls.filter((url) => url === "/login?error=invalid").length === 1
      && loginRaceSessions.filter(Boolean).length === 1
      && replayCallbackUrl === "/login?error=invalid"
      && [resetReplayAfterConsume, resetReplayAfterReload, resetReplayAfterHistory]
        .every(({ url, forms }) => url === consumedResetPath && forms === 0)
      && loginReplayAfterConsume === "/login?error=invalid"
      && loginReplayAfterReload === "/login?error=invalid"
      && loginReplayAfterHistory === "/login?error=invalid"
      && !loginReplayRestoredSession
      && emptyProfileResponse?.status() === 200
      && emptyProfile.statusSurface
      && emptyProfile.heading === "e2e-alvo@local.test"
      && emptyProfile.optionalParagraphs === 0
      && emptyProfile.optionalSections === 0
      && emptyProfile.optionalLinks === 0
      && emptyProfile.overlays === 0
      && emptyProfile.overflow <= 1,
    JSON.stringify({
      expiredResetForms,
      consumedResetForms,
      resetRacePosts,
      resetRaceUrls,
      expiredCallbackUrl,
      loginRaceUrls,
      loginRaceSessions,
      replayCallbackUrl,
      resetReplayAfterConsume,
      resetReplayAfterReload,
      resetReplayAfterHistory,
      loginReplayAfterConsume,
      loginReplayAfterReload,
      loginReplayAfterHistory,
      loginReplayRestoredSession,
      emptyProfile,
    }),
  );

  const longPublicPath = `/p/${"a".repeat(16 * 1024)}`;
  const longResponse = await publicPage.goto(`${BASE}${longPublicPath}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const longOutcome = await publicPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    body: document.body.innerText,
  }));
  const malformedResponse = await publicPage.goto(`${BASE}/p/%`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const malformedOutcome = await publicPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    body: document.body.innerText,
  }));
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const missingJobTransition = await observeNavigation(
    page,
    () => routerPush("/jobs/999999999"),
    "body",
    "missing job soft transition",
  );
  const missingJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    body: document.body.innerText,
  }));

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const closedJobTransition = await observeNavigation(
    page,
    () => routerPush(`/jobs/${E2E_CLOSED_JOB_ID}`),
    '[data-testid="route-job-detail"]',
    "closed job soft transition",
  );
  const closedJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    body: document.querySelector('[data-testid="route-job-detail"]')?.textContent ?? "",
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
  }));

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const deletedJobTransition = await observeNavigation(
    page,
    () => routerPush(`/jobs/${E2E_DELETED_JOB_ID}`),
    "body",
    "deleted job soft transition",
  );
  const deletedJobOutcome = await page.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    jobDetail: document.querySelectorAll('[data-testid="route-job-detail"]').length,
    body: document.body.innerText,
  }));
  if (!task04PublicHref) throw new Error("Task 04 public profile href unavailable for revocation race");
  const revocationCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    serviceWorkers: "block",
  });
  const revocationPage = await revocationCtx.newPage();
  trackConsole(revocationPage);
  await revocationCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await revocationPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await revocationPage.fill('input[name="email"]', E2E_EMAIL);
  await revocationPage.fill('input[name="password"]', E2E_PASSWORD);
  await observeRedirectAction(
    revocationPage,
    () => revocationPage.locator('[data-testid="login-submit"]').click(),
    '[data-testid="route-cockpit"]',
  );
  await revocationPage.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const revocationLink = revocationPage.locator(`a[href="${task04PublicHref}"]`).first();
  if (await revocationLink.count() !== 1) throw new Error("Public profile TransitionLink unavailable for revocation race");
  const revocationTarget = task04PublicHref;
  const revocationPath = new URL(revocationTarget, BASE).pathname;
  let releaseRevocationRequest = () => {};
  let markRevocationPending = () => {};
  const revocationPending = new Promise((resolve) => { markRevocationPending = resolve; });
  let heldRevocationRequest = false;
  const holdRevocation = async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const isNavigationTransport = request.method() === "GET";
    if (!heldRevocationRequest && isNavigationTransport && requestUrl.pathname === revocationPath) {
      heldRevocationRequest = true;
      markRevocationPending();
      await new Promise((resolve) => { releaseRevocationRequest = resolve; });
    }
    await route.continue();
  };
  await revocationPage.route("**/*", holdRevocation);
  await revocationLink.click({ noWaitAfter: true });
  let revocationTimeoutId;
  const revocationTimeout = new Promise((_, reject) => {
    revocationTimeoutId = setTimeout(() => reject(new Error("revocation request was not intercepted")), 20_000);
  });
  try {
    await Promise.all([
      Promise.race([revocationPending, revocationTimeout]),
      revocationPage.locator('[data-testid="navigation-transition"]').waitFor({ state: "attached", timeout: 20_000 }),
    ]);
  } catch (error) {
    releaseRevocationRequest();
    throw error;
  } finally {
    clearTimeout(revocationTimeoutId);
  }
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"])),
    page.locator('[data-testid="save-visibility"]').click(),
  ]);
  releaseRevocationRequest();
  await revocationPage.waitForURL((url) => url.pathname === revocationPath, { timeout: 20_000 });
  await revocationPage.locator('[data-testid="navigation-transition"]').waitFor({ state: "detached", timeout: 20_000 });
  const revokedProfileOutcome = await revocationPage.evaluate(() => ({
    path: location.pathname,
    noIndex: document.querySelector('meta[name="robots"]')?.getAttribute("content")?.includes("noindex") ?? false,
    overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
    publicProfile: document.querySelectorAll('[data-testid="route-public-profile"]').length,
    body: document.body.innerText,
  }));
  await revocationPage.unroute("**/*", holdRevocation);
  await revocationCtx.close();
  const staleEntityMarkers = [
    ...publicProfileMarkers,
    "Task 04 deleted fixture",
    "Task 04 Deleted Lab",
  ];
  check(
    "task-04 E2E-019 URL hostil, vagas ausente/deletada/fechada e revogação pending ficam canônicas",
    (longResponse?.status() ?? 0) >= 400
      && longOutcome.overflow <= 1
      && longOutcome.overlays === 0
      && malformedOutcome.overflow <= 1
      && malformedOutcome.overlays === 0
      && (malformedResponse?.status() ?? 0) >= 400
      && missingJobOutcome.path === "/jobs/999999999"
      && missingJobOutcome.noIndex
      && missingJobOutcome.overlays === 0
      && missingJobOutcome.jobDetail === 0
      && staleEntityMarkers.every((term) => !missingJobOutcome.body.includes(term))
      && closedJobOutcome.path === `/jobs/${E2E_CLOSED_JOB_ID}`
      && closedJobOutcome.jobDetail === 1
      && /Task 04 closed fixture/.test(closedJobOutcome.body)
      && /fechada/i.test(closedJobOutcome.body)
      && closedJobOutcome.overlays === 0
      && deletedJobOutcome.path === `/jobs/${E2E_DELETED_JOB_ID}`
      && deletedJobOutcome.noIndex
      && deletedJobOutcome.overlays === 0
      && deletedJobOutcome.jobDetail === 0
      && staleEntityMarkers.every((term) => !deletedJobOutcome.body.includes(term))
      && heldRevocationRequest
      && revokedProfileOutcome.path === task04PublicHref
      && revokedProfileOutcome.noIndex
      && revokedProfileOutcome.overlays === 0
      && revokedProfileOutcome.publicProfile === 0
      && publicProfileMarkers.every((term) => !revokedProfileOutcome.body.includes(term))
      && privateMarkers.every((term) => !longOutcome.body.includes(term))
      && privateMarkers.every((term) => !malformedOutcome.body.includes(term)),
    JSON.stringify({
      longStatus: longResponse?.status(),
      longOutcome,
      malformedStatus: malformedResponse?.status(),
      malformedOutcome,
      missingJobOutcome,
      closedJobOutcome,
      deletedJobOutcome,
      heldRevocationRequest,
      revokedProfileOutcome,
    }),
  );
  check(
    "task-04 IT-014 entidades ausentes, fechadas e revogadas preservam resultado canônico sem cache privado",
    [missingJobTransition, closedJobTransition, deletedJobTransition]
      .every(({ count, generation }) => count === 1 && Number.isInteger(generation) && generation > 0)
      && missingJobOutcome.noIndex
      && missingJobOutcome.jobDetail === 0
      && closedJobOutcome.jobDetail === 1
      && /fechada/i.test(closedJobOutcome.body)
      && deletedJobOutcome.noIndex
      && deletedJobOutcome.jobDetail === 0
      && revokedProfileOutcome.noIndex
      && revokedProfileOutcome.publicProfile === 0
      && [missingJobOutcome, closedJobOutcome, deletedJobOutcome, revokedProfileOutcome]
        .every(({ overlays }) => overlays === 0),
    JSON.stringify({
      transitions: [missingJobTransition, closedJobTransition, deletedJobTransition]
        .map(({ count, generation }) => ({ count, generation })),
      missingJobOutcome,
      closedJobOutcome,
      deletedJobOutcome,
      revokedProfileOutcome,
    }),
  );
  await publicCtx.close();

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check(`input[name="visibility"][value="${visibilityBeforeTask04}"]`);
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(700);

  const roleTransitionResults = [];
  for (const scenario of [
    {
      email: "e2e-candidato@local.test",
      locale: "en",
      prepare: "/jobs",
      control: '[data-testid="nav-compare"]:visible',
      landmark: '[data-testid="route-compare"]',
    },
    {
      email: "e2e-recrutador@local.test",
      prepare: `/jobs/${E2E_CLOSED_JOB_ID}`,
      control: '[data-testid="nav-jobs"]:visible',
      landmark: '[data-testid="route-jobs"]',
    },
  ]) {
    const roleCtx = await browser.newContext();
    if (scenario.locale) {
      await roleCtx.addCookies([{ name: "jho_locale", value: scenario.locale, url: BASE }]);
    }
    const rolePage = await roleCtx.newPage();
    await rolePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await rolePage.fill('input[name="email"]', scenario.email);
    await rolePage.fill('input[name="password"]', E2E_PASSWORD);
    await rolePage.locator('[data-testid="login-submit"]').click();
    await rolePage.waitForURL((url) => !url.pathname.startsWith("/login"));
    if (scenario.prepare) await rolePage.goto(`${BASE}${scenario.prepare}`, { waitUntil: "networkidle" });
    const snapshot = await observeNavigation(
      rolePage,
      () => rolePage.locator(scenario.control).click(),
      scenario.landmark,
      `task-04 E2E-020 ${scenario.email}`,
    );
    let emptyPipelineLocale = null;
    if (scenario.email === "e2e-candidato@local.test") {
      const pipelineTransition = await observeNavigation(
        rolePage,
        () => rolePage.locator('[data-testid="nav-pipeline"]:visible').click(),
        '[data-testid="route-pipeline"]',
        "task-04 empty pipeline locale",
      );
      emptyPipelineLocale = {
        transition: pipelineTransition.count,
        emptyLink: await rolePage.locator('[data-testid="pipeline-empty-jobs"]').count(),
        text: (await rolePage.locator('[data-testid="route-pipeline"]').textContent()) ?? "",
      };
      await rolePage.reload({ waitUntil: "networkidle" });
      emptyPipelineLocale.reloadedText =
        (await rolePage.locator('[data-testid="route-pipeline"]').textContent()) ?? "";
    }
    let missingRoleSnapshot = null;
    let missingRoleOutcome = null;
    if (scenario.email === "e2e-recrutador@local.test") {
      missingRoleSnapshot = await observeNavigation(
        rolePage,
        () => pushOn(rolePage, "/candidate"),
        "body",
        "task-04 missing-role soft transition",
      );
      missingRoleOutcome = await rolePage.evaluate(() => ({
        path: location.pathname,
        candidate: document.querySelectorAll('[data-testid="route-candidate"]').length,
        overlays: document.querySelectorAll('[data-testid="navigation-transition"]').length,
        body: document.body.innerText,
      }));
    }
    const cache = await readCacheStorage(rolePage);
    roleTransitionResults.push({
      email: scenario.email,
      snapshot,
      missingRoleSnapshot,
      missingRoleOutcome,
      emptyPipelineLocale,
      cache,
    });
    await roleCtx.close();
  }

  const expiredCtx = await browser.newContext();
  const expiredPage = await expiredCtx.newPage();
  await expiredPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await expiredPage.fill('input[name="email"]', "e2e-candidato@local.test");
  await expiredPage.fill('input[name="password"]', E2E_PASSWORD);
  await expiredPage.locator('[data-testid="login-submit"]').click();
  await expiredPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expiredCtx.clearCookies();
  await expiredCtx.addCookies([{ name: "jho_session", value: "expired-task04", url: BASE }]);
  const expiredSnapshot = await observeNavigation(
    expiredPage,
    () => expiredPage.locator('[data-testid="nav-compare"]:visible').click(),
    '[data-testid="route-login"]',
    "task-04 E2E-020 expired session",
  );
  const expiredCache = await readCacheStorage(expiredPage);
  await expiredCtx.close();

  const recruiterMissingRole = roleTransitionResults
    .find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot;
  const recruiterMissingRoleOutcome = roleTransitionResults
    .find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleOutcome;
  if (!recruiterMissingRole) throw new Error("missing-role transition evidence unavailable");
  const namedRoleTransitions = [
    ...roleTransitionResults.map(({ email, snapshot }) => ({ role: email, snapshot })),
    { role: "administrator", snapshot: administratorTransition },
    { role: "impersonated-administrator", snapshot: impersonatedTransition },
    { role: "expired-session", snapshot: expiredSnapshot },
    { role: "missing-role", snapshot: recruiterMissingRole },
  ];
  const roleNeutral = namedRoleTransitions.map(({ snapshot }) => snapshot.text)
    .every((text) => privateMarkers.every((term) => !text.includes(term)));
  const roleCaches = [
    ...roleTransitionResults.map(({ email, cache }) => ({ role: email, cache })),
    { role: "administrator", cache: administratorCache },
    { role: "impersonated-administrator", cache: impersonatedCache },
    { role: "restored-administrator", cache: restoredAdministratorCache },
    { role: "expired-session", cache: expiredCache },
  ];
  const roleCachePayload = JSON.stringify(roleCaches.map(({ cache }) => cache));
  const roleCacheIsolated = roleCaches.every(({ cache }) =>
    cache.names.every((name) => name.startsWith("static-") || name.startsWith("shell-"))
      && cache.entries.every(({ url }) => {
        const path = new URL(url).pathname;
        return ![
          "/admin/users",
          "/candidate",
          "/compare",
          "/jobs",
          "/pipeline",
          "/referrals",
          "/p/",
          "/api/",
        ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
      })
  ) && privateMarkers.every((term) => !roleCachePayload.includes(term));
  check(
    "task-04 E2E-020 papéis e sessão expirada chegam ao destino canônico com copy neutra",
    namedRoleTransitions.length === 6
      && namedRoleTransitions.every(({ snapshot }) => snapshot.count === 1)
      && roleTransitionResults.find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot?.count === 1
      && recruiterMissingRoleOutcome?.path === "/candidate"
      && recruiterMissingRoleOutcome?.candidate === 0
      && recruiterMissingRoleOutcome?.overlays === 0
      && /forbidden|403|accessed|acesso|proibid/i.test(recruiterMissingRoleOutcome?.body ?? "")
      && impersonationEntry.count === 1
      && impersonationExit.count === 1
      && roleNeutral
      && roleCacheIsolated,
    JSON.stringify({
      roles: namedRoleTransitions.map(({ role, snapshot }) => [role, snapshot.count]),
      missingRoleOutcome: recruiterMissingRoleOutcome,
      roleNeutral,
      roleCacheIsolated,
    }),
  );
  const candidateEmptyPipeline = roleTransitionResults
    .find(({ email }) => email === "e2e-candidato@local.test")?.emptyPipelineLocale;
  check(
    "BUG-20260823 funil vazio permanece integralmente em inglês após transição e recarga",
    candidateEmptyPipeline?.transition === 1
      && candidateEmptyPipeline?.emptyLink === 1
      && candidateEmptyPipeline.text.includes(en.pipeline.noApplications)
      && candidateEmptyPipeline.text.includes(en.pipeline.startWith)
      && candidateEmptyPipeline.text.includes(en.pipeline.jobsList)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.noApplications)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.startWith)
      && candidateEmptyPipeline.reloadedText.includes(en.pipeline.jobsList)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.noApplications)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.startWith)
      && !candidateEmptyPipeline.text.includes(ptBR.pipeline.jobsList)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.noApplications)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.startWith)
      && !candidateEmptyPipeline.reloadedText.includes(ptBR.pipeline.jobsList),
    JSON.stringify(candidateEmptyPipeline),
  );
  check(
    "task-04 IT-013 tokens, papéis, sessão e impersonação chegam ao destino autorizado e liberam overlay",
    expiredResetForms === 0
      && consumedResetForms === 0
      && resetRacePosts.every((count) => count === 1)
      && expiredCallbackUrl === "/login?error=invalid"
      && replayCallbackUrl === "/login?error=invalid"
      && resetSoftTransition.count === 1
      && callbackSoftTransition.count === 1
      && roleTransitionResults.length === 2
      && roleTransitionResults.every(({ snapshot }) => snapshot.count === 1)
      && roleTransitionResults.find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot?.count === 1
      && impersonationExit.count === 1
      && expiredSnapshot.count === 1
      && roleNeutral,
    JSON.stringify({
      expiredResetForms,
      consumedResetForms,
      resetRacePosts,
      expiredCallbackUrl,
      replayCallbackUrl,
      resetSoftTransition: resetSoftTransition.count,
      callbackSoftTransition: callbackSoftTransition.count,
      roleTransitionResults: roleTransitionResults.map(({ email, snapshot }) => [email, snapshot.count]),
      missingRoleTransition: roleTransitionResults.find(({ email }) => email === "e2e-recrutador@local.test")?.missingRoleSnapshot?.count,
      impersonationExit: impersonationExit.count,
      expiredCount: expiredSnapshot.count,
      roleNeutral,
    }),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await resetTransitionDocument();
  await page.evaluate(() => window.next?.router?.prefetch?.("/transition-test"));
  await page.waitForTimeout(700);
  const fastStartedAt = await page.evaluate(() => performance.now());
  await routerPush("/transition-test");
  await transitionOverlay.waitFor({ state: "attached" });
  const fastSingleton = await transitionOverlay.count();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "leaving",
  );
  const fastLeavingAt = await page.evaluate(() => performance.now());
  await transitionOverlay.waitFor({ state: "detached" });
  const fastDuration = fastLeavingAt - fastStartedAt;
  check(
    "transition E2E-006 rota prefetched observa 180 ms sem herdar 900 ms",
    fastSingleton === 1
      && fastDuration >= 150
      && fastDuration < 900
      && (await page.locator('[data-testid="transition-test-destination"]').count()) === 1,
    `${Math.round(fastDuration)}ms · overlays=${fastSingleton}`,
  );

  await resetTransitionDocument();
  const prolongedStartedAt = await page.evaluate(() => performance.now());
  await routerPush("/transition-test?delay=prolonged");
  await transitionOverlay.waitFor({ state: "attached" });
  const normalCopy = await transitionOverlay.locator('[role="status"]').textContent();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "prolonged",
    undefined,
    { timeout: 5000 },
  );
  const prolongedAt = await page.evaluate(() => performance.now());
  const prolongedCopy = await transitionOverlay.locator('[role="status"]').textContent();
  const indeterminate =
    (await transitionOverlay.locator(".app-splash__barra").getAttribute("aria-valuenow")) === null;
  await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  check(
    "transition E2E-007 espera prolongada é verdadeira e indeterminada",
    normalCopy?.includes(ptBR.transition.loading) === true
      && prolongedCopy?.includes(ptBR.transition.prolonged) === true
      && prolongedAt - prolongedStartedAt >= 2900
      && indeterminate,
    `${Math.round(prolongedAt - prolongedStartedAt)}ms · ${prolongedCopy}`,
  );

  await resetTransitionDocument();
  await routerPush("/transition-test?delay=race-old");
  await transitionOverlay.waitFor({ state: "attached" });
  const olderGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await routerPush("/transition-test?delay=race-new");
  await page.waitForFunction(
    (generation) =>
      Number(document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-generation"))
        > generation,
    olderGeneration,
  );
  const newerGeneration = Number(await transitionOverlay.getAttribute("data-generation"));
  await page.waitForTimeout(850);
  const newerStillOwns =
    (await transitionOverlay.count()) === 1
    && Number(await transitionOverlay.getAttribute("data-generation")) === newerGeneration;
  await page.waitForURL(/delay=race-new/);
  await transitionOverlay.waitFor({ state: "detached" });
  check(
    "transition E2E-008 conclusão antiga não encerra a geração nova",
    newerGeneration > olderGeneration && newerStillOwns,
    `${olderGeneration}→${newerGeneration}`,
  );

  const exerciseClientFailure = async (token) => {
    await resetTransitionDocument();
    await routerPush(`/transition-test?error=${encodeURIComponent(token)}`);
    await waitForState(transitionOverlay, "attached", `${token}: error navigation did not mount overlay`);
    await waitForState(transitionError, "visible", `${token}: error boundary did not become visible`);
    const failure = await transitionError.textContent();
    const released = await page.locator("#application-shell").evaluate((shell) => ({
      inert: shell.hasAttribute("inert"),
      busy: shell.getAttribute("aria-busy"),
    }));
    const body = (await page.locator("body").textContent()) ?? "";
    await page.locator('[data-testid="navigation-route-error-retry"]').click();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
    return {
      token,
      failure,
      released,
      rawVisible: ["TRANSITION_TEST_ROUTE_FAILURE", token, "[object Object]"]
        .some((value) => body.includes(value)),
      overlayAfterRetry: await transitionOverlay.count(),
    };
  };
  const clientFailures = [
    await exerciseClientFailure(`ordinary-${crypto.randomUUID()}`),
    await exerciseClientFailure(`unparseable-${crypto.randomUUID()}`),
  ];
  check(
    "transition E2E-009 falha comum e valor não parseável liberam overlay, redigem detalhe e aceitam retry",
    clientFailures.every(({ failure, released, rawVisible, overlayAfterRetry }) =>
      failure?.includes(ptBR.transition.failedTitle) === true
        && failure?.includes(ptBR.transition.failedBody) === true
        && failure?.includes(ptBR.transition.retry) === true
        && released.inert === false
        && released.busy === null
        && !rawVisible
        && overlayAfterRetry === 0
    ),
    JSON.stringify(clientFailures),
  );

  await resetTransitionDocument();
  await routerPush("/transition-test?delay=prolonged");
  await transitionOverlay.waitFor({ state: "attached" });
  const shellWhileBusy = await page.locator("#application-shell").evaluate((shell) => ({
    inert: shell.hasAttribute("inert"),
    busy: shell.getAttribute("aria-busy"),
  }));
  const liveStatus = transitionOverlay.locator('[role="status"][aria-live="polite"][aria-atomic="true"]');
  const statusCount = await liveStatus.count();
  const accessibilitySnapshot = await liveStatus.ariaSnapshot();
  const focusOutsideStatus = await transitionOverlay.evaluate((overlay) =>
    !overlay.contains(document.activeElement),
  );
  let underlyingBlocked = false;
  try {
    await page.locator('#application-shell a[href="/jobs"]').first().click({ timeout: 350 });
  } catch {
    underlyingBlocked = true;
  }
  await page.keyboard.press("Tab");
  const keyboardFocusWhileBusy = await page.evaluate(() => ({
    inApplicationShell: Boolean(document.activeElement?.closest("#application-shell")),
    inStatus: document.activeElement?.getAttribute("role") === "status",
  }));
  const generationBeforeTheme = Number(await transitionOverlay.getAttribute("data-generation"));
  const statusBeforeTheme = await transitionOverlay.locator('[role="status"]').textContent();
  const transitionContrastFailures = [];
  const systemModeEvidence = [];
  for (const theme of ["hp", "huly", "graphy"]) {
    for (const fixture of [
      { mode: "light", colorScheme: "light", label: "light" },
      { mode: "dark", colorScheme: "dark", label: "dark" },
      { mode: "system", colorScheme: "light", label: "system-light" },
      { mode: "system", colorScheme: "dark", label: "system-dark" },
    ]) {
      await page.emulateMedia({ colorScheme: fixture.colorScheme });
      const sample = await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        if (mode === "system") delete document.documentElement.dataset.mode;
        else document.documentElement.dataset.mode = mode;
        const overlay = document.querySelector('[data-testid="navigation-transition"]');
        const status = overlay?.querySelector('[role="status"]');
        return {
          count: document.querySelectorAll('[data-testid="navigation-transition"]').length,
          foreground: status ? getComputedStyle(status).color : "",
          background: overlay ? getComputedStyle(overlay).backgroundColor : "",
          modeAttribute: document.documentElement.getAttribute("data-mode"),
          prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
          generation: overlay?.getAttribute("data-generation") ?? null,
          status: status?.textContent ?? "",
        };
      }, { theme, mode: fixture.mode });
      const ratio = contrast(toRgb(sample.foreground), toRgb(sample.background));
      if (sample.count !== 1 || ratio < 4.5) {
        transitionContrastFailures.push(`${theme}/${fixture.label}:${ratio.toFixed(2)}`);
      }
      if (fixture.mode === "system") {
        systemModeEvidence.push({ theme, ...fixture, ...sample, ratio });
      }
    }
  }
  await page.emulateMedia({ colorScheme: null });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await transitionOverlay.evaluate((overlay) => {
    const brand = overlay.querySelector(".app-splash__marca");
    const sweep = overlay.querySelector(".app-splash__barra span");
    return {
      rootTransition: getComputedStyle(overlay).transitionDuration,
      brandAnimation: brand ? getComputedStyle(brand).animationName : null,
      sweepAnimation: sweep ? getComputedStyle(sweep).animationName : null,
      generation: overlay.getAttribute("data-generation"),
      status: overlay.querySelector('[role="status"]')?.textContent ?? "",
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "transition E2E-016 temas e movimento reduzido mudam sem reiniciar estado",
    transitionContrastFailures.length === 0
      && systemModeEvidence.length === 6
      && systemModeEvidence.every((sample) =>
        sample.modeAttribute === null
          && sample.prefersDark === (sample.colorScheme === "dark")
          && Number(sample.generation) === generationBeforeTheme
          && sample.status === statusBeforeTheme
      )
      && reducedMotion.rootTransition === "0s"
      && reducedMotion.brandAnimation === "none"
      && reducedMotion.sweepAnimation === "none"
      && Number(reducedMotion.generation) === generationBeforeTheme
      && reducedMotion.status === statusBeforeTheme,
    JSON.stringify({ transitionContrastFailures, systemModeEvidence, reducedMotion }),
  );
  await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  await transitionOverlay.waitFor({ state: "detached" });
  const focusAfterTransition = await page.evaluate(() => ({
    inOverlay: Boolean(document.activeElement?.closest('[data-testid="navigation-transition"]')),
    role: document.activeElement?.getAttribute("role") ?? null,
  }));
  check(
    "transition E2E-015 saída não prende foco no status removido",
    !focusAfterTransition.inOverlay && focusAfterTransition.role !== "status",
    JSON.stringify(focusAfterTransition),
  );

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const keyboardControl = page.locator('[data-testid="nav-compare"]:visible').first();
  await keyboardControl.focus();
  const keyboardTransition = await observeNavigation(
    page,
    () => page.keyboard.press("Enter"),
    '[data-testid="route-compare"]',
    "keyboard navigation transition",
  );

  const touchCtx = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const touchPage = await touchCtx.newPage();
  await touchCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await touchPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await touchPage.fill('input[name="email"]', E2E_EMAIL);
  await touchPage.fill('input[name="password"]', E2E_PASSWORD);
  await touchPage.locator('[data-testid="login-submit"]').click();
  await touchPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await touchPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const mobileTriggerBox = await touchPage.locator('[data-testid="mobile-nav-trigger"]').boundingBox();
  if (!mobileTriggerBox) throw new Error("mobile navigation trigger has no touch target");
  await touchPage.touchscreen.tap(
    mobileTriggerBox.x + mobileTriggerBox.width / 2,
    mobileTriggerBox.y + mobileTriggerBox.height / 2,
  );
  const touchControl = touchPage.locator('[data-testid="mobile-nav-popover"] [data-testid="nav-compare"]');
  await touchControl.waitFor({ state: "visible" });
  const touchControlBox = await touchControl.boundingBox();
  if (!touchControlBox) throw new Error("mobile compare control has no touch target");
  const touchTransition = await observeNavigation(
    touchPage,
    () => touchPage.touchscreen.tap(
      touchControlBox.x + touchControlBox.width / 2,
      touchControlBox.y + touchControlBox.height / 2,
    ),
    '[data-testid="route-compare"]',
    "touch navigation transition",
  );
  const touchOverflow = await touchPage.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  await touchCtx.close();

  check(
    "transition E2E-015 árvore acessível, pointer, teclado e toque preservam um status e bloqueiam o shell",
    shellWhileBusy.inert
      && shellWhileBusy.busy === "true"
      && statusCount === 1
      && /status/i.test(accessibilitySnapshot)
      && accessibilitySnapshot.includes(statusBeforeTheme ?? "")
      && focusOutsideStatus
      && underlyingBlocked
      && !keyboardFocusWhileBusy.inApplicationShell
      && !keyboardFocusWhileBusy.inStatus
      && keyboardTransition.count === 1
      && touchTransition.count === 1
      && touchOverflow <= 1,
    JSON.stringify({
      shellWhileBusy,
      statusCount,
      accessibilitySnapshot,
      focusOutsideStatus,
      underlyingBlocked,
      keyboardFocusWhileBusy,
      keyboardTransition: keyboardTransition.count,
      touchTransition: touchTransition.count,
      touchOverflow,
    }),
  );

  for (const locale of ["pt-BR", "en"]) {
    const dictionary = locale === "pt-BR" ? ptBR : en;
    const opposite = locale === "pt-BR" ? en : ptBR;
    await resetTransitionDocument(locale);
    await routerPush("/transition-test?delay=race-new");
    await transitionOverlay.waitFor({ state: "attached" });
    const localizedNormal = (await transitionOverlay.locator('[role="status"]').textContent())?.trim();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
    );
    const localizedOffline = (await transitionOverlay.textContent()) ?? "";

    await resetTransitionDocument(locale);
    await routerPush("/transition-test?delay=prolonged");
    await transitionOverlay.waitFor({ state: "attached" });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "prolonged",
      undefined,
      { timeout: 5000 },
    );
    const localizedProlonged = (await transitionOverlay.locator('[role="status"]').textContent())?.trim();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
    await transitionOverlay.waitFor({ state: "detached" });
    check(
      `transition E2E-014 ${locale} normal, prolongado e offline usam só o dicionário ativo`,
      localizedNormal === dictionary.transition.loading
        && localizedProlonged === dictionary.transition.prolonged
        && localizedOffline?.includes(dictionary.transition.offlineTitle) === true
        && localizedOffline?.includes(dictionary.transition.offlineBody) === true
        && localizedOffline?.includes(dictionary.transition.retry) === true
        && !localizedNormal?.includes(opposite.transition.loading)
        && !localizedProlonged?.includes(opposite.transition.prolonged)
        && !localizedOffline.includes(opposite.transition.offlineTitle)
        && !localizedOffline.includes(opposite.transition.offlineBody)
        && !localizedOffline.includes(opposite.transition.retry),
      JSON.stringify({ localizedNormal, localizedProlonged, localizedOffline }),
    );

    await resetTransitionDocument(locale);
    const token = crypto.randomUUID();
    await routerPush(`/transition-test?error=${token}`);
    await transitionError.waitFor({ state: "visible" });
    const localizedFailure = (await transitionError.textContent()) ?? "";
    check(
      `transition E2E-014 ${locale} falha usa somente o dicionário ativo`,
      localizedFailure?.includes(dictionary.transition.failedTitle) === true
        && localizedFailure?.includes(dictionary.transition.failedBody) === true
        && localizedFailure?.includes(dictionary.transition.retry) === true
        && !localizedFailure.includes(opposite.transition.failedTitle)
        && !localizedFailure.includes(opposite.transition.failedBody)
        && !localizedFailure.includes(opposite.transition.retry),
      localizedFailure ?? "",
    );
    await page.locator('[data-testid="navigation-route-error-retry"]').click();
    await page.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  }

  const zoomCdp = await page.context().newCDPSession(page);
  const zoomEvidence = [];
  for (const fixture of [
    { label: "desktop", physicalWidth: 1280, physicalHeight: 900, safe: [0, 0, 0, 0] },
    { label: "mobile", physicalWidth: 375, physicalHeight: 812, safe: [47, 20, 34, 44] },
  ]) {
    await page.setViewportSize({ width: fixture.physicalWidth, height: fixture.physicalHeight });
    const cssWidth = Math.ceil(fixture.physicalWidth / 2);
    const cssHeight = Math.ceil(fixture.physicalHeight / 2);
    await zoomCdp.send("Emulation.setDeviceMetricsOverride", {
      width: cssWidth,
      height: cssHeight,
      deviceScaleFactor: 2,
      mobile: false,
      screenWidth: fixture.physicalWidth,
      screenHeight: fixture.physicalHeight,
    });
    await resetTransitionDocument("en");
    await routerPush("/transition-test?delay=race-new");
    await transitionOverlay.waitFor({ state: "attached" });
    await page.evaluate(([top, right, bottom, left]) => {
      const root = document.documentElement.style;
      root.setProperty("--safe-area-top", `${top}px`);
      root.setProperty("--safe-area-right", `${right}px`);
      root.setProperty("--safe-area-bottom", `${bottom}px`);
      root.setProperty("--safe-area-left", `${left}px`);
      window.dispatchEvent(new Event("offline"));
    }, fixture.safe);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
    );
    await transitionOverlay.locator('[role="status"] p').evaluate((paragraph) => {
      paragraph.textContent = `${paragraph.textContent} ${paragraph.textContent}`;
    });
    const sample = await transitionOverlay.evaluate((overlay) => {
      const root = overlay.getBoundingClientRect();
      const contentElement = overlay.querySelector(".navigation-transition__content");
      const content = contentElement?.getBoundingClientRect();
      const status = overlay.querySelector('[role="status"] p');
      const style = getComputedStyle(overlay);
      const statusStyle = status ? getComputedStyle(status) : null;
      return {
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: window.screen.width, height: window.screen.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        visualViewport: window.visualViewport
          ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              scale: window.visualViewport.scale,
            }
          : null,
        root: { top: root.top, right: root.right, bottom: root.bottom, left: root.left },
        content: content
          ? { top: content.top, right: content.right, bottom: content.bottom, left: content.left }
          : null,
        padding: {
          top: Number.parseFloat(style.paddingTop),
          right: Number.parseFloat(style.paddingRight),
          bottom: Number.parseFloat(style.paddingBottom),
          left: Number.parseFloat(style.paddingLeft),
        },
        status: status
          ? {
              clientWidth: status.clientWidth,
              scrollWidth: status.scrollWidth,
              scrollHeight: status.scrollHeight,
              lineHeight: Number.parseFloat(statusStyle?.lineHeight ?? "0"),
              text: status.textContent ?? "",
            }
          : null,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    zoomEvidence.push({ ...fixture, cssWidth, cssHeight, sample });
  }
  await zoomCdp.send("Emulation.clearDeviceMetricsOverride");
  check(
    "transition E2E-017 desktop e mobile em zoom Chromium 200%, safe area e copy longa permanecem contidos",
    zoomEvidence.length === 2
      && zoomEvidence.every(({ cssWidth, cssHeight, safe, sample }) =>
        sample.devicePixelRatio === 2
          && sample.viewport.width === cssWidth
          && sample.viewport.height === cssHeight
          && sample.root.top === 0
          && sample.root.left === 0
          && sample.root.right === cssWidth
          && sample.root.bottom === cssHeight
          && sample.content?.left >= safe[3]
          && sample.content?.right <= cssWidth - safe[1]
          && sample.padding.top >= safe[0]
          && sample.padding.right >= safe[1]
          && sample.padding.bottom >= safe[2]
          && sample.padding.left >= safe[3]
          && sample.status?.text.split(" ").length > 12
          && sample.status.scrollWidth <= sample.status.clientWidth
          && sample.status.scrollHeight > sample.status.lineHeight
          && sample.scrollWidth <= cssWidth
      ),
    JSON.stringify(zoomEvidence),
  );
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  /* --------------------------------- Logout -------------------------------- */
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="sign-out"]').click();
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  // Revogado no servidor, não só apagado no navegador.
  check("logout encerra a sessão de verdade", page.url().includes("/login"), page.url());

  /* ------------------------------ PWA (UI-05) ------------------------------ */
  // O que a instalação exige precisa responder SEM sessão: um manifest atrás de
  // login não é lido por navegador nenhum, e o app simplesmente não oferece
  // instalar — sem erro, sem aviso.
  const pwaCtx = await browser.newContext();
  const pwaPage = await pwaCtx.newPage();

  const missing = [];
  for (const path of ["/manifest.json", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"]) {
    const hit = await pwaPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    if (hit?.status() !== 200) missing.push(`${path}=${hit?.status()}`);
  }
  check("recursos da PWA respondem sem sessão", missing.length === 0, missing.join(" | "));

  await pwaPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const head = await pwaPage.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
    themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("media")),
  }));
  check("a página aponta para o manifest", head.manifest === "/manifest.json", `${head.manifest}`);
  // Duas cores porque o sistema tem tema claro e escuro; uma só deixaria a
  // barra do navegador escura sobre interface clara.
  check(
    "theme-color acompanha claro e escuro",
    head.themes.length === 2 && head.themes.every((m) => m?.includes("prefers-color-scheme")),
    head.themes.join(" | "),
  );

  // O service worker servido tem de trazer a VERSÃO, não o marcador. Com o
  // marcador literal todo cache se chamaria `static-__APP_VERSION__` e nenhum
  // deploy invalidaria coisa alguma.
  const swBody = await (await pwaPage.request.get(`${BASE}/sw.js`)).text();
  check(
    "o service worker servido traz a versão resolvida",
    !swBody.includes("__APP_VERSION__") && /CACHE_VERSION = "\d/.test(swBody),
    swBody.match(/CACHE_VERSION = "[^"]*"/)?.[0] ?? "ausente",
  );
  // E não guarda rota privada. A lista vive no template; aqui se confere que o
  // que foi servido é o que se pensa que foi.
  check(
    "o service worker servido exclui as rotas privadas",
    ["/api/", "/candidate", "/pipeline", "/p/"].every((p) => swBody.includes(`"${p}"`)),
  );

  await pwaPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await pwaPage.reload({ waitUntil: "networkidle" });
  await pwaPage.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Use an authenticated controlled document for the soft-navigation journey.
  await pwaPage.fill('input[name="email"]', E2E_EMAIL);
  await pwaPage.fill('input[name="password"]', E2E_PASSWORD);
  await pwaPage.locator('[data-testid="login-submit"]').click();
  await pwaPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await pwaPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });

  let freshDocumentRequests = 0;
  const targetPath = "/transition-test?delay=prolonged";
  const countFreshDocument = (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "document" && `${url.pathname}${url.search}` === targetPath) {
      freshDocumentRequests += 1;
    }
  };
  pwaPage.on("request", countFreshDocument);
  await pwaPage.evaluate((target) => {
    const router = window.next?.router;
    if (!router?.push) throw new Error("App Router client instance unavailable");
    router.push(target);
  }, targetPath);
  const pwaTransition = pwaPage.locator('[data-testid="navigation-transition"]');
  await pwaTransition.waitFor({ state: "attached" });
  await pwaCtx.setOffline(true);
  await pwaPage.waitForFunction(
    () => document.querySelector('[data-testid="navigation-transition"]')?.getAttribute("data-phase") === "offline",
  );
  const softOfflineCopy = await pwaTransition.textContent();
  await pwaCtx.setOffline(false);
  await pwaPage.locator('[data-testid="navigation-transition-retry"]').evaluate((button) => {
    button.click();
    button.click();
  });
  await pwaPage.waitForURL((url) => `${url.pathname}${url.search}` === targetPath);
  await pwaPage.locator('[data-testid="transition-test-destination"]').waitFor({ state: "visible" });
  pwaPage.off("request", countFreshDocument);
  check(
    "offline E2E-010 soft failure mostra uma fase e retry faz uma navegação fresca",
    softOfflineCopy?.includes(ptBR.transition.offlineTitle) === true
      && softOfflineCopy?.includes(ptBR.transition.offlineBody) === true
      && freshDocumentRequests === 1,
    `documents=${freshDocumentRequests} · ${softOfflineCopy}`,
  );

  const offlineAttempts = ["/jobs", "/p/e2e-revoked-profile", "/pipeline?history=offline"];
  const offlineDocuments = [];
  await pwaCtx.setOffline(true);
  for (const path of offlineAttempts) {
    await pwaPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const first = await pwaPage.locator("body").textContent();
    const firstUrl = pwaPage.url();
    await pwaPage.reload({ waitUntil: "domcontentloaded" });
    const repeated = await pwaPage.locator("body").textContent();
    offlineDocuments.push({ path, first, firstUrl, repeated, repeatedUrl: pwaPage.url() });
  }
  const realCacheAudit = await pwaPage.evaluate(async () => {
    const entries = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ cacheName, url: request.url, body: response ? await response.text() : "" });
      }
    }
    return entries;
  });
  await pwaCtx.setOffline(false);
  const persistedCache = JSON.stringify(realCacheAudit);
  const cachedPaths = realCacheAudit.map(({ url }) => new URL(url).pathname);
  check(
    "offline E2E-011 full start/reload preserva URL e só persiste corpos públicos",
    offlineDocuments.every(({ path, first, firstUrl, repeated, repeatedUrl }) =>
      new URL(firstUrl).pathname + new URL(firstUrl).search === path
        && new URL(repeatedUrl).pathname + new URL(repeatedUrl).search === path
        && first?.includes(ptBR.transition.offlineTitle)
        && first?.includes(ptBR.transition.retry)
        && repeated?.includes(ptBR.transition.offlineTitle)
    )
      && privateMarkers.every((marker) => !persistedCache.includes(marker))
      && realCacheAudit.every(({ cacheName }) => /^(?:static|shell)-/.test(cacheName))
      && !cachedPaths.some((path) => path === "/login" || path.startsWith("/p/") || path.startsWith("/jobs")),
    JSON.stringify({ offlineDocuments, cachedPaths }),
  );

  const freshCtx = await browser.newContext();
  const freshPage = await freshCtx.newPage();
  await freshCtx.setOffline(true);
  let freshOfflineFailed = false;
  try {
    await freshPage.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded", timeout: 4_000 });
  } catch {
    freshOfflineFailed = true;
  }
  const freshOfflineBody = await freshPage.locator("body").textContent().catch(() => "");
  await freshCtx.setOffline(false);
  const recovered = await freshPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });

  const refusedCtx = await browser.newContext();
  const refusedPage = await refusedCtx.newPage();
  const refusedCdp = await refusedCtx.newCDPSession(refusedPage);
  await refusedCdp.send("Storage.overrideQuotaForOrigin", { origin: BASE, quotaSize: 1 });
  await refusedPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await refusedPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await refusedPage.reload({ waitUntil: "networkidle" });
  await refusedPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await refusedCtx.setOffline(true);
  const refusedFallback = await refusedPage.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  const refusedBody = await refusedPage.locator("body").textContent();
  await refusedCtx.setOffline(false);
  const refusedRecovered = await refusedPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  check(
    "offline E2E-012 sem cache e storage recusado degradam honestamente e recuperam online",
    freshOfflineFailed
      && !privateMarkers.some((marker) => freshOfflineBody?.includes(marker))
      && recovered?.status() === 200
      && refusedFallback?.status() === 503
      && refusedBody === "Offline."
      && refusedRecovered?.status() === 200,
    JSON.stringify({ freshOfflineFailed, freshOfflineBody, refusedStatus: refusedFallback?.status(), refusedBody }),
  );
  await freshCtx.close();
  await refusedCtx.close();

  await pwaCtx.close();

  check(
    "E2E-025 locales e timezones não geram hydration, key, fetch ou console errors",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(" | "),
  );
} catch (error) {
  // Um passo que estoura não pode apagar o relatório do que já passou: sem
  // isto, a suíte inteira vira um stack trace e some a informação de onde
  // exatamente parou.
  const diagnostic = error instanceof Error ? error.stack ?? error.message : String(error);
  check("suíte concluiu sem exceção", false, diagnostic.replace(/\s+/g, " ").slice(0, 600));
} finally {
  await browser.close();

  // Remove every job this browser flow created, but only when both identity
  // fields still match the exact fixture recorded at creation time. This also
  // keeps deliberate external runs from accumulating test data.
  if (createdJobFixtures.size > 0) {
    const [{ eq, inArray }, { closeDb, getDb }, { job }] = await Promise.all([
      import("drizzle-orm"),
      import("../../src/core/db/client.ts"),
      import("../../src/core/db/schema.ts"),
    ]);
    const fixtures = await getDb()
      .select({ id: job.id, title: job.title, companyName: job.companyName })
      .from(job)
      .where(inArray(job.id, [...createdJobFixtures.keys()]));
    for (const fixture of fixtures) {
      const expected = createdJobFixtures.get(fixture.id);
      if (expected?.title === fixture.title && expected.companyName === fixture.companyName) {
        await getDb().delete(job).where(eq(job.id, fixture.id));
      }
    }
    const remaining = await getDb()
      .select({ id: job.id, title: job.title, companyName: job.companyName })
      .from(job)
      .where(inArray(job.id, [...createdJobFixtures.keys()]));
    const leaked = remaining.filter((fixture) => {
      const expected = createdJobFixtures.get(fixture.id);
      return expected?.title === fixture.title && expected.companyName === fixture.companyName;
    });
    check(
      "task-04 E2E-004 cleanup remove todos os jobs criados pela suíte",
      leaked.length === 0,
      JSON.stringify(leaked),
    );
    closeDb();
  }
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed > 0 ? 1 : 0);
