import { describe, expect, it } from "vitest";
import {
  SCORE_BATCH,
  afterBatch,
  mayStartBatch,
  scoreQueueOf,
  startPosition,
  type StoredCursor,
} from "../src/core/scoring/batch.ts";

/**
 * As regras da passada em lotes (#288), sem banco: de onde começar, onde
 * retomar, quando parar e em que fila o candidato está.
 */

const ATUAL = { profileHash: "h1", scorerVersion: "1.3.0" };

function cursor(over: Partial<StoredCursor> = {}): StoredCursor {
  return {
    profileHash: "h1",
    scorerVersion: "1.3.0",
    position: { key: "2026-09-20T00:00:00.000Z", jobId: 42 },
    lastCompletedAt: null,
    ...over,
  };
}

describe("startPosition", () => {
  it("sem cursor gravado, começa do topo (a vaga mais recente)", () => {
    expect(startPosition(null, ATUAL)).toBeNull();
  });

  it("retoma do ponto gravado quando perfil e versão são os mesmos", () => {
    expect(startPosition(cursor(), ATUAL)).toEqual({ key: "2026-09-20T00:00:00.000Z", jobId: 42 });
  });

  it("perfil novo (currículo salvo, trilha editada) recomeça do topo", () => {
    expect(startPosition(cursor({ profileHash: "h0" }), ATUAL)).toBeNull();
  });

  it("versão nova do scorer recomeça do topo", () => {
    expect(startPosition(cursor({ scorerVersion: "1.2.0" }), ATUAL)).toBeNull();
  });

  it("`--all` recomeça do topo mesmo com cursor válido", () => {
    expect(startPosition(cursor(), ATUAL, { restart: true })).toBeNull();
  });

  it("passada completa guarda posição nula: a próxima começa do topo", () => {
    expect(startPosition(cursor({ position: null, lastCompletedAt: "2026-09-23T10:00:00.000Z" }), ATUAL)).toBeNull();
  });
});

describe("afterBatch", () => {
  const lote = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `2026-09-${String(30 - (i % 30)).padStart(2, "0")}`, jobId: 1_000 - i }));

  it("o lote é de cem vagas", () => {
    expect(SCORE_BATCH).toBe(100);
  });

  it("lote cheio avança o cursor para a última vaga lida, sem completar", () => {
    const read = lote(SCORE_BATCH);
    expect(afterBatch(read, SCORE_BATCH, "agora")).toEqual({
      position: read[read.length - 1],
      completedAt: null,
    });
  });

  it("lote incompleto é o fim da passada: volta ao topo e registra quando completou", () => {
    expect(afterBatch(lote(37), SCORE_BATCH, "2026-09-23T12:00:00.000Z")).toEqual({
      position: null,
      completedAt: "2026-09-23T12:00:00.000Z",
    });
  });

  it("leitura vazia também completa — não há laço sobre o fim do acervo", () => {
    expect(afterBatch([], SCORE_BATCH, "t")).toEqual({ position: null, completedAt: "t" });
  });
});

describe("mayStartBatch", () => {
  it("sem prazo, sempre", () => {
    expect(mayStartBatch({ batchesDone: 50, now: 10_000, slowestMs: 9_000 }, undefined)).toBe(true);
  });

  it("o primeiro lote da chamada começa mesmo com o prazo vencido: toda chamada avança", () => {
    expect(mayStartBatch({ batchesDone: 0, now: 30_000, slowestMs: 0 }, 20_000)).toBe(true);
  });

  it("depois dele, só começa o lote que caberia pelo mais lento até aqui", () => {
    expect(mayStartBatch({ batchesDone: 3, now: 17_000, slowestMs: 3_000 }, 20_000)).toBe(true);
    expect(mayStartBatch({ batchesDone: 3, now: 17_001, slowestMs: 3_000 }, 20_000)).toBe(false);
  });
});

describe("scoreQueueOf", () => {
  it("quem nunca completou uma passada na trilha principal está em `sem-nota`", () => {
    expect(scoreQueueOf(null)).toBe("sem-nota");
  });

  it("quem já completou vai para a manutenção de hora em hora", () => {
    expect(scoreQueueOf("2026-09-23T10:00:00.000Z")).toBe("manutencao");
  });
});
