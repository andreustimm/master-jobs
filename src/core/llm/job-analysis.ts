/**
 * Fila da análise estruturada da vaga, em tabela (ADR 0009), e o processador.
 *
 * O pedido é barato e roda em qualquer lugar (tela, CLI): grava uma linha
 * `queued`. A chamada ao provedor só acontece em `processNextAnalysis`, que a
 * CLI roda com a chave BYOK de quem opera — nunca a requisição da Vercel.
 *
 * As decisões (reuso, idempotência, evidência, esquema) são puras e vêm de
 * `job-structure.ts`; aqui só se lê, grava e chama a porta.
 */
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { job, jobAnalysis, jobPage, type JobAnalysisRow } from "../db/schema.ts";
import { firstNonEmpty } from "../sources/http.ts";
import { loadSystemPrompt } from "./analyze.ts";
import {
  ANALYSIS_LEASE_MS,
  JOB_STRUCTURE_PROMPT_VERSION,
  JOB_STRUCTURE_SCHEMA_VERSION,
  buildStructureInput,
  canRetry,
  decideAnalysisRequest,
  estimateCost,
  interpretOutput,
  structureInputHash,
  type AnalysisStatus,
  type JobStructure,
  type JobStructureSource,
} from "./job-structure.ts";
import { LlmError, type LlmPort, type LlmRequest } from "./port.ts";

/** O texto da vaga que entra no prompt, ou `null` se a vaga não existe. */
export async function jobStructureSource(jobId: number): Promise<JobStructureSource | null> {
  const [row] = await getDb()
    .select({
      title: job.title,
      companyName: job.companyName,
      locationRaw: job.locationRaw,
      page: jobPage.text,
      description: job.descriptionText,
    })
    .from(job)
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(eq(job.id, jobId))
    .limit(1);
  if (!row) return null;
  return {
    title: row.title,
    companyName: row.companyName,
    locationRaw: firstNonEmpty(row.locationRaw),
    // Regra 17: a página capturada pode ter texto vazio, e `??` o escolheria.
    description: firstNonEmpty(row.page, row.description) ?? "",
  };
}

function inputFor(source: JobStructureSource): { input: string; hash: string } {
  const input = buildStructureInput(source);
  return { input, hash: structureInputHash(input) };
}

/**
 * `running` sem batimento além do lease vira `interrupted` e sai do índice de
 * idempotência. Sem isto, um processador morto prenderia a vaga para sempre.
 */
export async function reapStaleAnalyses(now: string): Promise<number> {
  const cutoff = new Date(Date.parse(now) - ANALYSIS_LEASE_MS).toISOString();
  const rows = await getDb()
    .update(jobAnalysis)
    .set({ status: "interrupted", errorCode: "lease_expired", finishedAt: now })
    .where(
      and(
        eq(jobAnalysis.status, "running"),
        or(lt(jobAnalysis.heartbeatAt, cutoff), and(isNull(jobAnalysis.heartbeatAt), lt(jobAnalysis.claimedAt, cutoff))),
      ),
    )
    .returning({ id: jobAnalysis.id });
  return rows.length;
}

export type RequestOutcome =
  | { ok: true; id: number; outcome: "created" | "reused" | "active" | "exhausted" }
  | { ok: false; code: "not_found" };

async function activeFor(jobId: number, hash: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: jobAnalysis.id })
    .from(jobAnalysis)
    .where(
      and(
        eq(jobAnalysis.jobId, jobId),
        eq(jobAnalysis.inputHash, hash),
        eq(jobAnalysis.schemaVersion, JOB_STRUCTURE_SCHEMA_VERSION),
        inArray(jobAnalysis.status, ["queued", "running"]),
      ),
    );
  return row?.id ?? null;
}

