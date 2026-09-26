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
 * already-running environment deliberately, set E2E_BASE, DATABASE_URL and
 * DATABASE_MIGRATION_URL, then run `pnpm test:e2e:external`.
 *
 * Este arquivo monta o navegador, a sessão e o relatório; as verificações moram
 * nas áreas de `./ui/`, uma por arquivo, na ordem de `./ui/index.mjs` (#320).
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { TASK04_FIXTURES } from "./task04-fixtures.mjs";
import { selectAreas } from "./ui/index.mjs";

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
// The brand entrance animation is sampled while the overlay is attached; its
// transform can move the visible union a few pixels before settling.
const TRANSITION_CENTER_TOLERANCE_PX = 8;
const results = [];
let failed = 0;
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

/**
 * Navigates for a sweep and confirms the page measured is the page requested.
 *
 * Uma sessão que caiu no meio da suíte manda toda rota privada para `/login`,
 * e a varredura media o login — que não tem estouro nem português — no lugar
 * da tela pedida, e aprovava. Destino diferente ou resposta não-2xx vira
 * falha nomeada em `failures`, e quem chama pula a medição.
 */
async function gotoMeasured(target, path, failures, prefix = "") {
  const response = await target.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const wanted = new URL(path, BASE).pathname;
  const landed = new URL(target.url()).pathname;
  if (response?.ok() && landed === wanted) return true;
  failures.push(`${prefix}${path}: mediu ${landed} (HTTP ${response?.status() ?? "sem resposta"})`);
  return false;
}

// `E2E_AREAS` vazio roda a suíte inteira, na ordem de sempre. Com lista, roda
// a fumaça, as áreas pedidas e as que elas exigem, na mesma ordem. Área
// desconhecida recusa antes de abrir o navegador.
const areas = selectAreas(process.env.E2E_AREAS);
console.log(`áreas do E2E: ${areas.map((area) => area.id).join(", ")}`);

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
  // The route is what makes a minified React error actionable.
  targetPage.on("pageerror", (error) =>
    consoleErrors.push(`pageerror ${new URL(targetPage.url()).pathname}: ${String(error).slice(0, 200)}`),
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

/**
 * O que cada área recebe. `state` leva o que uma área produz e outra consome
 * (a sessão do dono, a vaga comparada, a visibilidade encontrada); quem
 * consome declara `requires` em `./ui/index.mjs`.
 */
const ctx = {
  BASE,
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_RESET_EXPIRED_TOKEN,
  E2E_RESET_CONSUMED_TOKEN,
  E2E_RESET_RACE_TOKEN,
  E2E_LOGIN_EXPIRED_TOKEN,
  E2E_LOGIN_RACE_TOKEN,
  E2E_CLOSED_JOB_ID,
  E2E_DELETED_JOB_ID,
  PACKAGE_VERSION,
  TRANSITION_CENTER_TOLERANCE_PX,
  browser,
  page,
  check,
  gotoMeasured,
  trackConsole,
  openChangelog,
  readModalSpacing,
  changelogSnapshot,
  rememberCreatedJob,
  consoleErrors,
  changelogRoleSnapshots,
  state: {},
};

try {
  for (const area of areas) await area.run(ctx);

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
