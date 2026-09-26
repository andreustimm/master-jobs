// Área `search-relevance` do E2E de navegador: Relevância da busca.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { checkSearchRelevance } from "../search-relevance.mjs";

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  await checkSearchRelevance(page, BASE, check);
}
