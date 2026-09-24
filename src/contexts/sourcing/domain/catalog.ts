/**
 * O catálogo de fontes como dado governado: quem pode escrever o quê, o que
 * cada adapter sabe fazer e como o `config/sources.yaml` entra no banco.
 *
 * Puro — sem banco, sem rede, sem relógio. A infra lê as linhas e aplica o
 * plano; a decisão mora aqui para que o sync, a importação e o `diff` nunca
 * discordem sobre o que é "linha gerida" ou "órfã".
 */
import { FETCHABLE_SOURCE_KINDS, type FetchableSourceKind } from "../../../core/sources/types.ts";

/* ------------------------------- capacidades ------------------------------- */

/**
 * O que um kind sabe fazer, derivado do que o adapter declara.
 *
 * `snapshot` diz se a listagem PODE provar que terminou (`complete`) — cada
 * execução ainda declara a própria completude, e só ela decide o fechamento
 * por ausência. `statusReason` é sempre falso: nenhum adapter atual prova
 * "preenchida", "cancelada" ou "pausada" além do 404/410.
 */
export type Capabilities = {
  snapshot: "complete" | "partial" | "unknown";
  termSearch: boolean;
  verify: boolean;
  statusReason: false;
};

/** O que a composição passa sobre cada adapter: dado, nunca a função de rede. */
export type AdapterDescriptor = {
  kind: string;
  snapshot?: "complete" | "partial";
  termSearch?: { validatedOn: string | null };
};

const NOTHING: Capabilities = { snapshot: "unknown", termSearch: false, verify: false, statusReason: false };

/**
 * Kind fora do registro não tem capacidade nenhuma: dizer "talvez" para uma
 * operação que não existe é pior que recusá-la com o motivo.
 */
export function capabilitiesOf(kind: string, registry: readonly AdapterDescriptor[]): Capabilities {
  const adapter = registry.find((entry) => entry.kind === kind);
  if (!adapter) return NOTHING;
  return {
    snapshot: adapter.snapshot ?? "unknown",
    // Busca por termo sem validação contra a API real fica fora (ADR-004).
    termSearch: adapter.termSearch?.validatedOn != null,
    // Toda vaga de adapter registrado tem URL pública sondável; só 404/410
    // decidem, e essa regra é de `probe.ts`, não daqui.
    verify: true,
    statusReason: false,
  };
}

/* -------------------------------- sondagem -------------------------------- */

/** Sondagem de FONTE; não confundir com `classify()` de `probe.ts`, que sonda VAGA. */
export type SourceProbeOutcome = "reachable" | "empty" | "blocked" | "failed";

/**
 * `status` nulo é rede ou tempo esgotado. 401/403/429 são bloqueio de robô —
 * nunca "vazio", porque vazio diria que o board existe e não tem vaga, e
 * bloqueio não prova nada disso (G26). Só uma resposta 2xx pode ser vazia.
 */
export function classifySourceProbe(result: { status: number | null; count: number | null }): SourceProbeOutcome {
  const { status, count } = result;
  if (status === null) return "failed";
  if (status === 401 || status === 403 || status === 429) return "blocked";
  if (status >= 200 && status < 300) return count === 0 ? "empty" : "reachable";
  return "failed";
}

/* ------------------------------ escrita (admin) ----------------------------- */

export const CATALOG_LIMITS = { handle: 300, label: 120, secretRef: 64 } as const;

export type CatalogWrite = {
  kind: string;
  handle: string;
  label: string;
  enabled: boolean;
  /** NOME da variável de ambiente, nunca o valor (G41). */
  secretRef: string | null;
};

export type CatalogError =
  | "unknown_kind"
  | "handle_invalid"
  | "handle_too_long"
  | "handle_reserved"
  | "label_empty"
  | "label_too_long"
  | "duplicate"
  | "secret_ref_invalid"
  | "secret_ref_looks_like_secret";

