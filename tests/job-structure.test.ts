/**
 * Análise estruturada da vaga — domínio puro (#223, tarefa 06).
 *
 * UT-016 evidência, conflito e parcial · UT-017 saída malformada sem coerção ·
 * UT-018 entrada só com a vaga. Mais a regra de reuso (Minor 4 da #276) e o
 * vencimento do lease.
 */
import { describe, expect, it } from "vitest";
import { isStale } from "../src/contexts/operations/domain/runs.ts";
import {
  ANALYSIS_LEASE_MS,
  MAX_REQUEST_ATTEMPTS,
  STRUCTURE_FIELDS,
  bindEvidence,
  buildStructureInput,
  canRetry,
  decideAnalysisRequest,
  estimateCost,
  interpretOutput,
  structureInputHash,
  type AttemptRow,
} from "../src/core/llm/job-structure.ts";

const SOURCE = buildStructureInput({
  title: "Staff Software Engineer",
  companyName: "Acme",
  locationRaw: "Remoto — Brasil",
  description:
    "Buscamos pessoa Staff para plataforma de agentes.\n\nContrato PJ, 100% remoto, só residentes no Brasil.   Fuso de São Paulo.\nRequisitos: TypeScript e PostgreSQL. Vaga CLT.",
});

const field = (over: Record<string, unknown> = {}) => ({
  value: "PJ",
  provenance: "explicit",
  confidence: 0.9,
  evidence: ["Contrato PJ"],
  ...over,
});

const complete = () => ({
  fields: {
    seniority: field({ value: "Staff", evidence: ["Buscamos pessoa Staff"] }),
    employmentType: field(),
    workModel: field({ value: "remote", provenance: "normalized", evidence: ["100% remoto"] }),
    locationRestriction: field({ value: "Brasil", evidence: ["só residentes no Brasil."] }),
    timezone: field({ value: "America/Sao_Paulo", provenance: "normalized", evidence: ["Fuso de São Paulo"] }),
    compensation: field({ value: null, provenance: "unknown", confidence: 0, evidence: [] }),
    requiredSkills: field({ value: ["TypeScript", "PostgreSQL"], evidence: ["Requisitos: TypeScript e PostgreSQL"] }),
  },
});

describe("UT-016 evidência presa ao texto", () => {
  it("mantém o campo cujo trecho está no texto, com espaço e caixa normalizados", () => {
    const { structure, malformed } = bindEvidence(complete(), SOURCE);
    expect(malformed).toEqual([]);
    expect(structure.employmentType).toEqual({ value: "PJ", provenance: "explicit", confidence: 0.9, evidence: ["Contrato PJ"] });
    expect(structure.requiredSkills.value).toEqual(["TypeScript", "PostgreSQL"]);
    // Espaços triplos no anúncio, simples no trecho; caixa diferente.
    const loose = bindEvidence({ fields: { ...complete().fields, seniority: field({ value: "Staff", evidence: ["BUSCAMOS   pessoa staff"] }) } }, SOURCE);
    expect(loose.structure.seniority.provenance).toBe("explicit");
  });

  it("rebaixa para desconhecido o campo com trecho que o anúncio não contém", () => {
    const raw = complete();
    raw.fields.employmentType = field({ evidence: ["Contrato PJ ou CLT, você escolhe"] });
    const { structure, malformed } = bindEvidence(raw, SOURCE);
    expect(structure.employmentType).toEqual({ value: null, provenance: "unknown", confidence: 0, evidence: [] });
    // Rebaixar não é malformação: o resultado continua completo.
    expect(malformed).toEqual([]);
  });

  it("fato sem trecho nenhum não é fato", () => {
    const raw = complete();
    raw.fields.seniority = field({ value: "Staff", evidence: [] });
    expect(bindEvidence(raw, SOURCE).structure.seniority.provenance).toBe("unknown");
  });

  it("contradição vira conflict com as duas evidências; com uma só, desconhecido", () => {
    const raw = complete();
    raw.fields.employmentType = field({ value: null, provenance: "conflict", evidence: ["Contrato PJ", "Vaga CLT"] });
    expect(bindEvidence(raw, SOURCE).structure.employmentType).toEqual({
      value: null,
      provenance: "conflict",
      confidence: 0.9,
      evidence: ["Contrato PJ", "Vaga CLT"],
    });
    raw.fields.employmentType = field({ value: null, provenance: "conflict", evidence: ["Contrato PJ"] });
    expect(bindEvidence(raw, SOURCE).structure.employmentType.provenance).toBe("unknown");
    raw.fields.employmentType = field({ value: null, provenance: "conflict", evidence: ["Contrato PJ", "Vaga freelance"] });
    expect(bindEvidence(raw, SOURCE).structure.employmentType.provenance).toBe("unknown");
  });

  it("resultado parcial preserva os campos válidos e marca o resto como desconhecido", () => {
    const raw = { fields: { employmentType: field(), seniority: field({ value: 42 }) } };
    const { structure, malformed } = bindEvidence(raw, SOURCE);
    expect(structure.employmentType.value).toBe("PJ");
    expect(structure.seniority.provenance).toBe("unknown");
    expect(malformed).toEqual(STRUCTURE_FIELDS.filter((name) => name !== "employmentType"));
  });
});

