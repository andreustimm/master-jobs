// Área `logout` do E2E de navegador: Logout revoga a sessão no servidor.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  /* --------------------------------- Logout -------------------------------- */
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="sign-out"]').click();
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  // Revogado no servidor, não só apagado no navegador.
  check("logout encerra a sessão de verdade", page.url().includes("/login"), page.url());
}
