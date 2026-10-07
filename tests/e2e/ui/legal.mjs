// Área `legal` do E2E de navegador: Termos de Uso e Política de Privacidade
// públicos, em português e inglês, sem sessão (#464, US-021, E2E-031).
import { ptBR, en } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, browser, check, trackConsole } = ctx;
  const { readLegal } = await import("../../../src/core/legal.ts");

  for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "jho_locale", value: locale, url: BASE }]);
    const page = await context.newPage();
    trackConsole(page);
    for (const kind of ["terms", "privacy"]) {
      const document = readLegal(kind, locale);
      const response = await page.goto(`${BASE}/${kind}`, { waitUntil: "networkidle" });
      const title = ((await page.locator('[data-testid="legal-title"]').textContent().catch(() => "")) ?? "").trim();
      const body = ((await page.locator('[data-testid="legal-body"]').textContent().catch(() => "")) ?? "").trim();
      const version = ((await page.locator('[data-testid="legal-version"]').textContent().catch(() => "")) ?? "").trim();
      const cookies = await context.cookies();
      check(
        `E2E-031 /${kind} em ${locale} abre sem sessão, com o título, a versão e o texto do documento`,
        response?.status() === 200
          && new URL(page.url()).pathname === `/${kind}`
          && title === document.title
          && version.startsWith(dictionary.legal.version.split("{")[0].trim())
          && body.includes("contato@mastertimm.com.br")
          && !cookies.some((cookie) => cookie.name === "jho_session"),
        JSON.stringify({ status: response?.status(), at: page.url().replace(BASE, ""), title, version }),
      );
    }
    // O cadastro aponta para os dois documentos.
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    const links = await page.locator('[data-testid="signup-form"] a').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
    check(
      `E2E-031 a tela de cadastro em ${locale} leva aos Termos e à Política`,
      links.includes("/terms") && links.includes("/privacy"),
      JSON.stringify(links),
    );
    await context.close();
  }
}
