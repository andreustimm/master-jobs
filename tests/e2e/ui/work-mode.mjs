// Área `work-mode` do E2E de navegador: Modo de trabalho na tela Vagas.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkWorkModes } from "../work-mode.mjs";

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  await page.setViewportSize({ width: 1280, height: 900 });
  await checkWorkModes(page, BASE, check);
}
