import { describe, expect, it } from "vitest";
import { runFetchStage } from "../src/core/scrape/fetcher.ts";
import type { ClaimedTask, QueuePort } from "../src/core/scrape/queue.ts";
import type { LookupHost } from "../src/core/remote-url.ts";
import type { RequestBudget } from "../src/core/ingest/request-budget.ts";

/**
 * O `--limit` do robô de captura, sob concorrência.
 *
 * O limite existe para rodar um lote pequeno e controlado contra sites de
 * terceiros. Ultrapassá-lo em silêncio é o oposto do que ele promete — e era o
 * que acontecia: `result.processed` só subia DEPOIS do `claim`, e entre a
 * checagem e o incremento havia um `await`. Com N workers, todos passavam pela
 * condição antes de qualquer um incrementar.
 */

/** Fila com tarefas de sobra, para o limite ser a única coisa que segura. */
function filaInfinita(): QueuePort & { claims: number } {
  const state = {
    claims: 0,
    async claim(): Promise<ClaimedTask | null> {
      state.claims++;
      // `await` de propósito: é o ponto onde o laço de eventos troca de worker,
      // e é a janela em que o defeito acontecia.
      await Promise.resolve();
      return { id: state.claims, jobId: state.claims, url: `https://x.test/${state.claims}`, attempts: 0 };
    },
    async complete() {},
    async fail() {},
    async stats() {
      return {};
    },
  };
  return state as QueuePort & { claims: number };
}

/**
 * Não toca a rede, e de propósito NÃO produz página guardável.
 *
 * O que se afirma aqui é a contagem, não a captura. Uma resposta 404 percorre o
 * mesmo caminho — `claim`, reserva, contabilização — sem gravar em `job_page`,
 * que exigiria uma vaga real no banco e traria uma chave estrangeira para o meio
 * de um teste sobre aritmética de concorrência.
 */
const fetcher = (async () =>
  new Response("não encontrada", { status: 404 })) as unknown as typeof fetch;

/** IP público literal: o teste não pode depender de DNS. */
const lookupHost: LookupHost = async () => [{ address: "93.184.216.34", family: 4 }];

/** Orçamento diário em memória: `teto` unidades, contando reservas e devoluções. */
function orcamento(teto = Number.POSITIVE_INFINITY): RequestBudget & { usadas: () => number } {
  let usadas = 0;
  return {
    async take() {
      await Promise.resolve();
      if (usadas >= teto) return false;
      usadas++;
      return true;
    },
    async giveBack() {
      usadas--;
    },
    usadas: () => usadas,
  };
}

describe("runFetchStage respeita o limite", () => {
  it("com concorrência 1, para exatamente no limite", async () => {
    const queue = filaInfinita();
    const result = await runFetchStage({ queue, fetcher, lookupHost, budget: orcamento(), concurrency: 1, limit: 3 });
    expect(result.processed).toBe(3);
  });

  it("com concorrência 8, NÃO ultrapassa o limite", async () => {
    // O caso do defeito: oito workers passando pela checagem antes de o
    // primeiro incrementar processavam até sete tarefas a mais.
    const queue = filaInfinita();
    const result = await runFetchStage({ queue, fetcher, lookupHost, budget: orcamento(), concurrency: 8, limit: 5 });
    expect(result.processed).toBe(5);
  });

  it("nem sequer RESERVA além do limite", async () => {
    // `processed` correto com `claim` a mais ainda seria trabalho extra contra
    // site de terceiro — a tarefa foi retirada da fila e capturada, só não
    // contada. O que se afirma aqui é que a reserva também para.
    const queue = filaInfinita();
    await runFetchStage({ queue, fetcher, lookupHost, budget: orcamento(), concurrency: 8, limit: 4 });
    expect(queue.claims).toBe(4);
  });

  it("fila vazia antes do limite não trava a execução seguinte", async () => {
    // A reserva é devolvida quando não há tarefa. Sem isso, um worker que não
    // achou nada consumiria um slot e o lote pararia antes do pedido.
    let restantes = 2;
    const queue: QueuePort = {
      async claim() {
        await Promise.resolve();
        if (restantes === 0) return null;
        restantes--;
        return { id: restantes, jobId: restantes, url: `https://x.test/${restantes}`, attempts: 0 };
      },
      async complete() {},
      async fail() {},
      async stats() {
        return {};
      },
    };

    const result = await runFetchStage({ queue, fetcher, lookupHost, budget: orcamento(), concurrency: 4, limit: 10 });
    expect(result.processed).toBe(2);
  });

  it("sem limite, processa tudo o que a fila tiver", async () => {
    let restantes = 7;
    const queue: QueuePort = {
      async claim() {
        await Promise.resolve();
        if (restantes === 0) return null;
        restantes--;
        return { id: restantes, jobId: restantes, url: `https://x.test/${restantes}`, attempts: 0 };
      },
      async complete() {},
      async fail() {},
      async stats() {
        return {};
      },
    };

    expect((await runFetchStage({ queue, fetcher, lookupHost, budget: orcamento(), concurrency: 3 })).processed).toBe(7);
  });
});

describe("runFetchStage respeita o orçamento diário (#291)", () => {
  it("orçamento esgotado para antes do claim: a tarefa fica na fila", async () => {
    const queue = filaInfinita();
    const budget = orcamento(3);
    const result = await runFetchStage({ queue, fetcher, lookupHost, budget, concurrency: 4 });
    expect(result.processed).toBe(3);
    expect(queue.claims).toBe(3);
    expect(result.budgetExhausted).toBe(true);
  });

  it("fila vazia devolve a unidade reservada", async () => {
    let restantes = 1;
    const queue: QueuePort = {
      async claim() {
        if (restantes === 0) return null;
        restantes--;
        return { id: 1, jobId: 1, url: "https://x.test/1", attempts: 0 };
      },
      async complete() {},
      async fail() {},
      async stats() {
        return {};
      },
    };
    const budget = orcamento(10);
    const result = await runFetchStage({ queue, fetcher, lookupHost, budget, concurrency: 2 });
    expect(result.processed).toBe(1);
    expect(budget.usadas()).toBe(1);
    expect(result.budgetExhausted).toBeUndefined();
  });
});