async function insertAttempt(input: {
  jobId: number;
  hash: string;
  requestedBy: number | null;
  retryOf: number | null;
}): Promise<{ id: number; outcome: "created" | "active" }> {
  const [row] = await getDb()
    .insert(jobAnalysis)
    .values({
      jobId: input.jobId,
      requestedBy: input.requestedBy,
      retryOf: input.retryOf,
      status: "queued",
      inputHash: input.hash,
      promptVersion: JOB_STRUCTURE_PROMPT_VERSION,
      schemaVersion: JOB_STRUCTURE_SCHEMA_VERSION,
    })
    // O índice único parcial decide a corrida: o segundo clique não cria.
    .onConflictDoNothing()
    .returning({ id: jobAnalysis.id });
  if (row) return { id: row.id, outcome: "created" };
  const active = await activeFor(input.jobId, input.hash);
  if (active === null) throw new Error("análise ativa sumiu entre o conflito e a leitura");
  return { id: active, outcome: "active" };
}

/**
 * Pedido de análise. Vaga inexistente devolve `not_found` — a mesma resposta
 * para quem não pode ler, porque o chamador já negou antes e não há vaga
 * "existente mas oculta" a distinguir.
 */
export async function requestJobAnalysis(input: {
  jobId: number;
  requestedBy: number | null;
  now: string;
}): Promise<RequestOutcome> {
  const source = await jobStructureSource(input.jobId);
  if (!source) return { ok: false, code: "not_found" };
  const { hash } = inputFor(source);
  await reapStaleAnalyses(input.now);
  const attempts = await getDb()
    .select({
      id: jobAnalysis.id,
      status: jobAnalysis.status,
      heartbeatAt: jobAnalysis.heartbeatAt,
      claimedAt: jobAnalysis.claimedAt,
    })
    .from(jobAnalysis)
    .where(
      and(
        eq(jobAnalysis.jobId, input.jobId),
        eq(jobAnalysis.inputHash, hash),
        eq(jobAnalysis.schemaVersion, JOB_STRUCTURE_SCHEMA_VERSION),
      ),
    )
    .orderBy(desc(jobAnalysis.id));
  const decision = decideAnalysisRequest(
    attempts.map((row) => ({ ...row, status: row.status as AnalysisStatus })),
    input.now,
  );
  if (decision.kind === "reuse") return { ok: true, id: decision.id, outcome: "reused" };
  if (decision.kind === "active") return { ok: true, id: decision.id, outcome: "active" };
  if (decision.kind === "exhausted") return { ok: true, id: decision.id, outcome: "exhausted" };
  const written = await insertAttempt({ jobId: input.jobId, hash, requestedBy: input.requestedBy, retryOf: decision.retryOf });
  return { ok: true, ...written };
}

/**
 * Nova tentativa pedida pelo admin, ligada à original — que não muda. Só para
 * o que terminou sem sucesso completo; `succeeded` é reaproveitado, não refeito.
 * Analisa o texto ATUAL da vaga: se ele mudou, a nova tentativa já nasce com o
 * hash novo.
 */
export async function retryJobAnalysis(input: {
  analysisId: number;
  requestedBy: number | null;
  now: string;
}): Promise<{ ok: true; id: number; jobId: number; outcome: "created" | "active" } | { ok: false; code: "not_found" | "not_retryable" }> {
  await reapStaleAnalyses(input.now);
  const [original] = await getDb()
    .select({ id: jobAnalysis.id, jobId: jobAnalysis.jobId, status: jobAnalysis.status })
    .from(jobAnalysis)
    .where(eq(jobAnalysis.id, input.analysisId));
  if (!original) return { ok: false, code: "not_found" };
  if (!canRetry(original.status as AnalysisStatus)) return { ok: false, code: "not_retryable" };
  const source = await jobStructureSource(original.jobId);
  if (!source) return { ok: false, code: "not_found" };
  const written = await insertAttempt({
    jobId: original.jobId,
    hash: inputFor(source).hash,
    requestedBy: input.requestedBy,
    retryOf: original.id,
  });
  return { ok: true, jobId: original.jobId, ...written };
}

