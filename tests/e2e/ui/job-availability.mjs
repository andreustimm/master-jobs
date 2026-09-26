// Área `job-availability` do E2E de navegador: Disponibilidade da vaga.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkJobAvailability } from "../job-availability.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check } = ctx;
  await checkJobAvailability(browser, BASE, { email: "e2e-candidato@local.test", password: E2E_PASSWORD }, check);
}
