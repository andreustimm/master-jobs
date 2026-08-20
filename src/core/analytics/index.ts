/**
 * Analytics, composed against the database.
 *
 * The pure analysis lives in `stats.ts`, `scorer-diagnostics.ts` and
 * `funnel.ts`. This file only fetches and wires.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { application, job, jobScore } from "../db/schema.ts";
import { WEIGHTS } from "../scoring/score.ts";
import { analyzeFunnel, hasReplied, type FunnelAnalysis, type Outcome } from "./funnel.ts";
import {
  diagnoseScorer,
  type ComponentSample,
  type ScorerDiagnostics,
} from "./scorer-diagnostics.ts";

export * from "./stats.ts";
export { diagnoseScorer } from "./scorer-diagnostics.ts";
export type { ComponentDiagnostic, ScorerDiagnostics } from "./scorer-diagnostics.ts";
export { analyzeFunnel, hasReplied } from "./funnel.ts";
export type { FunnelAnalysis, Outcome } from "./funnel.ts";

/** Column, label and declared weight for every scoring component. */
const COMPONENTS = [
  { key: "titleScore", label: "Cargo", weight: WEIGHTS.title },
  { key: "keywordScore", label: "Palavras-chave", weight: WEIGHTS.keyword },
  { key: "geoScore", label: "Elegibilidade", weight: WEIGHTS.geo },
  { key: "seniorityScore", label: "Senioridade", weight: WEIGHTS.seniority },
  { key: "compScore", label: "Remuneração", weight: WEIGHTS.comp },
  { key: "freshnessScore", label: "Frescor", weight: WEIGHTS.freshness },
  { key: "benefitScore", label: "Benefícios", weight: WEIGHTS.benefits },
] as const;

export async function scorerDiagnostics(candidateId: number): Promise<ScorerDiagnostics> {
  const db = getDb();
  const rows = await db
    .select({
      fit: jobScore.fit,
      titleScore: jobScore.titleScore,
      keywordScore: jobScore.keywordScore,
      geoScore: jobScore.geoScore,
      seniorityScore: jobScore.seniorityScore,
      compScore: jobScore.compScore,
      freshnessScore: jobScore.freshnessScore,
      benefitScore: jobScore.benefitScore,
    })
    .from(jobScore)
    .innerJoin(job, eq(job.id, jobScore.jobId))
    // Closed jobs are history, not the corpus the ranking operates on.
    .where(and(eq(jobScore.candidateId, candidateId), isNull(job.closedAt)));

  const samples: ComponentSample[] = COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    values: rows.map((r) => Number(r[c.key] ?? 0)),
  }));

  return diagnoseScorer(samples, rows.map((r) => Number(r.fit)));
}

export async function funnelAnalysis(candidateId: number): Promise<FunnelAnalysis> {
  const db = getDb();
  const rows = await db
    .select({
      jobId: application.jobId,
      status: application.status,
      channel: application.channel,
      fit: jobScore.fit,
      cluster: jobScore.cluster,
      sourceKind: job.sourceId,
      titleScore: jobScore.titleScore,
      keywordScore: jobScore.keywordScore,
      geoScore: jobScore.geoScore,
      seniorityScore: jobScore.seniorityScore,
      compScore: jobScore.compScore,
      freshnessScore: jobScore.freshnessScore,
      benefitScore: jobScore.benefitScore,
    })
    .from(application)
    .leftJoin(job, eq(job.id, application.jobId))
    .leftJoin(
      jobScore,
      and(
        eq(jobScore.jobId, application.jobId),
        eq(jobScore.candidateId, candidateId),
      ),
    )
    .where(eq(application.candidateId, candidateId));

  const outcomes: Outcome[] = rows.map((r) => ({
    jobId: r.jobId,
    status: r.status,
    replied: hasReplied(r.status),
    fit: r.fit === null ? null : Number(r.fit),
    cluster: r.cluster,
    // The source id is "kind:handle"; the kind is what generalises.
    sourceKind: r.sourceKind ? String(r.sourceKind).split(":")[0]! : null,
    channel: r.channel ?? null,
    components: Object.fromEntries(
      COMPONENTS.map((c) => [c.label, Number((r as Record<string, unknown>)[c.key] ?? 0)]),
    ),
  }));

  return analyzeFunnel(outcomes);
}