/** Reivindica a mais antiga na fila (`FOR UPDATE SKIP LOCKED`), depois de liberar as vencidas. */
export async function claimJobAnalysis(now: string): Promise<JobAnalysisRow | null> {
  await reapStaleAnalyses(now);
  const [row] = await getDb()
    .update(jobAnalysis)
    .set({ status: "running", claimedAt: now, heartbeatAt: now })
    .where(
      eq(
        jobAnalysis.id,
        sql`(select id from ${jobAnalysis} where ${jobAnalysis.status} = 'queued' order by ${jobAnalysis.id} limit 1 for update skip locked)`,
      ),
    )
    .returning();
  return row ?? null;
}

export type AnalysisFinish =
  | {
      status: "succeeded" | "partial";
      result: JobStructure;
      providerSlug: string;
      modelId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      costEstimate: number | null;
    }
  | {
      status: "failed" | "paused_quota";
      errorCode: string;
      providerSlug: string | null;
      modelId: string | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
      costEstimate?: number | null;
    };

/**
 * Só quem ainda segura a reivindicação termina, e só a partir de `running`:
 * uma linha terminal nunca é regravada, nem por um processador atrasado que
 * perdeu o lease.
 */
export async function finishJobAnalysis(
  claimed: { id: number; claimedAt: string },
  finish: AnalysisFinish,
  now: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(jobAnalysis)
    .set({
      status: finish.status,
      result: finish.status === "succeeded" || finish.status === "partial" ? finish.result : null,
      errorCode: finish.status === "failed" || finish.status === "paused_quota" ? finish.errorCode : null,
      providerSlug: finish.providerSlug,
      modelId: finish.modelId,
      inputTokens: finish.inputTokens ?? null,
      outputTokens: finish.outputTokens ?? null,
      costEstimate: finish.costEstimate ?? null,
      finishedAt: now,
    })
    .where(and(eq(jobAnalysis.id, claimed.id), eq(jobAnalysis.status, "running"), eq(jobAnalysis.claimedAt, claimed.claimedAt)))
    .returning({ id: jobAnalysis.id });
  return rows.length === 1;
}

export type ProcessorModel = {
  port: LlmPort;
  providerSlug: string;
  modelId: string;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
  maxOutputTokens: number;
  effort?: LlmRequest["effort"];
};

/**
 * Processa UMA análise da fila. Devolve `null` com a fila vazia.
 *
 * Texto da vaga diferente do pedido: falha com `input_changed` SEM chamar o
 * provedor — analisar outro texto sob o hash antigo mentiria na tela, e a
 * chamada seria paga à toa. 429 do provedor é cota: `paused_quota`, que admite
 * nova tentativa. Nenhum corpo de resposta ou mensagem do provedor é gravado.
 */
export async function processNextAnalysis(
  model: ProcessorModel,
  opts: { now: () => string; root?: string },
): Promise<{ id: number; status: AnalysisStatus } | null> {
  // Antes de reivindicar: prompt ausente é defeito de instalação, e falhar
  // aqui deixa a fila intacta em vez de gastar a tentativa de alguém.
  const system = await loadSystemPrompt("job-structure", opts.root);
  const claimedAt = opts.now();
  const row = await claimJobAnalysis(claimedAt);
  if (!row) return null;
  const claimed = { id: row.id, claimedAt };
  const meta = { providerSlug: model.providerSlug, modelId: model.modelId };
  // Quem perdeu o lease no meio da chamada não grava: a linha já é
  // `interrupted`, e dizer "concluída" no terminal seria mentir.
  const settle = async (finish: AnalysisFinish) => ({
    id: row.id,
    status: (await finishJobAnalysis(claimed, finish, opts.now())) ? finish.status : ("interrupted" as const),
  });

  const source = await jobStructureSource(row.jobId);
  const current = source ? inputFor(source) : null;
  if (!current || current.hash !== row.inputHash) {
    return settle({ status: "failed", errorCode: "input_changed", providerSlug: null, modelId: null });
  }

  try {
    const response = await model.port.complete({
      system,
      messages: [{ role: "user", content: current.input }],
      maxTokens: model.maxOutputTokens,
      effort: model.effort,
      // Extrair, não criar: a mesma vaga deve dar a mesma leitura.
      temperature: 0,
    });
    const tokens = { input: response.inputTokens, output: response.outputTokens };
    const usage = {
      ...meta,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      costEstimate: estimateCost(tokens, { inputPerMTok: model.inputCostPerMTok, outputPerMTok: model.outputCostPerMTok }),
    };
    const outcome = interpretOutput(response.text, current.input);
    return settle(
      outcome.status === "failed"
        ? { status: "failed", errorCode: outcome.code, ...usage }
        : { status: outcome.status, result: outcome.structure, ...usage },
    );
  } catch (error) {
    const quota = error instanceof LlmError && error.status === 429;
    const code = quota ? "quota" : error instanceof LlmError ? "provider_error" : "network";
    return settle({ status: quota ? "paused_quota" : "failed", errorCode: code, ...meta });
  }
}

