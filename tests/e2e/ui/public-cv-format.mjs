// Área `public-cv-format` do E2E de navegador: CV publicado formatado em /p/[slug] (#325),
// o layout de referência Jobicy sobre o mesmo candidato fixo (#326) e os fatos opt-in (#327).
// Trazida para as áreas no merge de dev (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkPublicCvFormat, checkPublicFacts, checkPublicProfileLayout } from "../public-cv-format.mjs";

export async function run(ctx) {
  const { BASE, browser, check } = ctx;
  await checkPublicCvFormat(browser, BASE, check);
  await checkPublicProfileLayout(browser, BASE, check);
  await checkPublicFacts(browser, BASE, check);
}
