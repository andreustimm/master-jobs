/**
 * Domínio do catálogo de fontes (#223, tarefa 01): capacidades, sondagem,
 * validação de escrita, referência de segredo e plano de importação.
 * Puro — nenhum caso aqui abre banco ou rede.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_LIMITS,
  capabilitiesOf,
  classifySourceProbe,
  isSyncEligible,
  planCatalogImport,
  validateCatalogPatch,
  validateCatalogWrite,
  validateSecretRef,
  type CatalogRow,
  type CatalogWrite,
} from "../src/contexts/sourcing/domain/catalog.ts";
import { ADAPTERS } from "../src/core/sources/registry.ts";
import { FETCHABLE_SOURCE_KINDS } from "../src/core/sources/types.ts";

const registry = Object.values(ADAPTERS);

describe("UT-001 capacidades e sondagem", () => {
  it("todo kind registrado declara se a listagem pode provar o fim", () => {
    for (const kind of FETCHABLE_SOURCE_KINDS) {
      const caps = capabilitiesOf(kind, registry);
      expect(caps.snapshot, kind).not.toBe("unknown");
      expect(caps.verify, kind).toBe(true);
      expect(caps.statusReason, kind).toBe(false);
    }
  });

  it("ATS de board inteiro prova o fim; agregador de janela, nunca", () => {
    expect(capabilitiesOf("greenhouse", registry).snapshot).toBe("complete");
    expect(capabilitiesOf("remotive", registry).snapshot).toBe("partial");
    expect(capabilitiesOf("jobicy", registry).snapshot).toBe("partial");
  });

  it("busca por termo só onde a integração foi validada contra a API real", () => {
    for (const adapter of registry) {
      expect(capabilitiesOf(adapter.kind, registry).termSearch, adapter.kind).toBe(
        adapter.termSearch?.validatedOn != null,
      );
    }
    expect(capabilitiesOf("x", [{ kind: "x", snapshot: "complete", termSearch: { validatedOn: null } }]).termSearch).toBe(false);
  });

  it("kind fora do registro, ou adapter sem metadado, fica conservador", () => {
    expect(capabilitiesOf("manual", registry)).toEqual({
      snapshot: "unknown",
      termSearch: false,
      verify: false,
      statusReason: false,
    });
    expect(capabilitiesOf("novo", [{ kind: "novo" }]).snapshot).toBe("unknown");
  });

  it.each([401, 403, 429])("HTTP %i é bloqueio, nunca vazio", (status) => {
    expect(classifySourceProbe({ status, count: 0 })).toBe("blocked");
    expect(classifySourceProbe({ status, count: null })).toBe("blocked");
  });

  it.each([500, 502, 503, 404])("HTTP %i é falha", (status) => {
    expect(classifySourceProbe({ status, count: 0 })).toBe("failed");
  });

  it("rede ou tempo esgotado é falha, mesmo com contagem zero", () => {
    expect(classifySourceProbe({ status: null, count: 0 })).toBe("failed");
    expect(classifySourceProbe({ status: null, count: null })).toBe("failed");
  });

  it("só 2xx pode ser vazio; com vagas é alcançável", () => {
    expect(classifySourceProbe({ status: 200, count: 0 })).toBe("empty");
    expect(classifySourceProbe({ status: 200, count: 3 })).toBe("reachable");
    expect(classifySourceProbe({ status: 204, count: null })).toBe("reachable");
  });
});

const write = (over: Partial<CatalogWrite> = {}): CatalogWrite => ({
  kind: "greenhouse",
  handle: "acme",
  label: "Acme",
  enabled: true,
  secretRef: null,
  ...over,
});

describe("UT-002 validação de escrita", () => {
  it("aceita handle suportado, habilitado ou não, e apara o rótulo", () => {
    expect(validateCatalogWrite(write({ label: "  Acme  " }), [])).toEqual({ ok: true, value: write() });
    expect(validateCatalogWrite(write({ enabled: false }), [])).toMatchObject({ ok: true, value: { enabled: false } });
    expect(validateCatalogWrite(write({ kind: "remoteok", handle: "" }), [])).toMatchObject({ ok: true });
    expect(validateCatalogWrite(write({ kind: "remotive", handle: "ai engineer" }), [])).toMatchObject({ ok: true });
    expect(validateCatalogWrite(write({ kind: "careers", handle: "https://acme.com/jobs" }), [])).toMatchObject({ ok: true });
  });

  it("recusa kind fora do registro, inclusive os sem adapter", () => {
    expect(validateCatalogWrite(write({ kind: "linkedin" }), [])).toEqual({ ok: false, code: "unknown_kind" });
    expect(validateCatalogWrite(write({ kind: "manual" }), [])).toEqual({ ok: false, code: "unknown_kind" });
  });

  it("recusa handle malformado para o kind", () => {
    expect(validateCatalogWrite(write({ handle: "acme/../x" }), [])).toEqual({ ok: false, code: "handle_invalid" });
    expect(validateCatalogWrite(write({ handle: " acme" }), [])).toEqual({ ok: false, code: "handle_invalid" });
    expect(validateCatalogWrite(write({ kind: "remotive", handle: "a\nb" }), [])).toEqual({ ok: false, code: "handle_invalid" });
    expect(validateCatalogWrite(write({ kind: "careers", handle: "acme.com" }), [])).toEqual({ ok: false, code: "handle_invalid" });
    expect(validateCatalogWrite(write({ kind: "careers", handle: "ftp://acme.com" }), [])).toEqual({ ok: false, code: "handle_invalid" });
  });

  it("recusa handle reservado da captura por termo", () => {
    expect(validateCatalogWrite(write({ kind: "remotive", handle: "~terms" }), [])).toEqual({ ok: false, code: "handle_reserved" });
  });

  it("recusa rótulo vazio e rótulo e handle acima do máximo", () => {
    expect(validateCatalogWrite(write({ label: "   " }), [])).toEqual({ ok: false, code: "label_empty" });
    expect(validateCatalogWrite(write({ label: "x".repeat(CATALOG_LIMITS.label + 1) }), [])).toEqual({ ok: false, code: "label_too_long" });
    expect(validateCatalogWrite(write({ label: "x".repeat(CATALOG_LIMITS.label) }), [])).toMatchObject({ ok: true });
    expect(validateCatalogWrite(write({ handle: "a".repeat(CATALOG_LIMITS.handle + 1) }), [])).toEqual({ ok: false, code: "handle_too_long" });
  });

  it("recusa kind/handle duplicado", () => {
    const existing = [{ kind: "greenhouse", handle: "acme" }];
    expect(validateCatalogWrite(write(), existing)).toEqual({ ok: false, code: "duplicate" });
    expect(validateCatalogWrite(write({ kind: "lever" }), existing)).toMatchObject({ ok: true });
  });

  it("edição valida rótulo e segredo, e não mexe em kind nem handle", () => {
    expect(validateCatalogPatch({ label: " Novo " })).toEqual({ ok: true, value: { label: "Novo" } });
    expect(validateCatalogPatch({ label: "" })).toEqual({ ok: false, code: "label_empty" });
    expect(validateCatalogPatch({ label: "x".repeat(CATALOG_LIMITS.label + 1) })).toEqual({ ok: false, code: "label_too_long" });
    expect(validateCatalogPatch({ enabled: false })).toEqual({ ok: true, value: { enabled: false } });
    expect(validateCatalogPatch({ secretRef: "sk-live-123" })).toMatchObject({ ok: false });
    expect(validateCatalogPatch({ secretRef: "" })).toEqual({ ok: true, value: { secretRef: null } });
  });
});

describe("UT-003 referência de segredo", () => {
  it("aceita nome de variável de ambiente, e vazio vira nulo", () => {
    expect(validateSecretRef("ADZUNA_APP_KEY")).toEqual({ ok: true, value: "ADZUNA_APP_KEY" });
    expect(validateSecretRef(null)).toEqual({ ok: true, value: null });
    expect(validateSecretRef("  ")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["sk-ant-api03-abcdefghijklmnop", "secret_ref_invalid"],
    ["ghp_16C7e42F292c6912E7710c838347Ae178B4a", "secret_ref_invalid"],
    ["adzuna_app_key", "secret_ref_invalid"],
    ["AKIAIOSFODNN7EXAMPLE", "secret_ref_looks_like_secret"],
    ["A".repeat(CATALOG_LIMITS.secretRef + 1), "secret_ref_invalid"],
  ])("recusa %s sem ecoar o valor", (value, code) => {
    const result = validateSecretRef(value);
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(value);
    const viaWrite = validateCatalogWrite(write({ secretRef: value }), []);
    expect(viaWrite).toEqual({ ok: false, code });
    expect(JSON.stringify(viaWrite)).not.toContain(value);
  });
});

const row = (over: Partial<CatalogRow> & { id: string }): CatalogRow => {
  const [kind, handle] = over.id.split(":") as [string, string];
  return { kind, handle, label: "L", rationale: null, enabled: true, retiredAt: null, managedAt: null, ...over };
};

describe("UT-004 plano de importação", () => {
  it("insere o que falta no banco", () => {
    const plan = planCatalogImport([{ kind: "greenhouse", handle: "acme", label: "Acme" }], []);
    expect(plan.inserts).toEqual([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    expect(plan.drift).toEqual([{ id: "greenhouse:acme", kind: "only_yaml" }]);
  });

  it("espelha enabled: false em linha não gerida", () => {
    const plan = planCatalogImport(
      [{ kind: "greenhouse", handle: "acme", label: "L", enabled: false }],
      [row({ id: "greenhouse:acme" })],
    );
    expect(plan.mirrors).toEqual([{ kind: "greenhouse", handle: "acme", label: "L", enabled: false }]);
    expect(plan.drift).toEqual([{ id: "greenhouse:acme", kind: "changed", managed: false, fields: ["enabled"] }]);
  });

  it("não toca linha gerida, mas lista a divergência", () => {
    const plan = planCatalogImport(
      [{ kind: "greenhouse", handle: "acme", label: "Do arquivo", rationale: "r" }],
      [row({ id: "greenhouse:acme", label: "Da tela", enabled: false, managedAt: "2026-09-23T00:00:00.000Z" })],
    );
    expect(plan.mirrors).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.drift).toEqual([
      { id: "greenhouse:acme", kind: "changed", managed: true, fields: ["label", "rationale", "enabled"] },
    ]);
  });

  it("linha igual ao arquivo não gera escrita nem divergência", () => {
    const plan = planCatalogImport([{ kind: "greenhouse", handle: "acme", label: "L" }], [row({ id: "greenhouse:acme" })]);
    expect(plan).toEqual({ inserts: [], mirrors: [], orphans: [], drift: [] });
  });

  it("marca como órfã só a linha não gerida e habilitada que saiu do YAML", () => {
    const plan = planCatalogImport(
      [],
      [
        row({ id: "greenhouse:saiu" }),
        row({ id: "greenhouse:ja-desligada", enabled: false }),
        row({ id: "lever:gerida", managedAt: "2026-09-23T00:00:00.000Z" }),
        row({ id: "remotive:~terms" }),
        row({ id: "manual:sample" }),
        row({ id: "recruiter:" }),
      ],
    );
    expect(plan.orphans).toEqual(["greenhouse:saiu"]);
    expect(plan.drift).toEqual([
      { id: "greenhouse:saiu", kind: "only_db", managed: false },
      { id: "greenhouse:ja-desligada", kind: "only_db", managed: false },
      { id: "lever:gerida", kind: "only_db", managed: true },
    ]);
  });

  it("entrada repetida no arquivo vale uma vez", () => {
    const plan = planCatalogImport(
      [
        { kind: "greenhouse", handle: "acme", label: "Primeira" },
        { kind: "greenhouse", handle: "acme", label: "Segunda" },
      ],
      [],
    );
    expect(plan.inserts.map((entry) => entry.label)).toEqual(["Primeira"]);
  });

  it("elegível ao sync: habilitada, não aposentada, com adapter e fora de ~terms", () => {
    const base = { kind: "greenhouse", handle: "acme", enabled: true, retiredAt: null };
    expect(isSyncEligible(base)).toBe(true);
    expect(isSyncEligible({ ...base, enabled: false })).toBe(false);
    expect(isSyncEligible({ ...base, retiredAt: "2026-09-23T00:00:00.000Z" })).toBe(false);
    expect(isSyncEligible({ ...base, kind: "manual" })).toBe(false);
    expect(isSyncEligible({ ...base, kind: "remotive", handle: "~terms" })).toBe(false);
  });
});
