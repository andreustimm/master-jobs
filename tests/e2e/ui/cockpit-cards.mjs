// Área `cockpit-cards` do E2E de navegador: cards clicáveis do cockpit (#314).
// Trazida para as áreas no merge de dev (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkCockpitCards } from "../cockpit-cards.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, page } = ctx;
  await page.setViewportSize({ width: 1280, height: 900 });
  await checkCockpitCards(browser, BASE, {
    owner: { email: E2E_EMAIL, password: E2E_PASSWORD },
    unscored: { email: "e2e-candidato@local.test", password: E2E_PASSWORD },
  }, check);
}
