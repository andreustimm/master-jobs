/**
 * Persisting scores. Separated from the pure scorer so the scoring logic stays
 * trivially unit-testable with no database in the picture.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { job, jobScore } from "../db/schema.ts";
import { ageInDays, loadRates, STALE_AFTER_DAYS } from "../../contexts/fx/index.ts";
import { matchingProfile } from "../../contexts/matching/index.ts";
import {
  SCORER_VERSION,
  scoreJob,
  type ScoreResult,
  type ScoringContext,
} from "./score.ts";

export type ScoreRunResult = {
  scored: number;
  skipped: number;
  topFit: number;
  /** Surfaced so the CLI can warn instead of silently scoring without rates. */
  fxDate?: string;
  fxWarning?: string;
};

type LoadedScoringContext = ScoringContext & {
  profileHash: string;
  fx: Awaited<ReturnType<typeof loadRates>>;
  fxWarning?: string;
};

export const FRESHNESS_RESCORE_AFTER_HOURS = 24;

async function loadScoringContext(candidateId: number): Promise<LoadedScoringContext> {
  const selected = await matchingProfile(candidateId);
  const profile = selected.profile;

  // Loaded once per run: scoring stays pure and offline, and every job in a
  // run is graded against the same quote.
  const fx = await loadRates(profile.compensation.reference_currency);
  let fxWarning: string | undefined;
  if (!fx) {
    fxWarning = "Sem cotações em cache — vagas em outras moedas não serão comparadas. Rode `jho fx refresh`.";
  } else if (ageInDays(fx) > STALE_AFTER_DAYS) {
    fxWarning = `Cotações de ${fx.date} têm mais de ${STALE_AFTER_DAYS} dias. Rode \`jho fx refresh\`.`;
  }

  return { profile, profileHash: selected.hash, fx, fxWarning, asOf: Date.now() };
}

/**
 * Quantas gravações vão juntas num `batch`.
 *
 * Cem porque o ganho é quase todo nas primeiras dezenas — o custo dominante é a
 * ida e volta, não o tamanho do corpo — e um lote grande demais aumenta o que se
 * perde quando um estoura. Com 8.768 vagas, são 88 requisições em vez de 8.768.
 */
const LOTE = 100;

/**
 * Monta a gravação SEM executá-la.
 *
 * Devolver a consulta em vez de aguardá-la é o que permite mandar cem de uma
 * vez. `scoreAll` percorria as vagas com um `await` por linha: contra o SQLite
 * local isso é imperceptível, e contra a Turso são 8.768 idas e voltas HTTP em
 * série — a varredura diária pagava minutos por isso, todo dia.
 */
function upsertScore(
  db: ReturnType<typeof getDb>,
  candidateId: number,
  jobId: number,
  result: ScoreResult,
  context: LoadedScoringContext,
) {
  const scoredAt = new Date(context.asOf).toISOString();
  const values = {
    fit: result.fit,
    titleScore: result.titleScore,
    keywordScore: result.keywordScore,
    seniorityScore: result.seniorityScore,
    geoScore: result.geoScore,
    compScore: result.compScore,
    freshnessScore: result.freshnessScore,
    benefitScore: result.benefitScore,
    penalty: result.penalty,
    cluster: result.cluster,
    matchedKeywords: result.matchedKeywords,
    missingKeywords: result.missingKeywords,
    detectedBenefits: result.detectedBenefits,
    ageDays: result.ageDays,
    reasons: result.reasons,
    blockers: result.blockers,
    eligibilityStatus: result.eligibility.status,
    eligibilityReasons: result.eligibility.reasons,
    scorerVersion: SCORER_VERSION,
    profileHash: context.profileHash,
    scoredAt,
  };

  return db
    .insert(jobScore)
    .values({ candidateId, jobId, ...values })
    .onConflictDoUpdate({
      target: [jobScore.candidateId, jobScore.jobId],
      set: values,
    });
}

/** Uma gravação só. `scoreOne` pontua uma vaga e não tem lote para formar. */
async function persistScore(
  candidateId: number,
  jobId: number,
  result: ScoreResult,
  context: LoadedScoringContext,
): Promise<void> {
  await upsertScore(getDb(), candidateId, jobId, result, context);
}

/** Score one known job through the exact same profile and scorer as a full run. */
export async function scoreOne(candidateId: number, jobId: number): Promise<ScoreResult | null> {
  const db = getDb();
  const context = await loadScoringContext(candidateId);
  const rows = await db
    .select({
      id: job.id,
      title: job.title,
      companyName: job.companyName,
      descriptionText: job.descriptionText,
      locationRaw: job.locationRaw,
      remote: job.remote,
      compMin: job.compMin,
      compMax: job.compMax,
      compCurrency: job.compCurrency,
      compPeriod: job.compPeriod,
      postedAt: job.postedAt,
    })
    .from(job)
    .where(eq(job.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const result = scoreJob(row, context);
  await persistScore(candidateId, row.id, result, context);
  return result;
}

/**
 * Score every open job that has no current score.
 * `all: true` rescores everything — use after editing profile.yaml.
 */
export async function scoreAll(
  candidateId: number,
  opts: { all?: boolean } = {},
): Promise<ScoreRunResult> {
  const db = getDb();
  const context = await loadScoringContext(candidateId);
  const freshnessCutoff = new Date(
    context.asOf - FRESHNESS_RESCORE_AFTER_HOURS * 3_600_000,
  ).toISOString();

  const rows = await db
    .select({
      id: job.id,
      title: job.title,
      companyName: job.companyName,
      descriptionText: job.descriptionText,
      locationRaw: job.locationRaw,
      remote: job.remote,
      compMin: job.compMin,
      compMax: job.compMax,
      compCurrency: job.compCurrency,
      compPeriod: job.compPeriod,
      postedAt: job.postedAt,
      existingVersion: jobScore.scorerVersion,
      existingProfileHash: jobScore.profileHash,
      existingScoredAt: jobScore.scoredAt,
    })
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, candidateId)),
    )
    .where(
      opts.all
        ? isNull(job.closedAt)
        : sql`${job.closedAt} is null and (
            ${jobScore.jobId} is null
            or ${jobScore.scorerVersion} <> ${SCORER_VERSION}
            or ${jobScore.profileHash} <> ${context.profileHash}
            or ${jobScore.scoredAt} < ${freshnessCutoff}
          )`,
    );

  let scored = 0;
  let topFit = 0;

  // Acumula e descarrega de cem em cem. A pontuação em si é função pura e
  // barata; o que custava era a gravação, uma por vaga, em série.
  type Gravacao = ReturnType<typeof upsertScore>;
  let pendentes: Gravacao[] = [];

  const descarregar = async () => {
    if (pendentes.length === 0) return;
    // `batch` exige tupla não-vazia; o guard acima é o que a garante.
    await db.batch(pendentes as [Gravacao, ...Gravacao[]]);
    pendentes = [];
  };

  for (const row of rows) {
    const result = scoreJob(row, context);
    topFit = Math.max(topFit, result.fit);
    pendentes.push(upsertScore(db, candidateId, row.id, result, context));
    scored++;
    if (pendentes.length >= LOTE) await descarregar();
  }
  await descarregar();

  return {
    scored,
    skipped: 0,
    topFit,
    fxDate: context.fx?.date,
    fxWarning: context.fxWarning,
  };
}
