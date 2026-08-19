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
 *   pnpm dev            # noutro terminal
 *   pnpm test:e2e
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

try {
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
  check("h1 segue display-md da spec (32px / 500)", typography.h1?.size === "32px" && typography.h1?.weight === "500", JSON.stringify(typography.h1));

  /* -------------------------------- Tooltips ------------------------------- */

  const triggers = page.locator('[data-slot="tooltip-trigger"]');
  const total = await triggers.count();
  check("chips de filtro presentes", total > 0, `${total}`);

  let opened = 0;
  for (let i = 0; i < total; i++) {
    await triggers.nth(i).hover();
    await page.waitForTimeout(350);
    const visible = await page
      .locator('[data-slot="tooltip-content"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) opened++;
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
  }
  check("todo chip abre seu tooltip no hover", opened === total && total > 0, `${opened}/${total}`);

  /* ------------------------------ Outras telas ----------------------------- */

  for (const path of ["/", "/candidate", "/pipeline", "/referrals", "/login"]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${path} responde`, response?.status() === 200, String(response?.status()));
  }

  // Overflow horizontal é a falha de mobile que passa despercebida no desktop.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("sem rolagem horizontal em 375px", overflow <= 1, `${overflow}px`);

  check("nenhum erro de console", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed > 0 ? 1 : 0);
