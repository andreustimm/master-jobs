import { termOverview, trackOverview } from "../../src/contexts/matching/index.ts";

/**
 * As duas visões da tela de Buscas, na ordem em que podem acontecer.
 *
 * Em série, e não em `Promise.all`: cada uma já pica em duas consultas
 * simultâneas — `ownEvidence` dentro de `trackOverview` e o par de
 * `termOverview` —, então rodá-las juntas somava quatro contra um pool de três
 * conexões (`max: 3` em `src/core/db/client.ts`). O teto é `POOL - 1`, porque a
 * instância serverless é reaproveitada e a requisição do lado também precisa de
 * conexão.
 *
 * Foi o caso mais fácil de perder: as duas funções foram corrigidas uma a uma
 * para caber em duas, e a única página que usa as duas as somava em paralelo.
 * Teto por leitura não é teto por requisição.
 *
 * Mora fora do componente para o teste poder medir o caminho de verdade:
 * `tests/db-fan-out.test.ts` conta o pico de consultas em voo.
 */
export async function loadSearchesScreen(candidateId: number, now: Date) {
  const tracks = await trackOverview(candidateId);
  const terms = await termOverview({ candidateId }, now);
  return { tracks, terms };
}
