// Área `admin-catalog` do E2E de navegador: Catálogo de plataformas e execuções.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkAdminCatalog } from "../admin-catalog.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check } = ctx;
  await checkAdminCatalog(browser, BASE, {
    admin: { email: E2E_EMAIL, password: E2E_PASSWORD },
    candidate: { email: "e2e-candidato@local.test", password: E2E_PASSWORD },
    recruiter: { email: "e2e-recrutador@local.test", password: E2E_PASSWORD },
    impersonationTarget: "e2e-alvo@local.test",
  }, check);
}
