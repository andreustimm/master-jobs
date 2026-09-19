/**
 * Contrato do domínio de ciclo de vida (F-07, UT-001 a UT-004).
 *
 * Tudo aqui é puro: sem banco, sem rede, sem relógio. O corte é literal para
 * que a data do dia não decida se o teste passa.
 */
import { describe, expect, it } from "vitest";
import {
  archiveCutoff,
  decideArchive,
  decideReopen,
  type ArchiveInput,
} from "../src/core/ingest/lifecycle.ts";

const CUTOFF = "2026-06-01T00:00:00.000Z";

function input(overrides: Partial<ArchiveInput> = {}): ArchiveInput {
  return {
    closedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    hasApplication: false,
    cutoff: CUTOFF,
    sourceKind: "greenhouse",
    checkStatus: "gone",
    ...overrides,
  };
}

describe("decideArchive", () => {
  it("UT-001 mantém vaga aberta e fechamento mais novo que o corte", () => {
    expect(decideArchive(input({ closedAt: null }))).toEqual({
      kind: "keep",
      reason: "open",
    });
    expect(decideArchive(input({ closedAt: "2026-07-01T00:00:00.000Z" }))).toEqual({
      kind: "keep",
      reason: "recent-closure",
    });
  });

  it("UT-001 fechamento exatamente no corte é velho o bastante", () => {
    expect(decideArchive(input({ closedAt: CUTOFF }))).toMatchObject({ kind: "archive" });
  });

  it("UT-002 arquiva fechamento confirmado e antigo, sem candidatura", () => {
    expect(decideArchive(input())).toEqual({
      kind: "archive",
      reason: "closed-retention",
      preservesApplication: false,
    });
  });

  it("UT-002 candidatura não impede arquivar, só marca a preservação", () => {
    expect(decideArchive(input({ hasApplication: true }))).toEqual({
      kind: "archive",
      reason: "closed-retention",
      preservesApplication: true,
    });
  });

  it("UT-003 sondagem inconclusiva nunca arquiva", () => {
    expect(decideArchive(input({ checkStatus: "inconclusive" }))).toEqual({
      kind: "keep",
      reason: "inconclusive-probe",
    });
  });

  it("UT-003 vaga fechada que voltou a responder espera a reconciliação", () => {
    expect(decideArchive(input({ checkStatus: "alive" }))).toEqual({
      kind: "keep",
      reason: "reopen-pending",
    });
  });

  it("UT-003 fonte manual e de recrutador ficam fora da rotina", () => {
    for (const sourceKind of ["manual", "recruiter"] as const) {
      expect(decideArchive(input({ sourceKind }))).toEqual({
        kind: "keep",
        reason: "manual-source",
      });
    }
  });

  it("UT-003 vaga nunca sondada, mas fechada e antiga, é arquivável", () => {
    // `closed_at` só é escrito por 404/410 ou por ausência confirmada na fonte;
    // exigir sondagem própria aqui deixaria o acervo legado sem arquivamento.
    expect(decideArchive(input({ checkStatus: null }))).toMatchObject({ kind: "archive" });
  });

  it("UT-004 segunda passada não é trabalho", () => {
    expect(decideArchive(input({ archivedAt: "2026-06-02T00:00:00.000Z" }))).toEqual({
      kind: "noop",
      reason: "already-archived",
    });
  });
});

describe("decideReopen", () => {
  it("UT-004 um alive posterior desfaz o arquivamento automático", () => {
    expect(
      decideReopen({
        verdict: "alive",
        closedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: "2026-06-02T00:00:00.000Z",
      }),
    ).toEqual({ kind: "reopen", clearsArchive: true });
  });

  it("UT-004 reabre fechamento sem arquivamento, sem prometer limpar o que não há", () => {
    expect(
      decideReopen({ verdict: "alive", closedAt: "2026-01-01T00:00:00.000Z", archivedAt: null }),
    ).toEqual({ kind: "reopen", clearsArchive: false });
  });

  it("UT-004 gone e inconclusive não reabrem nada", () => {
    for (const verdict of ["gone", "inconclusive"] as const) {
      expect(
        decideReopen({ verdict, closedAt: "2026-01-01T00:00:00.000Z", archivedAt: null }),
      ).toEqual({ kind: "noop", reason: "not-alive" });
    }
  });

  it("UT-004 vaga já ativa não é reaberta de novo", () => {
    expect(decideReopen({ verdict: "alive", closedAt: null, archivedAt: null })).toEqual({
      kind: "noop",
      reason: "nothing-to-reopen",
    });
  });
});

describe("archiveCutoff", () => {
  it("UT-008 recusa corte inválido antes de qualquer escrita", () => {
    const now = new Date("2026-09-18T00:00:00.000Z");
    expect(() => archiveCutoff(now, -1)).toThrow(/inteiro maior ou igual a zero/);
    expect(() => archiveCutoff(now, 1.5)).toThrow(/inteiro maior ou igual a zero/);
  });

  it("UT-008 zero dia é corte válido: arquiva todo fechamento confirmado", () => {
    const now = new Date("2026-09-18T00:00:00.000Z");
    expect(archiveCutoff(now, 0)).toBe("2026-09-18T00:00:00.000Z");
    expect(archiveCutoff(now, 90)).toBe("2026-06-20T00:00:00.000Z");
  });
});
