// Área `public-cv-format` do E2E de navegador: CV publicado formatado em /p/[slug] (#325).
// Trazida para as áreas no merge de dev (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkPublicCvFormat } from "../public-cv-format.mjs";

export async function run(ctx) {
  const { BASE, browser, check } = ctx;
  await checkPublicCvFormat(browser, BASE, check);
}
