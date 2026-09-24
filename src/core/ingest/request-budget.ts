/**
 * Orçamento diário de requisições a terceiros, por rotina (#291).
 *
 * Três rotinas saem para a internet por conta própria: a sincronização (APIs
 * de quadro), a reconferência (o link da vaga ainda responde?) e a captura (a
 * página da vaga). Cada uma tem mais de um disparador — a CLI no GitHub
 * Actions, a fatia da Vercel (ADR 0025), o botão da tela — e nenhum sabe do
 * outro. Sem um contador comum, dois agendadores dobravam as requisições sem
 * que ninguém visse (B-11). O contador é um só, no banco, e o teto vale para a
 * soma de todos.
 *
 * Este arquivo é puro: tetos e o dia da janela. A reserva atômica mora em
 * `request-budget-store.ts`.
 */

export const REQUEST_ROUTINES = ["sync", "reconferencia", "captura"] as const;

export type RequestRoutine = (typeof REQUEST_ROUTINES)[number];

/**
 * Teto diário por rotina; `null` = só conta.
 *
 * - `reconferencia`: a fatia roda 6×/h com ~16 sondagens por chamada (~2.300
 *   por dia); a folga cobre a CLI e o botão. Com a reconferência de fonte
 *   parcial abaixo da nota 55, é este teto que segura o volume.
 * - `captura`: 6×/h com 4 páginas (~580 por dia), mais a CLI.
 * - `sync`: já limitado a uma busca por fonte a cada 45 min pela varredura e
 *   pela cota por plataforma (ADR 0025, ADR-010); aqui só entra na conta.
 *
 * A unidade é o trabalho que sai para o terceiro — uma sondagem, uma página,
 * uma busca de fonte —, não o pacote HTTP: uma fonte paginada conta uma vez.
 */
export const DAILY_REQUEST_BUDGET: Readonly<Record<RequestRoutine, number | null>> = {
  sync: null,
  reconferencia: 3_000,
  captura: 1_000,
};

/** O dia UTC do instante, como as cotas de plataforma (ADR-010). */
export function budgetDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Reserva e devolução de uma unidade. O adapter é SQL; o teste, um `Map`.
 *
 * `take` é atômico entre processos: com o teto a um passo, uma chamada vence.
 * `giveBack` devolve a reserva que não virou requisição (a fila estava vazia).
 */
export type RequestBudget = {
  take(routine: RequestRoutine, now: number): Promise<boolean>;
  giveBack(routine: RequestRoutine, now: number): Promise<void>;
};
