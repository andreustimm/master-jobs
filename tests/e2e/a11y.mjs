/**
 * Axe runs inside the existing hermetic E2E environment. Keeping it here avoids
 * a second server, database and authentication path that could drift from the
 * browser suite it is meant to protect.
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const failures = [];

async function scan(name, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const finalPath = new URL(page.url()).pathname;

  if (!response?.ok() || finalPath !== path) {
    failures.push({
      name,
      path,
      navigation: { status: response?.status() ?? null, finalPath },
    });
    console.error(
      `FAIL ${name} (${path}): navigation returned ${response?.status() ?? "no response"} at ${finalPath}`,
    );
    return;
  }

  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (result.violations.length === 0) {
    console.log(`✓ a11y ${name}`);
    return;
  }

  const detail = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target).slice(0, 8),
  }));
  failures.push({ name, path, violations: detail });
  console.error(`✗ a11y ${name} — ${JSON.stringify(detail)}`);
}

try {
  await scan("login", "/login");

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  for (const [name, path] of [
    ["jobs", "/jobs"],
    ["pipeline", "/pipeline"],
    ["candidate", "/candidate"],
    ["candidate skills", "/candidate/skills"],
    ["candidate vocabulary", "/candidate/vocabulary"],
    ["referrals", "/referrals"],
    ["admin users", "/admin/users"],
    ["account", "/account"],
    // Ver o comentário em `ui.mjs`: rota nova não herda guarda transversal.
    ["job countries hub", "/jobs/904000101/paises"],
    // A tela mais aberta do produto, e estava fora das quatro listas — foi assim
    // que ela serviu três rótulos em português com a interface em inglês. A
    // varredura roda como dono, que vê o formulário de funil; a medição que
    // precedeu a entrada foi como recrutador e não via o `select` sem nome.
    ["job detail", "/jobs/904000103"],
  ]) {
    await scan(name, path);
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} página(s) com violações axe WCAG 2.2 AA`);
  process.exit(1);
}

console.log("\n11/11 páginas sem violações axe WCAG 2.2 AA");
