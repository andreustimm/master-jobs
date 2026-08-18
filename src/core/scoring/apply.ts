/**
 * Persisting scores. Separated from the pure scorer so the scoring logic stays
 * trivially unit-testable with no database in the picture.
 */
import { eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { job, jobScore } from "../db/schema.ts";
import { ageInDays, loadRates, STALE_AFTER_DAYS } from "../fx.ts";
import { loadProfile } from "../profile/load.ts";
import { SCORER_VERSION, scoreJob } from "./score.ts";

export type ScoreRunResult = {
  scored: number;
  skipped: number;
  topFit: number;
  /** Surfaced so the CLI can warn instead of silently scoring without rates. */
  fxDate?: string;
  fxWarning?: string;
};

/**
 * Score every open job that has no current score.
 * `all: true` rescores everything — use after editing profile.yaml.
 */
export async function scoreAll(opts: { all?: boolean } = {}): Promise<ScoreRunResult> {
  const db = getDb();
  const profile = await loadProfile(true);

  // Loaded once per run: scoring stays pure and offline, and every job in a run
  // is graded against the same quote.
  const fx = await loadRates(profile.compensation.reference_currency);
  let fxWarning: string | undefined;
  if (!fx) {
    fxWarning = "Sem cotações em cache — vagas em outras moedas não serão comparadas. Rode `jho fx refresh`.";
  } else if (ageInDays(fx) > STALE_AFTER_DAYS) {
    fxWarning = `Cotações de ${fx.date} têm mais de ${STALE_AFTER_DAYS} dias. Rode \`jho fx refresh\`.`;
  }

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
      existingVersion: jobScore.scorerVersion,
    })
    .from(job)
    .leftJoin(jobScore, eq(jobScore.jobId, job.id))
    .where(
      opts.all
        ? isNull(job.closedAt)
        : sql`${job.closedAt} is null and (${jobScore.jobId} is null or ${jobScore.scorerVersion} <> ${SCORER_VERSION})`,
    );

  let scored = 0;
  let topFit = 0;

  for (const row of rows) {
    const result = scoreJob(row, profile, fx);
    topFit = Math.max(topFit, result.fit);

    await db
      .insert(jobScore)
      .values({
        jobId: row.id,
        fit: result.fit,
        titleScore: result.titleScore,
        keywordScore: result.keywordScore,
        seniorityScore: result.seniorityScore,
        geoScore: result.geoScore,
        compScore: result.compScore,
        penalty: result.penalty,
        cluster: result.cluster,
        matchedKeywords: result.matchedKeywords,
        missingKeywords: result.missingKeywords,
        reasons: result.reasons,
        blockers: result.blockers,
        scorerVersion: SCORER_VERSION,
        scoredAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: jobScore.jobId,
        set: {
          fit: result.fit,
          titleScore: result.titleScore,
          keywordScore: result.keywordScore,
          seniorityScore: result.seniorityScore,
          geoScore: result.geoScore,
          compScore: result.compScore,
          penalty: result.penalty,
          cluster: result.cluster,
          matchedKeywords: result.matchedKeywords,
          missingKeywords: result.missingKeywords,
          reasons: result.reasons,
          blockers: result.blockers,
          scorerVersion: SCORER_VERSION,
          scoredAt: new Date().toISOString(),
        },
      });
    scored++;
  }

  return { scored, skipped: 0, topFit, fxDate: fx?.date, fxWarning };
}
