import { describe, expect, it } from "vitest";
import { withDuplicateKeyRetry } from "../src/core/db/retry.ts";

/**
 * Suite: a retentativa de chave duplicada (regressão da corrida do seed)
 * Invariant: só `23505` é reexecutado, e só um número fixo de vezes.
 * Boundary IN: a regra de reexecução, exercitada com erros sintéticos.
 * Boundary OUT: a corrida real no PostgreSQL, que a suíte do seed cobre.
 */

/** Forma do erro que o driver devolve; o drizzle embrulha e guarda em `cause`. */
function duplicateKey(wrapped = true): Error {
  const driver = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
  if (!wrapped) return driver;
  return Object.assign(new Error("Failed query: insert into job ..."), { cause: driver });
}

describe("withDuplicateKeyRetry", () => {
  it("devolve o resultado sem reexecutar quando a primeira passada funciona", async () => {
    let calls = 0;
    const result = await withDuplicateKeyRetry(async () => {
      calls += 1;
      return "ok";
    });
    expect([result, calls]).toEqual(["ok", 1]);
  });

  it("reexecuta a escrita quando o banco diz que a chave já existe", async () => {
    let calls = 0;
    const result = await withDuplicateKeyRetry(async () => {
      calls += 1;
      if (calls === 1) throw duplicateKey();
      return "ok";
    });
    // A segunda passada enxerga a linha já commitada e vira o UPDATE que o
    // upsert sempre pretendeu ser.
    expect([result, calls]).toEqual(["ok", 2]);
  });

  it("reconhece o erro do driver mesmo sem o embrulho do drizzle", async () => {
    let calls = 0;
    await withDuplicateKeyRetry(async () => {
      calls += 1;
      if (calls === 1) throw duplicateKey(false);
      return "ok";
    });
    expect(calls).toBe(2);
  });

  it("desiste depois do teto: chave duplicada que insiste é dado, não corrida", async () => {
    let calls = 0;
    await expect(
      withDuplicateKeyRetry(async () => {
        calls += 1;
        throw duplicateKey();
      }),
    ).rejects.toThrow(/Failed query/);
    expect(calls).toBe(3);
  });

  it("não reexecuta erro de outra natureza", async () => {
    let calls = 0;
    await expect(
      withDuplicateKeyRetry(async () => {
        calls += 1;
        throw Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
      }),
    ).rejects.toThrow(/foreign key/);
    expect(calls).toBe(1);
  });
});
