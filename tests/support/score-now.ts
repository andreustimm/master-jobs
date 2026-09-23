/**
 * A forma antiga `scoreJob(input, profile, fx)`, para os testes que a usavam.
 *
 * O scorer lia `Date.now()` sozinho nessa forma, e por isso deixou de aceitá-la:
 * o instante agora é entrada explícita (`ScoringContext.asOf`). Os testes que
 * não dependem de data continuam escritos como antes, e o relógio fica aqui, na
 * composição do teste — onde ler o relógio é decisão de quem compõe, e não do
 * domínio.
 */
import type { FxTable } from "../../src/core/money.ts";
import type { Profile } from "../../src/core/profile/schema.ts";
import { scoreJob as scoreWithContext, type ScoreInput, type ScoreResult } from "../../src/core/scoring/score.ts";

export function scoreJob(input: ScoreInput, profile: Profile, fx: FxTable | null = null): ScoreResult {
  return scoreWithContext(input, { profile, fx, asOf: Date.now() });
}
