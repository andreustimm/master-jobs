import {
  cachedBoardFacets,
  clusterBreakdown,
  corpusStats,
  countBoard,
  listBoard,
  type BoardFilters,
} from "../src/contexts/matching/index.ts";
import { pipelineCounts } from "../src/contexts/pursuit/index.ts";
import type { FilterState } from "./filter-state.ts";

/**
 * As leituras do cockpit, na ordem em que podem acontecer.
 *
 * Em pares, e não num `Promise.all` de cinco: o pool abre três conexões
 * (`max: 3` em `src/core/db/client.ts`) e o teto é `POOL - 1`, porque a
 * instância serverless é reaproveitada e a requisição do lado também precisa de
 * conexão. As cinco juntas pediam sete consultas simultâneas — nesta que é a
 * rota que a PWA abre (`start_url` é "/") e onde o candidato cai depois do
 * login. É o mesmo esgotamento que fazia `/candidate/skills` responder 200
 * sozinha e 504 quando pedida duas vezes.
 *
 * Mora fora do componente para o teste poder medir o caminho de verdade:
 * `tests/db-fan-out.test.ts` conta o pico de consultas em voo. Composição no
 * corpo do Server Component é invisível para aquela régua — foi assim que esta
 * tela e a de `/jobs` ficaram fora dela.
 */
export async function loadCockpit(
  candidateId: number,
  state: FilterState,
  filters: BoardFilters,
) {
  const [stats, counts] = await Promise.all([
    corpusStats(candidateId),
    pipelineCounts(candidateId),
  ]);
  // A contagem do título vem de `countBoard`, com o conjunto COMPLETO de
  // filtros — não de `facets.total`.
  //
  // As facetas anulam cada dimensão na própria contagem de propósito (escolher
  // uma fonte não pode deixar só ela para escolher), e por isso `facets.total`
  // responde outra pergunta. O cockpit renderiza o campo de empresa, a faixa de
  // Score e o "ainda não enviadas" sem depender de `extras`, então mostrava o
  // total sem filtro sobre uma lista que o filtro já havia cortado — e, com
  // agrupamento ligado por omissão, os dois números já divergiam sem ninguém
  // tocar em nada. `/jobs` sempre tirou o número daqui; a mesma pergunta não
  // pode ter duas respostas em duas telas.
  const [clusters, total] = await Promise.all([
    clusterBreakdown(candidateId, 45),
    countBoard(candidateId, filters),
  ]);
  const top = await listBoard(candidateId, { ...filters, limit: 12 });
  const facets = await cachedBoardFacets(candidateId, {
    minFit: state.fit,
    keepUnscored: filters.keepUnscored,
    cluster: state.cluster,
    term: state.term,
    sourceKinds: state.sources,
    workMode: state.workMode,
    groupRepeats: filters.groupRepeats,
  });
  return { stats, counts, clusters, total, top, facets };
}
