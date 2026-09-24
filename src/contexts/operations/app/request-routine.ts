import { parseRoutine } from "../domain/routine.ts";
import type { DispatchResult, WorkflowDispatchPort } from "../ports.ts";

export type RequestRoutineResult = DispatchResult | { ok: false; code: "routine_unknown" };

/**
 * Pede uma rotina de manutenção a quem executa.
 *
 * Orquestração burra, de propósito: valida o nome e entrega. Não decide se pode
 * — isso é `guard()` na Server Action, antes de qualquer efeito (regra 15) — e
 * não espera o resultado da rotina, que leva minutos.
 */
export async function requestRoutine(
  input: { routine: unknown },
  deps: { runner: WorkflowDispatchPort },
): Promise<RequestRoutineResult> {
  const parsed = parseRoutine(input.routine);
  if (!parsed.ok) return parsed;
  return deps.runner.dispatch({ routine: parsed.routine });
}