/* --------------------------------- leitura --------------------------------- */

export type AnalysisView = {
  id: number;
  status: AnalysisStatus;
  promptVersion: string;
  schemaVersion: string;
  createdAt: string;
  finishedAt: string | null;
  result: JobStructure | null;
  /** O texto da vaga mudou depois desta análise. */
  outdated: boolean;
};

export type AdminAnalysisView = AnalysisView & {
  retryOf: number | null;
  errorCode: string | null;
  providerSlug: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimate: number | null;
};

export type JobAnalysisPanel =
  | { admin: false; latest: AnalysisView | null; exhausted: boolean }
  | { admin: true; latest: AdminAnalysisView | null; exhausted: boolean; attempts: AdminAnalysisView[] };

/**
 * O que a tela da vaga mostra. Modelo, provedor, tokens, custo, erro e o
 * histórico de tentativas só saem para admin: o objeto de quem não é admin
 * não tem esses campos, em vez de tê-los escondidos pela tela.
 */
export async function jobAnalysisPanel(jobId: number, opts: { admin: boolean }): Promise<JobAnalysisPanel> {
  const [rows, source] = await Promise.all([
    getDb().select().from(jobAnalysis).where(eq(jobAnalysis.jobId, jobId)).orderBy(desc(jobAnalysis.id)).limit(20),
    jobStructureSource(jobId),
  ]);
  const hash = source ? inputFor(source).hash : null;
  // A mesma regra do pedido: a tela não oferece um botão que a action recusaria.
  const sameText = rows.filter((row) => row.inputHash === hash && row.schemaVersion === JOB_STRUCTURE_SCHEMA_VERSION);
  const exhausted =
    decideAnalysisRequest(
      sameText.map((row) => ({ id: row.id, status: row.status as AnalysisStatus, heartbeatAt: row.heartbeatAt, claimedAt: row.claimedAt })),
      clock().iso(),
    ).kind === "exhausted";
  const base = (row: JobAnalysisRow): AnalysisView => ({
    id: row.id,
    status: row.status as AnalysisStatus,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    result: (row.result as JobStructure | null) ?? null,
    outdated: hash !== null && hash !== row.inputHash,
  });
  if (!opts.admin) return { admin: false, latest: rows[0] ? base(rows[0]) : null, exhausted };
  const full = rows.map((row) => ({
    ...base(row),
    retryOf: row.retryOf,
    errorCode: row.errorCode,
    providerSlug: row.providerSlug,
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costEstimate: row.costEstimate,
  }));
  return { admin: true, latest: full[0] ?? null, exhausted, attempts: full };
}

/** Só agregados: nem vaga, nem texto, nem quem pediu. */
export async function analysisQueueStatus(): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ status: jobAnalysis.status, n: count() })
    .from(jobAnalysis)
    .groupBy(jobAnalysis.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

/** Quantas esperam na fila — para a CLI dizer o que vai sair da máquina antes de sair. */
export async function queuedAnalyses(): Promise<{ count: number; characters: number }> {
  const rows = await getDb()
    .select({ jobId: jobAnalysis.jobId })
    .from(jobAnalysis)
    .where(eq(jobAnalysis.status, "queued"));
  let characters = 0;
  for (const { jobId } of rows) {
    const source = await jobStructureSource(jobId);
    if (source) characters += buildStructureInput(source).length;
  }
  return { count: rows.length, characters };
}
