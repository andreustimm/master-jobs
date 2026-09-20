import { candidateSkills, skillDemand } from "../../../src/contexts/skills/index.ts";

/**
 * As duas leituras da tela de skills, na ordem em que podem acontecer.
 *
 * Em série, e não em `Promise.all`: `skillDemand` já dispara três consultas ao
 * mesmo tempo, e o cliente do banco abre no máximo três conexões (`max: 3` em
 * `src/core/db/client.ts`). Uma quarta consulta simultânea espera conexão, e em
 * produção essa espera não terminava — a tela morria nos 30s da função da
 * Vercel. Paralelizar aqui rendia milissegundos.
 *
 * Mora fora do componente para o teste poder medir o caminho de verdade:
 * `tests/db-fan-out.test.ts` conta o pico de consultas em voo.
 */
export async function loadSkillsScreen(candidateId: number) {
  const mine = await candidateSkills(candidateId);
  const demand = await skillDemand({ minFit: 60, candidateId });
  return { mine, demand };
}
