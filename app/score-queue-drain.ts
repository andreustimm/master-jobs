import { after } from "next/server";
import { runScoreSlice } from "../src/core/scoring/queue.ts";

/**
 * Roda uma fatia da fila de repontuação depois da resposta.
 *
 * Quem acabou de salvar o currículo não espera o acervo ser pontuado, mas
 * também não espera a varredura do dia seguinte: a fatia começa assim que a
 * tela responde, dentro do teto da função (`SCORE_SLICE_MS`). O que não couber
 * fica na fila para a rota por segredo que o agendador chama.
 *
 * Só as entradas de currículo agendam: editar trilha continua enfileirando e
 * esperando o consumidor da fila, porque a tela da trilha foi desenhada para
 * mostrar "recalculando, notas anteriores" enquanto isso.
 *
 * Chame DEPOIS do guard e do efeito que enfileirou: `after()` é efeito, e a
 * ação que o agenda antes de conferir a sessão trabalha para quem não provou
 * ser ninguém.
 */
export function scoreAfterResponse(): void {
  after(async () => {
    await runScoreSlice("web");
  });
}
