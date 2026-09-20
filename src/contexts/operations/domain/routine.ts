/**
 * As rotinas de manutenção que alguém pode pedir, e nada além delas.
 *
 * Função pura: sem banco, sem rede, sem relógio. A lista existe como dado
 * porque três superfícies precisam concordar sobre ela — a tela do
 * administrador, o `workflow_dispatch` do GitHub e o passo do workflow que
 * decide o que rodar. Um nome inventado em qualquer uma das três seria uma
 * execução silenciosamente vazia.
 */

export const ROUTINES = ["tudo", "sync", "termos", "recheck", "rescore"] as const;

export type Routine = (typeof ROUTINES)[number];

/** O que cada rotina faz, em chave de dicionário — texto nunca mora aqui (regra 9). */
export const ROUTINE_LABEL_KEYS = {
  tudo: "operations.routineAll",
  sync: "operations.routineSync",
  termos: "operations.routineTerms",
  recheck: "operations.routineRecheck",
  rescore: "operations.routineRescore",
} as const satisfies Record<Routine, string>;

export function isRoutine(value: unknown): value is Routine {
  return typeof value === "string" && (ROUTINES as readonly string[]).includes(value);
}

/**
 * A rotina pedida, ou o erro que a recusa.
 *
 * Recusa por omissão: nome fora da lista não vira "tudo" por conveniência —
 * rodar a varredura inteira porque o formulário mandou lixo é caro e é
 * surpresa.
 */
export function parseRoutine(value: unknown): { ok: true; routine: Routine } | { ok: false; code: "routine_unknown" } {
  return isRoutine(value) ? { ok: true, routine: value } : { ok: false, code: "routine_unknown" };
}
