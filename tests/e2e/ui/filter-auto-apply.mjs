// Área `filter-auto-apply` do E2E de navegador: Filtro aplicado sozinho.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkFilterAutoApply } from "../filter-auto-apply.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check } = ctx;
  await checkFilterAutoApply(browser, BASE, { email: "e2e-candidato@local.test", password: E2E_PASSWORD }, check);
}
