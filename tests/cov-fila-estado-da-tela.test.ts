/**
 * Os seis estados que `scoreQueueDisplay` pode mostrar, e a ordem entre eles.
 *
 * É uma função pura que reduz o snapshot da fila ao rótulo que o cartão exibe, e
 * a ORDEM das perguntas é o contrato: um snapshot pode satisfazer duas ao mesmo
 * tempo, e quem pergunta primeiro decide o que a pessoa lê.
 *
 * Falha antes de progresso, progresso antes de espera, espera antes de concluído.
 * Trocar duas dessas linhas não quebra teste nenhum e mostra "concluído" sobre
 * uma repontuação que falhou — a pessoa então acredita que o acervo está
 * ranqueado com o currículo novo, e decide sobre números velhos.
 *
 * `hasCv` separa "não há o que pontuar" de "nada a fazer agora": sem currículo, o
 * cartão precisa convidar a enviar um, e não dizer que está tudo em ordem.
 */
import { describe, expect, it } from "vitest";
import { scoreQueueDisplay, type ScoreQueueSnapshot } from "../src/core/scoring/queue.ts";

/** Um snapshot vazio, para variar UM contador por caso. */
function snapshot(overrides: Partial<ScoreQueueSnapshot> = {}): ScoreQueueSnapshot {
  return {
    pending: 0,
    scoring: 0,
    done: 0,
    failed: 0,
    scored: null,
    lastError: null,
    ...overrides,
  } as ScoreQueueSnapshot;
}

describe("sem snapshot nenhum", () => {
  it("UT-400 com currículo é `idle`; sem currículo é `noCv`", () => {
    // Os dois lados do mesmo ternário. `noCv` é o convite a enviar o currículo, e
    // mostrar `idle` ali diria que está tudo certo quando não há nada pontuável.
    expect(scoreQueueDisplay(null, true)).toEqual({ state: "idle", scored: null });
    expect(scoreQueueDisplay(null, false)).toEqual({ state: "noCv", scored: null });
    // O padrão é ter currículo: a tela que não sabe não deve acusar ausência.
    expect(scoreQueueDisplay(null)).toEqual({ state: "idle", scored: null });
  });
});

describe("a ordem das perguntas", () => {
  it("UT-401 falha vence progresso, espera e concluído", () => {
    // Um snapshot com falha E trabalho andando é real: uma tarefa falhou, outra
    // foi reenfileirada. Mostrar "pontuando" esconderia a falha até ela sumir.
    const comTudo = snapshot({ failed: 1, scoring: 2, pending: 3, done: 4, scored: 10 });

    expect(scoreQueueDisplay(comTudo)).toEqual({ state: "failed", scored: 10 });
  });

  it("UT-402 concluído COM erro registrado também é falha", () => {
    // O segundo caminho para `failed`: nenhuma tarefa marcada como falha, mas a
    // última concluída deixou erro. É o estado de uma tarefa que terminou mal e
    // foi contada como feita.
    const concluidoComErro = snapshot({ done: 1, lastError: "conexão perdida", scored: 7 });

    expect(scoreQueueDisplay(concluidoComErro)).toEqual({ state: "failed", scored: 7 });

    // E sem o erro, o mesmo snapshot é `done`: é o par que prova que o segundo
    // termo da condição é lido.
    expect(scoreQueueDisplay(snapshot({ done: 1, scored: 7 }))).toEqual({
      state: "done",
      scored: 7,
    });
  });

  it("UT-403 progresso vence espera e concluído", () => {
    const pontuando = snapshot({ scoring: 1, pending: 5, done: 2, scored: 3 });

    expect(scoreQueueDisplay(pontuando)).toEqual({ state: "scoring", scored: 3 });
  });

  it("UT-404 espera vence concluído", () => {
    // O ramo que faltava. Fila com trabalho na frente e trabalho já feito mostra
    // "na fila": dizer "concluído" faria a pessoa parar de esperar.
    const esperando = snapshot({ pending: 2, done: 9, scored: 42 });

    expect(scoreQueueDisplay(esperando)).toEqual({ state: "pending", scored: 42 });
  });

  it("UT-405 só concluído é `done`, e ele carrega o número pontuado", () => {
    const concluido = snapshot({ done: 3, scored: 1_234 });

    expect(scoreQueueDisplay(concluido)).toEqual({ state: "done", scored: 1_234 });
  });

  it("UT-406 snapshot com todos os contadores em zero volta a `idle`, sem número", () => {
    // O fim da linha: nada pendente, nada feito. O `scored` é descartado de
    // propósito — um número sem estado que o explique é pior que nenhum.
    expect(scoreQueueDisplay(snapshot({ scored: 99 }))).toEqual({ state: "idle", scored: null });
  });
});

describe("a cadeia completa, na ordem que a pessoa vê", () => {
  it("UT-407 cada estado sucede o anterior sem repetir rótulo", () => {
    // A sequência de uma repontuação que dá certo. Dois estados consecutivos com
    // o mesmo rótulo significam que a tela parou de informar.
    const cadeia = [
      scoreQueueDisplay(null, false).state,
      scoreQueueDisplay(snapshot({ pending: 1 })).state,
      scoreQueueDisplay(snapshot({ scoring: 1 })).state,
      scoreQueueDisplay(snapshot({ done: 1, scored: 100 })).state,
      scoreQueueDisplay(snapshot()).state,
    ];

    expect(cadeia).toEqual(["noCv", "pending", "scoring", "done", "idle"]);
  });
});