/** Kinds cujo handle é identificador de board: letra, dígito, ponto, hífen, sublinhado. */
const SLUG_KINDS: ReadonlySet<string> = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "recruitee"]);
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Controle e quebra de linha nunca são parte legítima de handle; entrariam no
// id da fonte e na URL montada pelo adapter.
const CONTROL = /[\u0000-\u001f\u007f]/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
// Chave de acesso da AWS e afins: maiúsculas e dígitos, sem sublinhado, longa.
// Casa o padrão de nome de variável, então precisa de recusa própria.
const KEY_SHAPED = /^(?=.*[0-9])[A-Z0-9]{16,}$/;

/**
 * Recusa antes de rede e banco. O erro nunca carrega o valor recebido: um
 * segredo colado no campo errado não pode ir parar num log nem na tela.
 */
export function validateSecretRef(value: string | null): { ok: true; value: string | null } | { ok: false; code: CatalogError } {
  if (value === null) return { ok: true, value: null };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (KEY_SHAPED.test(trimmed)) return { ok: false, code: "secret_ref_looks_like_secret" };
  if (trimmed.length > CATALOG_LIMITS.secretRef || !ENV_NAME.test(trimmed)) {
    return { ok: false, code: "secret_ref_invalid" };
  }
  return { ok: true, value: trimmed };
}

function isFetchable(kind: string): kind is FetchableSourceKind {
  return (FETCHABLE_SOURCE_KINDS as readonly string[]).includes(kind);
}

function handleError(kind: string, handle: string): CatalogError | null {
  if (handle.length > CATALOG_LIMITS.handle) return "handle_too_long";
  // `~` é o prefixo das fontes da captura por termo (ADR-011): uma fonte de
  // sync com esse handle fecharia por ausência o que a captura trouxe.
  if (handle.startsWith("~")) return "handle_reserved";
  if (handle !== handle.trim() || CONTROL.test(handle)) return "handle_invalid";
  if (SLUG_KINDS.has(kind) && !SLUG.test(handle)) return "handle_invalid";
  if (kind === "careers") {
    try {
      const url = new URL(handle);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "handle_invalid";
    } catch {
      return "handle_invalid";
    }
  }
  return null;
}

export function validateCatalogWrite(
  input: CatalogWrite,
  existing: readonly { kind: string; handle: string }[],
): { ok: true; value: CatalogWrite } | { ok: false; code: CatalogError } {
  if (!isFetchable(input.kind)) return { ok: false, code: "unknown_kind" };
  const handleProblem = handleError(input.kind, input.handle);
  if (handleProblem) return { ok: false, code: handleProblem };
  const label = input.label.trim();
  if (label === "") return { ok: false, code: "label_empty" };
  if (label.length > CATALOG_LIMITS.label) return { ok: false, code: "label_too_long" };
  const secret = validateSecretRef(input.secretRef);
  if (!secret.ok) return secret;
  if (existing.some((row) => row.kind === input.kind && row.handle === input.handle)) {
    return { ok: false, code: "duplicate" };
  }
  return { ok: true, value: { kind: input.kind, handle: input.handle, label, enabled: input.enabled, secretRef: secret.value } };
}

/**
 * Edição de fonte existente: kind e handle não mudam (são a identidade, e as
 * vagas apontam para ela); rótulo, habilitação e referência de segredo, sim.
 */
export function validateCatalogPatch(patch: {
  label?: string;
  enabled?: boolean;
  secretRef?: string | null;
}): { ok: true; value: { label?: string; enabled?: boolean; secretRef?: string | null } } | { ok: false; code: CatalogError } {
  const value: { label?: string; enabled?: boolean; secretRef?: string | null } = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (label === "") return { ok: false, code: "label_empty" };
    if (label.length > CATALOG_LIMITS.label) return { ok: false, code: "label_too_long" };
    value.label = label;
  }
  if (patch.secretRef !== undefined) {
    const secret = validateSecretRef(patch.secretRef);
    if (!secret.ok) return secret;
    value.secretRef = secret.value;
  }
  if (patch.enabled !== undefined) value.enabled = patch.enabled;
  return { ok: true, value };
}

