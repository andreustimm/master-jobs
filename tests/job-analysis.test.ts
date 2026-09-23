/**
 * Fila da análise estruturada no PostgreSQL (#223, tarefa 06).
 *
 * IT-011: idempotência sob clique duplo, reuso do concluído, nova tentativa
 * ligada, cota esgotada, lease vencido, vaga alterada e nenhuma coluna com
 * chave ou corpo do provedor.
 * IT-012: vaga inexistente, visão sem custo nem modelo para quem não é admin,
 * e nenhuma escrita em `application`, `job_score` nem `candidate`.
 *
 * Fronteira FORA: o provedor de LLM (porta falsa). O prompt é o arquivo real.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCandidate, saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, job, jobAnalysis, jobPage, source } from "../src/core/db/schema.ts";
import {
  analysisQueueStatus,
  jobAnalysisPanel,
  processNextAnalysis,
  requestJobAnalysis,
  retryJobAnalysis,
  type ProcessorModel,
} from "../src/core/llm/job-analysis.ts";
import { ANALYSIS_LEASE_MS } from "../src/core/llm/job-structure.ts";
import { LlmError, type LlmPort, type LlmRequest } from "../src/core/llm/port.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let jobId: number;
const T0 = "2026-09-23T12:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();
const DESCRIPTION = "Buscamos pessoa Staff. Contrato PJ, 100% remoto, só residentes no Brasil.";

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" });
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:acme",
      externalId: "1",
      companyName: "Acme",
      title: "Staff Engineer",
      url: "https://example.test/1",
      fingerprint: "fp1",
      contentHash: "h1",
      descriptionText: DESCRIPTION,
      raw: {},
    })
    .returning({ id: job.id });
  jobId = row!.id;
});

afterEach(async () => {
  await releaseTestDb();
});

const GOOD = JSON.stringify({
  fields: {
    employmentType: { value: "PJ", provenance: "explicit", confidence: 0.9, evidence: ["Contrato PJ"] },
    workModel: { value: "remote", provenance: "normalized", confidence: 0.8, evidence: ["100% remoto"] },
    seniority: { value: "Staff", provenance: "explicit", confidence: 0.9, evidence: ["pessoa Staff"] },
    locationRestriction: { value: "Brasil", provenance: "explicit", confidence: 0.9, evidence: ["só residentes no Brasil"] },
    timezone: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    compensation: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    requiredSkills: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
  },
  comentario: "CORPO-BRUTO-DO-PROVEDOR",
});

function fakePort(behave: (req: LlmRequest) => string | Error): LlmPort & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: "fake",
    model: "fake-1",
    calls,
    async complete(req) {
      calls.push(req);
      const out = behave(req);
      if (out instanceof Error) throw out;
      return { text: out, inputTokens: 1000, outputTokens: 200, model: "fake-1" };
    },
  };
}

const model = (port: LlmPort): ProcessorModel => ({
  port,
  providerSlug: "fake",
  modelId: "fake-1",
  inputCostPerMTok: 3,
  outputCostPerMTok: 15,
  maxOutputTokens: 1000,
});

const allRows = () => db.select().from(jobAnalysis).orderBy(jobAnalysis.id);

describe("IT-011 fila, idempotência, cota e vaga alterada", () => {
  it("clique duplo abre uma análise só", async () => {
    const [a, b] = await Promise.all([
      requestJobAnalysis({ jobId, requestedBy: null, now: T0 }),
      requestJobAnalysis({ jobId, requestedBy: null, now: T0 }),
    ]);
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect(await allRows()).toHaveLength(1);
  });

  it("concluída é reaproveitada: pedir de novo não cria nem chama o provedor", async () => {
    const first = await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    const port = fakePort(() => GOOD);
    expect(await processNextAnalysis(model(port), { now: () => at(1000) })).toEqual({ id: first.ok ? first.id : -1, status: "succeeded" });

    const again = await requestJobAnalysis({ jobId, requestedBy: null, now: at(5000) });
    expect(again).toEqual({ ok: true, id: first.ok ? first.id : -1, outcome: "reused" });
    expect(await processNextAnalysis(model(port), { now: () => at(6000) })).toBeNull();
    expect(port.calls).toHaveLength(1);
    expect(await allRows()).toHaveLength(1);
  });

  it("nova tentativa fica ligada à original, que não muda", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await processNextAnalysis(model(fakePort(() => "não é JSON")), { now: () => at(1000) });
    const [original] = await allRows();
    expect(original).toMatchObject({ status: "failed", errorCode: "malformed_output" });

    const retry = await retryJobAnalysis({ analysisId: original!.id, requestedBy: null, now: at(2000) });
    expect(retry).toMatchObject({ ok: true, outcome: "created", jobId });
    const rows = await allRows();
    expect(rows[0]).toEqual(original);
    expect(rows[1]).toMatchObject({ status: "queued", retryOf: original!.id });

    // Concluída não admite nova tentativa, nem pelo admin.
    await processNextAnalysis(model(fakePort(() => GOOD)), { now: () => at(3000) });
    expect(await retryJobAnalysis({ analysisId: rows[1]!.id, requestedBy: null, now: at(4000) })).toEqual({
      ok: false,
      code: "not_retryable",
    });
  });

  it("429 do provedor vira paused_quota, com nova tentativa possível", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    const key = "sk-ant-api03-SEGREDO-DO-USUARIO-123456";
    const status = await processNextAnalysis(
      model(fakePort(() => new LlmError("anthropic", 429, `rate limited for key ${key}`))),
      { now: () => at(1000) },
    );
    expect(status?.status).toBe("paused_quota");
    const again = await requestJobAnalysis({ jobId, requestedBy: null, now: at(2000) });
    expect(again).toMatchObject({ ok: true, outcome: "created" });
    expect(JSON.stringify(await allRows())).not.toContain("SEGREDO");
  });

  it("erro do provedor e de rede viram falha com código, sem mensagem; retry de id inexistente recusa", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await processNextAnalysis(model(fakePort(() => new LlmError("anthropic", 500, "corpo do provedor"))), { now: () => at(1000) });
    await requestJobAnalysis({ jobId, requestedBy: null, now: at(2000) });
    await processNextAnalysis(model(fakePort(() => new Error("ECONNRESET"))), { now: () => at(3000) });
    expect((await allRows()).map((r) => [r.status, r.errorCode])).toEqual([
      ["failed", "provider_error"],
      ["failed", "network"],
    ]);
    expect(JSON.stringify(await allRows())).not.toContain("corpo do provedor");
    expect(await retryJobAnalysis({ analysisId: 999_999, requestedBy: null, now: at(4000) })).toEqual({ ok: false, code: "not_found" });
    // Terceira falha do mesmo texto: pedido de pessoa esgota; só o admin tenta de novo.
    await requestJobAnalysis({ jobId, requestedBy: null, now: at(5000) });
    await processNextAnalysis(model(fakePort(() => "não é JSON")), { now: () => at(6000) });
    const exhausted = await requestJobAnalysis({ jobId, requestedBy: null, now: at(7000) });
    expect(exhausted).toMatchObject({ ok: true, outcome: "exhausted" });
    const [, , third] = await allRows();
    expect(await retryJobAnalysis({ analysisId: third!.id, requestedBy: null, now: at(8000) })).toMatchObject({ ok: true, outcome: "created" });
  });

  it("running sem batimento vira interrupted e libera novo pedido", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    // Um processador reivindica e morre: nada termina a linha.
    await db.update(jobAnalysis).set({ status: "running", claimedAt: T0, heartbeatAt: T0 });

    const later = at(ANALYSIS_LEASE_MS + 1000);
    const again = await requestJobAnalysis({ jobId, requestedBy: null, now: later });
    expect(again).toMatchObject({ ok: true, outcome: "created" });
    const rows = await allRows();
    expect(rows.map((r) => [r.status, r.errorCode])).toEqual([
      ["interrupted", "lease_expired"],
      ["queued", null],
    ]);
    expect(rows[1]!.retryOf).toBe(rows[0]!.id);
  });

  it("texto alterado: o processador falha sem chamar o provedor, e a tela sinaliza", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await db.update(job).set({ descriptionText: `${DESCRIPTION} Agora híbrido.` }).where(eq(job.id, jobId));
    const port = fakePort(() => GOOD);
    expect((await processNextAnalysis(model(port), { now: () => at(1000) }))?.status).toBe("failed");
    expect(port.calls).toHaveLength(0);
    expect((await allRows())[0]).toMatchObject({ errorCode: "input_changed" });

    // Uma análise concluída do texto antigo fica marcada como desatualizada.
    await db.update(job).set({ descriptionText: DESCRIPTION }).where(eq(job.id, jobId));
    await requestJobAnalysis({ jobId, requestedBy: null, now: at(2000) });
    await processNextAnalysis(model(fakePort(() => GOOD)), { now: () => at(3000) });
    expect((await jobAnalysisPanel(jobId, { admin: false })).latest?.outdated).toBe(false);
    await db.update(job).set({ descriptionText: `${DESCRIPTION} Mudou.` }).where(eq(job.id, jobId));
    expect((await jobAnalysisPanel(jobId, { admin: false })).latest?.outdated).toBe(true);
  });

  it("a página capturada vence a descrição, mas página vazia não (regra 17)", async () => {
    await db.insert(jobPage).values({ jobId, finalUrl: "https://example.test/1", httpStatus: 200, text: "   ", contentHash: "p" });
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    const port = fakePort(() => GOOD);
    await processNextAnalysis(model(port), { now: () => at(1000) });
    expect(port.calls[0]!.messages[0]!.content).toContain("Contrato PJ");
  });

  it("nenhuma coluna guarda chave ou corpo do provedor; custo e tokens ficam", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await processNextAnalysis(model(fakePort(() => GOOD)), { now: () => at(1000) });
    const [done] = await allRows();
    expect(done).toMatchObject({ status: "succeeded", inputTokens: 1000, outputTokens: 200, modelId: "fake-1", providerSlug: "fake" });
    expect(done!.costEstimate).toBeCloseTo(0.006);
    expect(JSON.stringify(done)).not.toContain("CORPO-BRUTO");
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'production' and table_name = 'job_analysis'`);
    expect(columns.map((c) => c.column_name).filter((name) => /key|secret|token_value|body|raw/.test(name))).toEqual([]);
    expect(await analysisQueueStatus()).toEqual({ succeeded: 1 });
  });

  it("vaga apagada pela retenção leva a cadeia de tentativas junto", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await processNextAnalysis(model(fakePort(() => "não é JSON")), { now: () => at(1000) });
    const [original] = await allRows();
    await retryJobAnalysis({ analysisId: original!.id, requestedBy: null, now: at(2000) });
    // `retry_of` é `no action`: confere no fim do comando, quando as duas já saíram.
    await db.delete(job).where(eq(job.id, jobId));
    expect(await allRows()).toEqual([]);
  });
});

describe("IT-012 permissões e ausência de escrita em decisões", () => {
  it("vaga inexistente responde not_found e não grava nada", async () => {
    expect(await requestJobAnalysis({ jobId: 999_999, requestedBy: null, now: T0 })).toEqual({ ok: false, code: "not_found" });
    expect(await allRows()).toEqual([]);
  });

  it("quem não é admin não recebe modelo, custo, tokens, erro nem tentativas", async () => {
    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    await processNextAnalysis(model(fakePort(() => GOOD)), { now: () => at(1000) });
    const panel = await jobAnalysisPanel(jobId, { admin: false });
    expect(Object.keys(panel.latest ?? {}).sort()).toEqual(
      ["createdAt", "finishedAt", "id", "outdated", "promptVersion", "result", "schemaVersion", "status"].sort(),
    );
    expect("attempts" in panel).toBe(false);
    const admin = await jobAnalysisPanel(jobId, { admin: true });
    expect(admin.admin && admin.attempts[0]).toMatchObject({ modelId: "fake-1", costEstimate: expect.any(Number) });
  });

  it("o prompt não leva CV nem perfil, e nada é escrito em application, job_score ou candidate", async () => {
    const candidateId = await ensureCandidate({ slug: "ana", name: "Ana" });
    await saveDocument({ candidateId, kind: "cv", label: "CV", content: "# Ana\n\nPiso: 999999 USD" });
    await db.insert(application).values({ candidateId, jobId, status: "shortlisted" });
    const digest = async () =>
      db.execute<{ t: string; d: string }>(sql`
        select 'application' as t, md5(coalesce(string_agg(a::text, '|' order by a::text), '')) as d from production.application a
        union all select 'job_score', md5(coalesce(string_agg(s::text, '|' order by s::text), '')) from production.job_score s
        union all select 'candidate', md5(coalesce(string_agg(c::text, '|' order by c::text), '')) from production.candidate c`);
    const before = await digest();

    await requestJobAnalysis({ jobId, requestedBy: null, now: T0 });
    const port = fakePort(() => GOOD);
    await processNextAnalysis(model(port), { now: () => at(1000) });

    expect(await digest()).toEqual(before);
    const sent = JSON.stringify(port.calls);
    expect(sent).not.toContain("999999");
    expect(sent).not.toContain("# Ana");
  });
});
