// Área `job-analysis` do E2E de navegador: Leitura qualitativa da vaga.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkJobAnalysis } from "../job-analysis.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check } = ctx;
  await checkJobAnalysis(browser, BASE, {
    candidate: { email: "e2e-candidato@local.test", password: E2E_PASSWORD },
    admin: { email: E2E_EMAIL, password: E2E_PASSWORD },
  }, check);
}
