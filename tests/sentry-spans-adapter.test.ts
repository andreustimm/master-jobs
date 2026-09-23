/**
 * O adapter que abre spans nos estágios já medidos.
 *
 * `rastrearEtapa` é o único ponto em que o cronômetro das telas toca o SDK. As
 * garantias que importam: sem DSN nada é carregado; o trabalho roda
 * exatamente uma vez, com ou sem SDK; e o nome do span é o nome do estágio —
 * texto do código, nunca filtro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStageTimer } from "../src/core/observability.ts";

const DSN_ORIGINAL = process.env.SENTRY_DSN;
const DSN = "https://exemplo@sentry.invalid/1";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (DSN_ORIGINAL === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = DSN_ORIGINAL;
  vi.doUnmock("@sentry/nextjs");
  vi.resetModules();
});

type Aberto = { name: string; op: string; attributes: Record<string, unknown> };

function sdkQueRegistra(abertos: Aberto[]) {
  return {
    startSpan: async (opcoes: Aberto, fn: () => Promise<unknown>) => {
      abertos.push(opcoes);
      return fn();
    },
    captureMessage: () => {},
  };
}

describe("rastrearEtapa", () => {
  it("sem SENTRY_DSN, roda o trabalho sem carregar o SDK", async () => {
    delete process.env.SENTRY_DSN;
    let carregou = false;
    vi.doMock("@sentry/nextjs", () => {
      carregou = true;
      return {};
    });
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    await expect(rastrearEtapa("board", async () => 7)).resolves.toBe(7);
    expect(carregou).toBe(false);
  });

  it("com DSN, abre um span com o nome do estágio e devolve o resultado", async () => {
    process.env.SENTRY_DSN = DSN;
    const abertos: Aberto[] = [];
    vi.doMock("@sentry/nextjs", () => sdkQueRegistra(abertos));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    await expect(rastrearEtapa("facets", async () => "ok")).resolves.toBe("ok");
    expect(abertos).toEqual([{ name: "facets", op: "jho.etapa", attributes: { "jho.etapa": "facets" } }]);
  });

  it("SDK que estoura ANTES de chamar o trabalho não impede a tela: o trabalho roda uma vez", async () => {
    process.env.SENTRY_DSN = DSN;
    vi.doMock("@sentry/nextjs", () => ({
      startSpan: () => {
        throw new Error("SDK quebrado");
      },
    }));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    let vezes = 0;
    await expect(rastrearEtapa("board", async () => ++vezes)).resolves.toBe(1);
    expect(vezes).toBe(1);
  });

  it("SDK que estoura DEPOIS de o trabalho concluir não derruba a tela: vale o valor do trabalho", async () => {
    process.env.SENTRY_DSN = DSN;
    vi.doMock("@sentry/nextjs", () => ({
      startSpan: async (_opcoes: unknown, fn: () => Promise<unknown>) => {
        await fn();
        throw new Error("falhou ao encerrar o span");
      },
    }));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    let vezes = 0;
    await expect(rastrearEtapa("board", async () => ++vezes)).resolves.toBe(1);
    expect(vezes).toBe(1);
  });

  it("SDK que estoura depois de o trabalho falhar devolve o erro do trabalho", async () => {
    process.env.SENTRY_DSN = DSN;
    vi.doMock("@sentry/nextjs", () => ({
      startSpan: async (_opcoes: unknown, fn: () => Promise<unknown>) => {
        await fn().catch(() => {});
        throw new Error("falhou ao encerrar o span");
      },
    }));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    await expect(
      rastrearEtapa("board", async () => {
        throw new Error("o banco recusou");
      }),
    ).rejects.toThrow("o banco recusou");
  });

  it("SDK sem startSpan roda o trabalho sozinho", async () => {
    process.env.SENTRY_DSN = DSN;
    vi.doMock("@sentry/nextjs", () => ({ startSpan: undefined }));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    await expect(rastrearEtapa("board", async () => "sozinho")).resolves.toBe("sozinho");
  });

  it("erro do trabalho continua sendo o erro do trabalho, e ele não roda de novo", async () => {
    process.env.SENTRY_DSN = DSN;
    const abertos: Aberto[] = [];
    vi.doMock("@sentry/nextjs", () => sdkQueRegistra(abertos));
    const { rastrearEtapa } = await import("../app/timeout-watch.ts");
    let vezes = 0;
    await expect(
      rastrearEtapa("board", async () => {
        vezes++;
        throw new Error("o banco recusou");
      }),
    ).rejects.toThrow("o banco recusou");
    expect(vezes).toBe(1);
  });
});

describe("cronômetro das telas", () => {
  it("cada estágio medido vira um span, e a leitura inteira é o pai sem a query", async () => {
    process.env.SENTRY_DSN = DSN;
    const abertos: Aberto[] = [];
    vi.doMock("@sentry/nextjs", () => sdkQueRegistra(abertos));
    const { comVigia, criarCronometro } = await import("../app/timeout-watch.ts");

    const valor = await comVigia("/jobs?q=termo-secreto", async () => {
      const timer = criarCronometro();
      await timer.time("auth", async () => {});
      await timer.time("board", async () => {});
      return timer.report("/jobs").stages.map((s) => s.stage);
    });

    expect(valor).toEqual(["auth", "board"]);
    expect(abertos.map((a) => [a.op, a.name])).toEqual([
      ["jho.leitura", "leitura /jobs"],
      ["jho.etapa", "auth"],
      ["jho.etapa", "board"],
    ]);
    expect(JSON.stringify(abertos)).not.toContain("termo-secreto");
  });
});

describe("createStageTimer com trace injetado", () => {
  it("o trace envolve cada estágio, e a medida continua", async () => {
    let agora = 0;
    const vistos: string[] = [];
    const timer = createStageTimer(
      () => agora,
      async (stage, work) => {
        vistos.push(stage);
        return work();
      },
    );
    await expect(timer.time("prelude", async () => { agora += 5; return 1; })).resolves.toBe(1);
    await expect(timer.time("facets", async () => { agora += 2; throw new Error("x"); })).rejects.toThrow("x");
    expect(vistos).toEqual(["prelude", "facets"]);
    expect(timer.report("/jobs").stages).toEqual([{ stage: "prelude", ms: 5 }, { stage: "facets", ms: 2 }]);
  });
});
