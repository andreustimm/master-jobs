/**
 * O adapter do vigia: quem decide se algo é REALMENTE enviado.
 *
 * `tests/timeout-watch.test.ts` cerca a função pura — com relógio de mentira,
 * prova que o aviso sai no prazo e que o relator não atrapalha o trabalho. Mas a
 * decisão que importa em produção mora no adapter: **sem `SENTRY_DSN`, nada é
 * enviado.** Essa linha nunca foi exercitada, e ela é a diferença entre um
 * ambiente de desenvolvimento silencioso e um que tenta falar com um serviço que
 * não existe a cada travamento.
 *
 * A revisão profunda nomeou a lacuna: "os cinco testes cercam a função pura; o
 * adapter que decide se algo é enviado fica sem teste".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DSN_ORIGINAL = process.env.SENTRY_DSN;

/** O que `captureMessage` recebeu, sem falar com o SDK de verdade. */
const capturado: Array<{ mensagem: string; opcoes: unknown }> = [];

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (mensagem: string, opcoes: unknown) => {
    capturado.push({ mensagem, opcoes });
  },
}));

const { comVigia } = await import("../app/timeout-watch.ts");

beforeEach(() => {
  capturado.length = 0;
});

afterEach(() => {
  if (DSN_ORIGINAL === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = DSN_ORIGINAL;
  vi.useRealTimers();
});

describe("o adapter do vigia", () => {
  it("UT-210 devolve o resultado do trabalho sem tocar nele", async () => {
    process.env.SENTRY_DSN = "https://exemplo@sentry.invalid/1";

    await expect(comVigia("/jobs", async () => ({ vagas: 3 }))).resolves.toEqual({ vagas: 3 });
    // Trabalho rápido não avisa: o prazo é desarmado no `finally`.
    expect(capturado).toHaveLength(0);
  });

  it("UT-211 erro do trabalho continua sendo o erro do trabalho", async () => {
    process.env.SENTRY_DSN = "https://exemplo@sentry.invalid/1";

    await expect(
      comVigia("/jobs", async () => {
        throw new Error("o banco recusou");
      }),
    ).rejects.toThrow("o banco recusou");
    // Relatar não pode virar um segundo defeito sobre o primeiro.
    expect(capturado).toHaveLength(0);
  });

  it("UT-212 sem `SENTRY_DSN`, o travamento não tenta falar com ninguém", async () => {
    delete process.env.SENTRY_DSN;
    vi.useFakeTimers();

    const trabalho = comVigia("/jobs", () => new Promise<string>((resolve) => {
      setTimeout(() => resolve("pronto"), 30_000);
    }));
    // Passa dos 22 segundos do vigia: em produção o aviso sairia aqui.
    await vi.advanceTimersByTimeAsync(23_000);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(trabalho).resolves.toBe("pronto");
    // Nada enviado: é o que mantém o desenvolvimento silencioso e evita bater
    // num serviço que não está configurado a cada travamento.
    expect(capturado).toHaveLength(0);
  });

  it("UT-213 com DSN e trabalho lento, o aviso sai nomeando a rota e sem a query", async () => {
    process.env.SENTRY_DSN = "https://exemplo@sentry.invalid/1";
    vi.useFakeTimers();

    const trabalho = comVigia("/jobs?company=Acme&pay=8000", () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("pronto"), 30_000);
      }));
    await vi.advanceTimersByTimeAsync(23_000);
    // O envio é assíncrono (import dinâmico do SDK); deixa a microtarefa correr.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(capturado).toHaveLength(1);
    const { mensagem, opcoes } = capturado[0]!;
    expect(mensagem).toContain("/jobs");
    // O caminho responde "onde travou" e é preciso para reproduzir; a query
    // responde "o que a pessoa procurava", que é uso e não diagnóstico.
    expect(mensagem).not.toContain("company=Acme");
    expect(mensagem).not.toContain("8000");
    expect(opcoes).toMatchObject({ level: "warning" });

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(trabalho).resolves.toBe("pronto");
  });

  it("UT-214 DSN em branco conta como ausente", async () => {
    // Uma variável presente e vazia é o estado mais comum de `.env` mal copiado,
    // e tratá-la como configurada faria toda requisição lenta tentar enviar.
    process.env.SENTRY_DSN = "   ";
    vi.useFakeTimers();

    const trabalho = comVigia("/jobs", () => new Promise<string>((resolve) => {
      setTimeout(() => resolve("pronto"), 30_000);
    }));
    await vi.advanceTimersByTimeAsync(23_000);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(trabalho).resolves.toBe("pronto");
    expect(capturado).toHaveLength(0);
  });
});
