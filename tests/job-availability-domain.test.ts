/**
 * Disponibilidade e motivo de uma vaga (#223, tarefa 04). Puro.
 *
 * UT-010 disponibilidade, ordem, vencimento e ausência · UT-011 motivo só com
 * 404/410. O teste existente de `classify` (`tests/cov-ingest-verify.test.ts`)
 * continua valendo; aqui só se amarra o motivo à mesma classificação.
 */
import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STALE_MS,
  compareEvents,
  currentAvailability,
  decidesState,
  gateInstant,
  latestEvent,
  reasonFor,
  reconcileAvailability,
  type CheckEvent,
} from "../src/core/ingest/availability.ts";
import { classify } from "../src/core/ingest/probe.ts";

const NOW = "2026-09-23T12:00:00.000Z";
const DIA = 86_400_000;
const ev = (id: number, checkedAt: string, verdict: CheckEvent["verdict"]): CheckEvent => ({ id, checkedAt, verdict });

describe("UT-010 disponibilidade", () => {
  it("sem evento é desconhecida — nem aberta, nem fechada", () => {
    expect(currentAvailability([], NOW, AVAILABILITY_STALE_MS)).toBe("unknown");
  });

  it("só inconclusivos também é desconhecida: bloqueio de robô não prova nada", () => {
    expect(currentAvailability([ev(1, "2026-09-22T00:00:00.000Z", "inconclusive")], NOW, AVAILABILITY_STALE_MS)).toBe("unknown");
  });

  it("decide pelo evento conclusivo mais recente por checked_at, não pela ordem de chegada", () => {
    const fechou = ev(2, "2026-09-20T00:00:00.000Z", "gone");
    const reabriu = ev(1, "2026-09-22T00:00:00.000Z", "alive");
    // O `id` maior chegou depois, mas é mais antigo: não decide.
    expect(currentAvailability([reabriu, fechou], NOW, AVAILABILITY_STALE_MS)).toBe("open");
    expect(currentAvailability([fechou, reabriu], NOW, AVAILABILITY_STALE_MS)).toBe("open");
    expect(currentAvailability([ev(3, "2026-09-23T00:00:00.000Z", "gone"), reabriu], NOW, AVAILABILITY_STALE_MS)).toBe("closed");
  });

  it("inconclusivo mais novo não desfaz o que o conclusivo anterior provou", () => {
    const eventos = [ev(1, "2026-09-21T00:00:00.000Z", "gone"), ev(2, "2026-09-22T00:00:00.000Z", "inconclusive")];
    expect(currentAvailability(eventos, NOW, AVAILABILITY_STALE_MS)).toBe("closed");
  });

  it("no mesmo instante, o id desempata", () => {
    const mesmo = "2026-09-22T00:00:00.000Z";
    expect(currentAvailability([ev(5, mesmo, "gone"), ev(4, mesmo, "alive")], NOW, AVAILABILITY_STALE_MS)).toBe("closed");
    expect(compareEvents(ev(4, mesmo, "alive"), ev(5, mesmo, "gone"))).toBeLessThan(0);
    expect(latestEvent([])).toBeNull();
  });

  it("além da janela, vencida: a checagem existiu mas não fala de hoje", () => {
    const velho = new Date(Date.parse(NOW) - 15 * DIA).toISOString();
    const recente = new Date(Date.parse(NOW) - 13 * DIA).toISOString();
    expect(currentAvailability([ev(1, velho, "alive")], NOW, AVAILABILITY_STALE_MS)).toBe("stale");
    expect(currentAvailability([ev(1, velho, "gone")], NOW, AVAILABILITY_STALE_MS)).toBe("stale");
    expect(currentAvailability([ev(1, recente, "alive")], NOW, AVAILABILITY_STALE_MS)).toBe("open");
  });

  it("evento mais antigo que o último gravado não decide o estado", () => {
    expect(decidesState("2026-09-22T00:00:00.000Z", null)).toBe(true);
    expect(decidesState("2026-09-22T00:00:00.000Z", "2026-09-21T00:00:00.000Z")).toBe(true);
    expect(decidesState("2026-09-22T00:00:00.000Z", "2026-09-22T00:00:00.000Z")).toBe(true);
    expect(decidesState("2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z")).toBe(false);
  });
});

describe("UT-011 motivo só com 404/410", () => {
  it("404 e 410 são gone com motivo closed", () => {
    for (const status of [404, 410]) {
      expect(classify(status)).toBe("gone");
      expect(reasonFor(classify(status))).toBe("closed");
    }
  });

  it("2xx e 3xx são alive, sem motivo", () => {
    for (const status of [200, 204, 301, 302]) {
      expect(classify(status)).toBe("alive");
      expect(reasonFor(classify(status))).toBe("unknown");
    }
  });

  it("401/403/429, 5xx, timeout e rede são inconclusive com motivo unknown", () => {
    for (const status of [401, 403, 429, 500, 502, 503, null]) {
      expect(classify(status)).toBe("inconclusive");
      expect(reasonFor(classify(status))).toBe("unknown");
    }
  });
});

describe("UT-010 conciliação com a linha da vaga", () => {
  it("closed_at preenchido é encerrada, mesmo com o último evento vivo (sync fechou)", () => {
    for (const estado of ["open", "stale", "unknown", "closed"] as const) {
      expect(reconcileAvailability(estado, "2026-09-22T00:00:00.000Z")).toBe("closed");
    }
  });

  it("404 desmentido pelo sync vira desconhecida; o resto passa como veio", () => {
    expect(reconcileAvailability("closed", null)).toBe("unknown");
    expect(reconcileAvailability("open", null)).toBe("open");
    expect(reconcileAvailability("stale", null)).toBe("stale");
    expect(reconcileAvailability("unknown", null)).toBe("unknown");
  });

  it("conclusivo compara com o último conclusivo; inconclusivo, com o último de qualquer tipo", () => {
    const newest = { any: "2026-09-22T00:00:00.000Z", conclusive: "2026-09-20T00:00:00.000Z" };
    expect(gateInstant("gone", newest)).toBe(newest.conclusive);
    expect(gateInstant("alive", newest)).toBe(newest.conclusive);
    expect(gateInstant("inconclusive", newest)).toBe(newest.any);
    // O caso do achado: conclusivo em T1 gravado depois de inconclusivo em T2 > T1 decide.
    expect(decidesState("2026-09-21T00:00:00.000Z", gateInstant("gone", newest))).toBe(true);
  });
});
