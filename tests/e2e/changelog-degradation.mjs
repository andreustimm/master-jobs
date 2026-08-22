import { chromium } from "playwright";

const BASE = process.env.E2E_BASE;
const MODE = process.env.E2E_CHANGELOG_MODE;
const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";

if (!BASE || !["malformed", "empty", "missing"].includes(MODE)) {
  throw new Error("E2E_BASE and E2E_CHANGELOG_MODE are required");
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });

  const trigger = page.locator('[data-testid="changelog-open"]');
  if (MODE === "empty" || MODE === "missing") {
    if ((await trigger.count()) !== 0) throw new Error("empty changelog exposed a trigger");
    console.log(
      MODE === "missing"
        ? "✓ E2E-026 changelog ausente mantém a página e omite o gatilho"
        : "✓ E2E-026 empty changelog omite o gatilho",
    );
  } else {
    if ((await trigger.count()) !== 1) throw new Error("valid sibling did not preserve the trigger");
    await trigger.click();
    const dialog = page.locator('[data-testid="changelog-dialog"]');
    await dialog.waitFor({ state: "visible" });
    const releases = dialog.locator('[data-testid^="changelog-release-"]');
    if ((await releases.count()) !== 1 || !((await releases.first().textContent()) ?? "").includes("v1.0.0")) {
      throw new Error("malformed release was not isolated from its valid sibling");
    }
    console.log("✓ E2E-026 release malformada é isolada da válida");
  }
} finally {
  await browser.close();
}
