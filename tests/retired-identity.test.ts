import { describe, expect, it } from "vitest";
import { isRetiredObservation } from "../src/core/ingest/identity.ts";

const marker = { fingerprint: "old-fp", sourceId: "lever:acme", externalId: "42", externalUsable: true, expiredAt: "2026-02-01T00:00:00.000Z" };
const input = {
  fingerprint: "old-fp", sourceId: "lever:acme", externalKey: "42",
  observedAt: "2026-02-02T00:00:00.000Z", hasLiveMatch: false, humanAuthored: false, tombstones: [marker],
};

describe("identidade de vaga expirada", () => {
  it("reconhece fingerprint igual em qualquer fonte", () => {
    expect(isRetiredObservation({ ...input, sourceId: "ashby:other", externalKey: null })).toBe(true);
  });

  it("reconhece edição do título pelo id externo confiável na mesma fonte", () => {
    expect(isRetiredObservation({ ...input, fingerprint: "edited" })).toBe(true);
  });

  it("não confunde fontes ou ids externos ambíguos", () => {
    expect(isRetiredObservation({ ...input, fingerprint: "edited", sourceId: "lever:other" })).toBe(false);
    expect(isRetiredObservation({ ...input, fingerprint: "edited", externalKey: null })).toBe(false);
    expect(isRetiredObservation({ ...input, fingerprint: "edited", tombstones: [{ ...marker, externalUsable: false }] })).toBe(false);
  });

  it("não suprime uma linha viva ou uma vaga criada pela pessoa", () => {
    expect(isRetiredObservation({ ...input, hasLiveMatch: true })).toBe(false);
    expect(isRetiredObservation({ ...input, humanAuthored: true })).toBe(false);
  });
});

it("permite novo id da mesma fonte com empresa, título e local iguais", () => {
  expect(isRetiredObservation({ ...input, externalKey: "new-42" })).toBe(false);
});
it("permite publicação posterior ao descarte mesmo com id reutilizado", () => {
  expect(isRetiredObservation({ ...input, postedAt: "2026-02-02T00:00:00.000Z" })).toBe(false);
});
it("limita a supressão por fingerprint sem identidade confiável a 90 dias", () => {
  expect(isRetiredObservation({ ...input, sourceId: "other", externalKey: null, observedAt: "2026-05-02T00:00:00.000Z" })).toBe(false);
});
