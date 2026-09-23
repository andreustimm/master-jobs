/**
 * Facetas da tela Vagas com cache local, no processo (#216).
 *
 * As facetas dependem só do escopo da sessão e dos filtros que elas recebem —
 * não de página, tamanho, ordenação, densidade, faixa salarial nem empresa.
 * Paginar ou reordenar refazia a consulta mais cara da tela (3,5 s numa
 * requisição de produção medida em 22/09/2026) para devolver os mesmos números.
 *
 * Sem Redis, sem `cacheComponents` (decisões em
 * `docs/engineering/performance-buscas.md`): um mapa no processo, com validade
 * e teto de entradas. A regra — chave, validade, despejo — é pura e mora em
 * `domain/facet-cache.ts`; aqui só a composição com o banco e o relógio.
 */
import { clock } from "../../../core/clock.ts";
import { boardFacets, type BoardFilters } from "../../../core/db/repo.ts";
import { SCORER_VERSION } from "../../../core/scoring/score.ts";
import { createTtlLru, facetCacheKey, type TtlLru } from "../domain/facet-cache.ts";

/** Os filtros que as facetas leem. Qualquer campo passado entra na chave. */
export type FacetQuery = Pick<
  BoardFilters,
  "minFit" | "keepUnscored" | "cluster" | "term" | "query" | "sourceKinds" | "workMode" | "track" | "groupRepeats"
>;

export type BoardFacets = Awaited<ReturnType<typeof boardFacets>>;

/**
 * Validade de uma entrada: 60 s.
 *
 * É o único limite para o que muda FORA deste processo — o sync, o score e a
 * raspagem rodam pela CLI e por workers, e outra instância da função não
 * enxerga a invalidação feita aqui. Um minuto cobre a rajada de paginar e
 * reordenar e deixa os chips no máximo um minuto atrás de uma mudança externa;
 * a lista e o total do rodapé nunca passam pelo cache.
 */
export const FACET_CACHE_TTL_MS = 60_000;

/**
 * Teto de entradas. Uma entrada são nove números e duas listas curtas (menos de
 * 1 KB); 200 delas ficam abaixo de 200 KB na memória da função, e cobrem com
 * folga as combinações que uma pessoa percorre em um minuto.
 */
export const FACET_CACHE_MAX_ENTRIES = 200;

type Cached = { candidateId: number | null; facets: Promise<BoardFacets> };

/**
 * Um mapa por PROCESSO, não por módulo. O Next compila as Server Actions
 * importadas por componentes de cliente numa camada própria do bundle, com a
 * sua cópia deste módulo: um `const` de módulo daria à ação de triagem um mapa
 * e à página outro, e a invalidação limparia o mapa que ninguém lê.
 */
const CACHE_SLOT = Symbol.for("master-jobs.matching.board-facets-cache");
const slots = globalThis as typeof globalThis & { [CACHE_SLOT]?: TtlLru<Cached> };
const cache = (slots[CACHE_SLOT] ??= createTtlLru<Cached>({
  ttlMs: FACET_CACHE_TTL_MS,
  maxEntries: FACET_CACHE_MAX_ENTRIES,
}));

/**
 * As mesmas facetas de `boardFacets`, reaproveitadas por até `FACET_CACHE_TTL_MS`.
 *
 * A entrada é reservada ANTES do `await`: duas requisições iguais ao mesmo
 * tempo (a página e o prefetch do roteador) esperam a mesma consulta em vez de
 * abrir duas. Uma consulta que falha sai do cache, para a próxima tentar de
 * novo em vez de repetir o erro por um minuto.
 */
export async function cachedBoardFacets(candidateId: number | null, query: FacetQuery): Promise<BoardFacets> {
  const key = facetCacheKey(candidateId, query, SCORER_VERSION);
  const now = clock().now();
  let entry = cache.get(key, now);
  if (!entry) {
    const created: Cached = { candidateId, facets: boardFacets(candidateId, query) };
    entry = created;
    cache.set(key, created, now);
    // Por identidade, não pela chave: depois de uma invalidação a mesma chave
    // pode já guardar uma leitura nova e sadia, que não deve sair junto.
    created.facets.catch(() => cache.deleteWhere((value) => value === created));
  }
  const facets = await entry.facets;
  // Cópia: quem recebe pode ordenar ou alterar as listas, e a entrada é
  // compartilhada com a próxima requisição.
  return { ...facets, clusters: [...facets.clusters], sources: [...facets.sources] };
}

/**
 * Descarta as facetas guardadas — de um candidato, ou todas.
 *
 * Chamada pelas ações do aplicativo que mudam as contagens: triagem e funil
 * (só as do candidato; o acervo sem escopo não lê candidatura) e vaga nova
 * (todas). Vale só para esta instância; as outras esperam a validade.
 */
export function invalidateBoardFacets(candidateId?: number): void {
  if (candidateId === undefined) cache.clear();
  else cache.deleteWhere((value) => value.candidateId === candidateId);
}