describe("UT-017 saída malformada sem coerção", () => {
  it("texto que não é JSON, ou JSON sem `fields`, falha", () => {
    expect(interpretOutput("Claro! Aqui está a análise…", SOURCE)).toEqual({ status: "failed", code: "malformed_output" });
    expect(interpretOutput('{"campos": {}}', SOURCE)).toEqual({ status: "failed", code: "malformed_output" });
    expect(interpretOutput("[1,2]", SOURCE)).toEqual({ status: "failed", code: "malformed_output" });
    // Todos os campos fora do esquema: nada aproveitável, falha.
    expect(interpretOutput(JSON.stringify({ fields: { seniority: "Staff" } }), SOURCE)).toEqual({ status: "failed", code: "malformed_output" });
  });

  it.each([
    ["número onde se espera texto", { value: 3 }],
    ["confiança fora de 0..1", { confidence: 1.5 }],
    ["proveniência inventada", { provenance: "inferred" }],
    ["evidência que não é texto", { evidence: [1] }],
    ["texto longo demais", { value: "x".repeat(201) }],
  ])("campo com %s não é coagido: fica desconhecido e o resultado é parcial", (_label, over) => {
    const raw = complete();
    raw.fields.employmentType = field(over);
    const outcome = interpretOutput(JSON.stringify(raw), SOURCE);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "failed") expect(outcome.structure.employmentType.provenance).toBe("unknown");
  });

  it("lista de habilidades com item que não é texto é malformada inteira", () => {
    const raw = complete();
    raw.fields.requiredSkills = field({ value: ["TypeScript", 7], evidence: ["Requisitos: TypeScript e PostgreSQL"] });
    const outcome = interpretOutput(JSON.stringify(raw), SOURCE);
    expect(outcome.status).toBe("partial");
  });

  it("aceita JSON cercado por crases e grava só a estrutura conferida, nunca o corpo", () => {
    const body = { ...complete(), comentario: "CORPO-BRUTO-DO-PROVEDOR", key: "sk-ant-api03-segredo" };
    const outcome = interpretOutput("```json\n" + JSON.stringify(body) + "\n```", SOURCE);
    expect(outcome.status).toBe("succeeded");
    const persisted = JSON.stringify(outcome);
    expect(persisted).not.toContain("CORPO-BRUTO");
    expect(persisted).not.toContain("sk-ant");
  });
});

