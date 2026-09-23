/**
 * Análise estruturada da VAGA, presa à evidência (#223, tarefa 06; ADR-003 local).
 *
 * Puro: sem banco, sem rede, sem relógio. Monta a entrada do prompt, interpreta
 * a saída do provedor, confere cada trecho de evidência contra o texto que foi
 * enviado e decide se um pedido reaproveita, espera ou cria uma tentativa.
 *
 * A análise é da vaga, não da pessoa: a entrada é só título, empresa, local e
 * anúncio. Nenhum CV, perfil ou dossiê entra — o tipo de `buildStructureInput`
 * não tem onde recebê-los. Por isso o resultado pode ser lido por qualquer
 * sessão que lê a vaga sem vazar dado de candidato.
 */
import { createHash } from "node:crypto";
import { isStale } from "../../contexts/operations/domain/runs.ts";

/** Sobe quando o formato de `result` muda; entra na chave de idempotência. */
export const JOB_STRUCTURE_SCHEMA_VERSION = "1";
/** Sobe quando o texto de `docs/prompts/system/job-structure.md` muda de sentido. */
export const JOB_STRUCTURE_PROMPT_VERSION = "1";
/** Sem batimento além disto, `running` vira `interrupted` (forma de `isStale`). */
export const ANALYSIS_LEASE_MS = 10 * 60_000;
/**
 * Pedidos de pessoa (não admin) por texto da vaga. Cada tentativa é uma
 * chamada paga ao provedor de quem configurou a chave; depois disto, só o
 * admin tenta de novo.
 */
export const MAX_REQUEST_ATTEMPTS = 3;

export const ANALYSIS_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
  "paused_quota",
  "interrupted",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export const ACTIVE_ANALYSIS: readonly AnalysisStatus[] = ["queued", "running"];
/** Terminais que admitem nova tentativa. `succeeded` nunca: é reaproveitado. */
export const RETRYABLE_ANALYSIS: readonly AnalysisStatus[] = ["failed", "partial", "paused_quota", "interrupted"];

export type Provenance = "explicit" | "normalized" | "unknown" | "conflict";

export type AnalyzedField<T> = {
  value: T | null;
  provenance: Provenance;
  confidence: number;
  evidence: string[];
};

/** Os campos, em ordem de tela. `requiredSkills` é lista; o resto, texto curto. */
export const STRUCTURE_FIELDS = [
  "seniority",
  "employmentType",
  "workModel",
  "locationRestriction",
  "timezone",
  "compensation",
  "requiredSkills",
] as const;
export type StructureField = (typeof STRUCTURE_FIELDS)[number];

export type JobStructure = {
  [K in StructureField]: AnalyzedField<K extends "requiredSkills" ? string[] : string>;
};

const LIMITS = { text: 200, evidence: 300, evidenceItems: 4, skills: 30, skill: 80 } as const;

/* --------------------------------- entrada --------------------------------- */

/** Só a vaga. Não há campo para currículo, perfil ou dossiê — de propósito. */
export type JobStructureSource = {
  title: string;
  companyName: string;
  locationRaw: string | null;
  description: string;
};

/** Espaços colapsados e NFC: a forma contra a qual a evidência é conferida. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** O texto exato que sai da máquina, normalizado. */
export function buildStructureInput(job: JobStructureSource): string {
  const lines = [
    `CARGO: ${job.title}`,
    `EMPRESA: ${job.companyName}`,
    job.locationRaw ? `LOCAL DECLARADO: ${job.locationRaw}` : null,
    "ANÚNCIO:",
    job.description,
  ];
  return normalizeText(lines.filter((line) => line !== null).join("\n"));
}

/** SHA-256 do texto normalizado: a tela compara com o atual para dizer "a vaga mudou". */
export function structureInputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/* ------------------------------- saída e evidência ------------------------------ */

const UNKNOWN = <T>(): AnalyzedField<T> => ({ value: null, provenance: "unknown", confidence: 0, evidence: [] });