/* -------------------------- YAML → banco (importação) ------------------------ */

/** Uma entrada do YAML, como o carregador devolve. */
export type YamlEntry = {
  kind: string;
  handle: string;
  label: string;
  rationale?: string | null;
  /** Ausente = habilitada, como no arquivo. */
  enabled?: boolean;
};

export type CatalogRow = {
  id: string;
  kind: string;
  handle: string;
  label: string;
  rationale: string | null;
  enabled: boolean;
  retiredAt: string | null;
  /** Não nulo = o banco governa a linha; o YAML nunca a sobrescreve. */
  managedAt: string | null;
};

export type DriftField = "label" | "rationale" | "enabled";

export type DriftItem =
  | { id: string; kind: "only_yaml" }
  | { id: string; kind: "only_db"; managed: boolean }
  | { id: string; kind: "changed"; managed: boolean; fields: DriftField[] };

export type CatalogPlan = {
  /** Entradas do YAML sem linha no banco. */
  inserts: YamlEntry[];
  /** Entradas do YAML cuja linha NÃO gerida diverge: o espelhamento as regrava. */
  mirrors: YamlEntry[];
  /** Ids de linhas não geridas e habilitadas que saíram do YAML: a aplicação as desabilita. */
  orphans: string[];
  /** Toda divergência YAML × banco, gerida ou não — o que `jho sources diff` mostra. */
  drift: DriftItem[];
};

export const catalogId = (kind: string, handle: string): string => `${kind}:${handle}`;

/**
 * Linha que pertence ao catálogo de sync. `<kind>:~terms` é da captura por
 * termo (parcial por definição) e `manual`/`recruiter` não têm adapter: nenhuma
 * das duas vem do YAML, então nenhuma pode ser órfã dele.
 */
export function isCatalogRow(row: { kind: string; handle: string }): boolean {
  return isFetchable(row.kind) && !row.handle.startsWith("~");
}

function changedFields(entry: YamlEntry, row: CatalogRow): DriftField[] {
  const fields: DriftField[] = [];
  if (entry.label !== row.label) fields.push("label");
  if ((entry.rationale ?? null) !== row.rationale) fields.push("rationale");
  if ((entry.enabled ?? true) !== row.enabled) fields.push("enabled");
  return fields;
}

export function planCatalogImport(yaml: readonly YamlEntry[], db: readonly CatalogRow[]): CatalogPlan {
  const rows = new Map(db.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const plan: CatalogPlan = { inserts: [], mirrors: [], orphans: [], drift: [] };

  for (const entry of yaml) {
    const id = catalogId(entry.kind, entry.handle);
    // Entrada repetida no arquivo: a primeira vale, como o upsert de antes.
    if (seen.has(id)) continue;
    seen.add(id);
    const row = rows.get(id);
    if (!row) {
      plan.inserts.push(entry);
      plan.drift.push({ id, kind: "only_yaml" });
      continue;
    }
    const fields = changedFields(entry, row);
    if (fields.length === 0) continue;
    const managed = row.managedAt !== null;
    plan.drift.push({ id, kind: "changed", managed, fields });
    if (!managed) plan.mirrors.push(entry);
  }

  for (const row of db) {
    if (seen.has(row.id) || !isCatalogRow(row)) continue;
    const managed = row.managedAt !== null;
    plan.drift.push({ id: row.id, kind: "only_db", managed });
    if (!managed && row.enabled) plan.orphans.push(row.id);
  }

  return plan;
}

/**
 * O que o sync varre: habilitada, não aposentada, com adapter e fora da
 * captura por termo. A mesma regra vira o WHERE da infra.
 */
export function isSyncEligible(row: { kind: string; handle: string; enabled: boolean; retiredAt: string | null }): boolean {
  return row.enabled && row.retiredAt === null && isCatalogRow(row);
}