describe("UT-018 entrada só com a vaga", () => {
  it("monta a entrada com título, empresa, local e anúncio — e nada que venha junto", () => {
    const job = { title: "Arquiteta", companyName: "Acme", locationRaw: null, description: "Anúncio." };
    // Um chamador que tente passar dado de candidato: o construtor não o lê.
    const smuggled = { ...job, cv: "Piso salarial 999999 USD", profile: { floor: 999999 }, dossier: "dossiê privado" };
    const input = buildStructureInput(smuggled as typeof job);
    expect(input).toBe("CARGO: Arquiteta EMPRESA: Acme ANÚNCIO: Anúncio.");
    expect(input).not.toContain("999999");
    expect(input).not.toContain("dossiê");
  });

  it("o hash depende só do texto normalizado", () => {
    const a = buildStructureInput({ title: "A", companyName: "B", locationRaw: null, description: "x  y" });
    const b = buildStructureInput({ title: "A", companyName: "B", locationRaw: null, description: "x\ny" });
    expect(structureInputHash(a)).toBe(structureInputHash(b));
    expect(structureInputHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

const NOW = "2026-09-23T12:00:00.000Z";
const earlier = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const row = (id: number, status: AttemptRow["status"], heartbeatAt: string | null = null): AttemptRow => ({
  id,
  status,
  heartbeatAt,
  claimedAt: heartbeatAt,
});

describe("reuso e idempotência do pedido (Minor 4 da #276)", () => {
  it("análise concluída do mesmo texto é reaproveitada, sem nova chamada", () => {
    expect(decideAnalysisRequest([row(3, "failed"), row(2, "succeeded")], NOW)).toEqual({ kind: "reuse", id: 2 });
  });

  it("pedido ativo e vivo é devolvido", () => {
    expect(decideAnalysisRequest([row(5, "queued")], NOW)).toEqual({ kind: "active", id: 5 });
    expect(decideAnalysisRequest([row(5, "running", earlier(60_000))], NOW)).toEqual({ kind: "active", id: 5 });
  });

  it("running vencido não prende a vaga: nova tentativa ligada a ele", () => {
    expect(decideAnalysisRequest([row(5, "running", earlier(ANALYSIS_LEASE_MS + 1))], NOW)).toEqual({ kind: "create", retryOf: 5 });
  });

  it("primeiro pedido cria; depois de falha, cria ligada; no teto, esgota", () => {
    expect(decideAnalysisRequest([], NOW)).toEqual({ kind: "create", retryOf: null });
    expect(decideAnalysisRequest([row(1, "partial")], NOW)).toEqual({ kind: "create", retryOf: 1 });
    const many = Array.from({ length: MAX_REQUEST_ATTEMPTS }, (_, i) => row(MAX_REQUEST_ATTEMPTS - i, "failed"));
    expect(decideAnalysisRequest(many, NOW)).toEqual({ kind: "exhausted", id: MAX_REQUEST_ATTEMPTS });
  });

  it("nova tentativa só do que terminou sem sucesso completo", () => {
    expect(["failed", "partial", "paused_quota", "interrupted"].every((s) => canRetry(s as AttemptRow["status"]))).toBe(true);
    expect(["queued", "running", "succeeded"].some((s) => canRetry(s as AttemptRow["status"]))).toBe(false);
  });

  it("custo só com tokens e preço conhecidos", () => {
    expect(estimateCost({ input: 1_000_000, output: 500_000 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(10.5);
    expect(estimateCost({ input: null, output: 10 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBeNull();
    expect(estimateCost({ input: 10, output: 10 }, { inputPerMTok: null, outputPerMTok: 15 })).toBeNull();
  });
});

describe("isStale (lease)", () => {
  it("vence só running sem batimento além do lease; terminal nunca vence", () => {
    expect(isStale({ status: "running", heartbeatAt: earlier(1001) }, NOW, 1000)).toBe(true);
    expect(isStale({ status: "running", heartbeatAt: earlier(1000) }, NOW, 1000)).toBe(false);
    expect(isStale({ status: "running", heartbeatAt: "ilegível" }, NOW, 1000)).toBe(true);
    for (const status of ["queued", "succeeded", "partial", "failed", "cancelled", "interrupted"] as const) {
      expect(isStale({ status, heartbeatAt: earlier(10_000_000) }, NOW, 1000)).toBe(false);
    }
  });
});
