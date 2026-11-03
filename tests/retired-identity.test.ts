import { describe, expect, it } from "vitest";
import { isRetiredObservation } from "../src/core/ingest/identity.ts";

const marker = { fingerprint: "old-fp", sourceId: "lever:acme", externalId: "42", externalUsable: true };
const input = {
  fingerprint: "old-fp", sourceId: "lever:acme", externalKey: "42",
  hasLiveMatch: false, humanAuthored: false, tombstones: [marker],
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
