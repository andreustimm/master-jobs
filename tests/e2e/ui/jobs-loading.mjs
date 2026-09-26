// Área `jobs-loading` do E2E de navegador: Carregamento da tela Vagas.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkJobsLoading } from "../jobs-loading.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check } = ctx;
  await checkJobsLoading(browser, BASE, { email: "e2e-candidato@local.test", password: E2E_PASSWORD }, check);
}
