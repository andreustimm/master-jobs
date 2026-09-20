/**
 * Contexto de operações: pedir manutenção sem esperar por ela.
 *
 * A pergunta que ele responde é do administrador: "buscar vagas novas agora,
 * conferir se expiraram, repontuar". O trabalho leva minutos e não cabe numa
 * função de 30 segundos, então a tela **pede** e quem executa é outro processo.
 *
 * Composição por função, sem container (regra 4).
 */
import { requestRoutine as requestRoutineUseCase, type RequestRoutineResult } from "./app/request-routine.ts";
import { githubDispatch } from "./infra/github-dispatch.ts";

export { ROUTINES, ROUTINE_LABEL_KEYS, isRoutine, parseRoutine, type Routine } from "./domain/routine.ts";
export type { DispatchResult, WorkflowDispatchPort } from "./ports.ts";
export { githubDispatch } from "./infra/github-dispatch.ts";
export type { RequestRoutineResult } from "./app/request-routine.ts";

const runner = githubDispatch();

/** O caso de uso ligado, para a aplicação. */
export function requestRoutine(routine: unknown): Promise<RequestRoutineResult> {
  return requestRoutineUseCase({ routine }, { runner });
}

/** Se há credencial para pedir na hora. Sem ela, resta a cron diária. */
export function routineRequestConfigured(): boolean {
  return runner.configured();
}
