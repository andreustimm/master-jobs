// Área `search-synonyms` do E2E de navegador: sinônimos bilíngues da busca (#370).
// A lógica e o contexto compartilhado moram em ../search-synonyms.mjs e ./index.mjs.
import { checkSearchSynonyms } from "../search-synonyms.mjs";

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  await checkSearchSynonyms(page, BASE, check);
}