function emptyStructure(): JobStructure {
  return {
    seniority: UNKNOWN(),
    employmentType: UNKNOWN(),
    workModel: UNKNOWN(),
    locationRestriction: UNKNOWN(),
    timezone: UNKNOWN(),
    compensation: UNKNOWN(),
    requiredSkills: UNKNOWN(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const PROVENANCES: readonly string[] = ["explicit", "normalized", "unknown", "conflict"];

/**
 * O valor no tipo certo, ou `undefined` = malformado. Sem coerção: número onde
 * se esperava texto não vira texto, e lista com item que não é texto não perde
 * o item em silêncio.
 */
function readValue(field: StructureField, value: unknown): string | string[] | null | undefined {
  if (value === null) return null;
  if (field === "requiredSkills") {
    if (!Array.isArray(value) || value.length > LIMITS.skills) return undefined;
    if (!value.every((item) => typeof item === "string" && item.trim() !== "" && item.length <= LIMITS.skill)) return undefined;
    return value.map((item: string) => item.trim());
  }
  if (typeof value !== "string" || value.length > LIMITS.text) return undefined;
  return value.trim() === "" ? null : value.trim();
}

type FieldReading =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "ok"; field: AnalyzedField<string | string[]> };

function readField(field: StructureField, raw: unknown, source: string): FieldReading {
  if (raw === undefined) return { kind: "missing" };
  if (!isRecord(raw)) return { kind: "malformed" };
  const value = readValue(field, raw.value);
  const { provenance, confidence, evidence } = raw;
  if (value === undefined) return { kind: "malformed" };
  if (typeof provenance !== "string" || !PROVENANCES.includes(provenance)) return { kind: "malformed" };
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { kind: "malformed" };
  }
  if (!Array.isArray(evidence) || evidence.length > LIMITS.evidenceItems) return { kind: "malformed" };
  if (!evidence.every((item) => typeof item === "string" && item.length <= LIMITS.evidence)) return { kind: "malformed" };

  const quotes = (evidence as string[]).map(normalizeText).filter((quote) => quote !== "");
  const unknown = { kind: "ok", field: UNKNOWN<string | string[]>() } as const;
  if (provenance === "unknown") return unknown;
  // Regra 7 aplicada à vaga: fato sem trecho, ou com trecho que o anúncio não
  // contém, não é fato. O modelo pode ter parafraseado ou inventado — nos dois
  // casos a tela não pode mostrar como dito pela empresa.
  const haystack = source.toLowerCase();
  if (quotes.length === 0 || !quotes.every((quote) => haystack.includes(quote.toLowerCase()))) return unknown;
  if (provenance === "conflict") {
    // Contradição é o anúncio dizendo duas coisas: precisa das duas.
    if (quotes.length < 2) return unknown;
    return { kind: "ok", field: { value: null, provenance: "conflict", confidence, evidence: quotes } };
  }
  if (value === null) return unknown;
  return { kind: "ok", field: { value, provenance: provenance as Provenance, confidence, evidence: quotes } };
}

export type BoundResult = {
  structure: JobStructure;
  /** Campos que faltaram ou vieram fora do esquema: o resultado é parcial. */
  malformed: StructureField[];
};

/**
 * Prende cada campo à evidência. Trecho que não é substring do texto
 * normalizado rebaixa o campo para `unknown`; contradição com dois trechos
 * válidos vira `conflict`; campo ausente ou fora do esquema vira `unknown` e é
 * listado em `malformed`, preservando os válidos.
 */
export function bindEvidence(raw: unknown, sourceText: string): BoundResult {
  const structure = emptyStructure();
  const malformed: StructureField[] = [];
  const fields = isRecord(raw) && isRecord(raw.fields) ? raw.fields : null;
  const source = normalizeText(sourceText);
  for (const name of STRUCTURE_FIELDS) {
    const reading = readField(name, fields?.[name], source);
    if (reading.kind === "ok") (structure as Record<StructureField, AnalyzedField<string | string[]>>)[name] = reading.field;
    else malformed.push(name);
  }
  return { structure, malformed };
}

export type ParsedOutcome =
  | { status: "succeeded" | "partial"; structure: JobStructure }
  | { status: "failed"; code: "malformed_output" };

/**
 * Da resposta do provedor ao que se grava. O corpo bruto nunca sai daqui: o
 * que persiste é a estrutura conferida, ou só o código de falha.
 */
export function interpretOutput(text: string, sourceText: string): ParsedOutcome {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse((fenced?.[1] ?? text).trim());
  } catch {
    return { status: "failed", code: "malformed_output" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.fields)) return { status: "failed", code: "malformed_output" };
  const { structure, malformed } = bindEvidence(parsed, sourceText);
  if (malformed.length === STRUCTURE_FIELDS.length) return { status: "failed", code: "malformed_output" };
  return { status: malformed.length === 0 ? "succeeded" : "partial", structure };
}

/* ------------------------------ pedido e reuso ------------------------------ */

export type AttemptRow = {
  id: number;
  status: AnalysisStatus;
  heartbeatAt: string | null;
  claimedAt: string | null;
};

export type RequestDecision =
  | { kind: "reuse"; id: number }
  | { kind: "active"; id: number }
  | { kind: "create"; retryOf: number | null }
  | { kind: "exhausted"; id: number };

/**
 * O que um pedido faz, dadas as tentativas do MESMO texto (vaga, hash e
 * versão de esquema), da mais nova para a mais antiga:
 *
 * - `succeeded` existente é reaproveitado: pedir de novo não paga de novo;
 * - uma ativa (e viva) é devolvida: clique duplo não abre segunda;
 * - `running` vencida conta como `interrupted` (a infra a marca);
 * - terminal que admite nova tentativa cria outra, ligada a ela, até o teto de
 *   pedidos; depois, só o admin tenta de novo.
 */
export function decideAnalysisRequest(attempts: readonly AttemptRow[], now: string): RequestDecision {
  const done = attempts.find((row) => row.status === "succeeded");
  if (done) return { kind: "reuse", id: done.id };
  const alive = attempts.find(
    (row) =>
      row.status === "queued" ||
      (row.status === "running" &&
        !isStale({ status: "running", heartbeatAt: row.heartbeatAt ?? row.claimedAt ?? "" }, now, ANALYSIS_LEASE_MS)),
  );
  if (alive) return { kind: "active", id: alive.id };
  const latest = attempts[0];
  if (!latest) return { kind: "create", retryOf: null };
  if (attempts.length >= MAX_REQUEST_ATTEMPTS) return { kind: "exhausted", id: latest.id };
  return { kind: "create", retryOf: latest.id };
}

/** Admin tenta de novo só o que terminou sem sucesso completo. */
export function canRetry(status: AnalysisStatus): boolean {
  return RETRYABLE_ANALYSIS.includes(status);
}

/** Custo estimado em dólares; nulo quando o provedor ou o cadastro não informam. */
export function estimateCost(
  tokens: { input: number | null; output: number | null },
  price: { inputPerMTok: number | null; outputPerMTok: number | null },
): number | null {
  if (tokens.input === null || tokens.output === null) return null;
  if (price.inputPerMTok === null || price.outputPerMTok === null) return null;
  return (tokens.input * price.inputPerMTok + tokens.output * price.outputPerMTok) / 1_000_000;
}
