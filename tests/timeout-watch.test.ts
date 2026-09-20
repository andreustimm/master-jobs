/**
 * O travamento precisa deixar rastro antes de a plataforma matar o processo.
 *
 * `FUNCTION_INVOCATION_TIMEOUT` encerra a função aos 30 segundos: o código não
 * lança, nada é reportado, e o Sentry fica limpo enquanto a tela está quebrada.
 * Foi exatamente o que aconteceu com `/candidate/skills`.
 *
 * O relógio entra injetado porque aqui o tempo é a decisão, e um teste que
 * esperasse 22 segundos de verdade seria pior que nenhum.
 */
import { describe, expect, it } from "vitest";
import { warnIfSlower, type TimeoutWatchReport } from "../src/core/observability.ts";

/** Um relógio de mentira: o teste decide quando o prazo vence. */
function relogioDeMentira() {
  const pendentes: Array<{ fn: () => void; ms: number; vivo: boolean }> = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const entrada = { fn, ms, vivo: true };
      pendentes.push(entrada);
      return entrada;
    },
    clearTimer: (handle: unknown) => {
      (handle as { vivo: boolean }).vivo = false;
    },
    vencer: () => {
      for (const entrada of pendentes) if (entrada.vivo) entrada.fn();
    },
    limite: () => pendentes[0]?.ms ?? null,
  };
}

describe("aviso antes do limite da função", () => {
  it("UT-106 trabalho rápido não gera aviso, e o relógio é desarmado", async () => {
    const relogio = relogioDeMentira();
    const avisos: TimeoutWatchReport[] = [];

    const valor = await warnIfSlower("/candidate/skills", 22_000, async () => "pronto", {
      report: (r) => avisos.push(r),
      ...relogio,
    });

    expect(valor).toBe("pronto");
    // Vencer depois do fim não pode falar: o prazo já foi desarmado.
    relogio.vencer();
    expect(avisos).toEqual([]);
  });

  it("UT-107 trabalho que passa do prazo avisa, nomeando a rota", async () => {
    const relogio = relogioDeMentira();
    const avisos: TimeoutWatchReport[] = [];
    let terminar: (valor: string) => void = () => {};
    const trabalho = new Promise<string>((resolve) => { terminar = resolve; });

    const execucao = warnIfSlower("/candidate/skills", 22_000, () => trabalho, {
      report: (r) => avisos.push(r),
      ...relogio,
    });

    relogio.vencer();
    expect(avisos).toEqual([{ route: "/candidate/skills", elapsedMs: 22_000 }]);
    expect(relogio.limite()).toBe(22_000);

    terminar("enfim");
    // O aviso não interrompe nem altera o que o trabalho devolve.
    await expect(execucao).resolves.toBe("enfim");
  });

  it("UT-108 o aviso leva o caminho e deixa a query string para trás", async () => {
    const relogio = relogioDeMentira();
    const avisos: TimeoutWatchReport[] = [];

    const execucao = warnIfSlower("/jobs?q=laravel&pay=9000", 1_000, () => new Promise(() => {}), {
      report: (r) => avisos.push(r),
      ...relogio,
    });
    relogio.vencer();

    // Mesma peneira do relato de erro: o caminho responde "onde travou" e é
    // preciso para reproduzir; a query responde "o que a pessoa procurava",
    // que é comportamento de uso e não diagnóstico.
    expect(avisos[0]!.route).toBe("/jobs");
    void execucao;
  });

  it("UT-109 relator que estoura não vira um segundo defeito por cima do primeiro", async () => {
    const relogio = relogioDeMentira();

    const execucao = warnIfSlower("/searches", 1_000, async () => "ok", {
      report: () => { throw new Error("o relator caiu"); },
      ...relogio,
    });
    relogio.vencer();

    await expect(execucao).resolves.toBe("ok");
  });

  it("UT-110 erro do trabalho continua sendo o erro do trabalho", async () => {
    const relogio = relogioDeMentira();
    const avisos: TimeoutWatchReport[] = [];

    await expect(
      warnIfSlower("/searches", 1_000, async () => { throw new Error("falhou de verdade"); }, {
        report: (r) => avisos.push(r),
        ...relogio,
      }),
    ).rejects.toThrow("falhou de verdade");

    // E o prazo foi desarmado mesmo com a falha.
    relogio.vencer();
    expect(avisos).toEqual([]);
  });
});
