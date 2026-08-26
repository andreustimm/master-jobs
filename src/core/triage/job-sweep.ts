/**
 * Deterministic input preparation for the Compozy job sweep.
 *
 * The sweep worker must never receive a posting through a shell command's
 * stdout. Source descriptions are attacker-controlled text; this module writes
 * them to a workspace-local snapshot that a separate deny-all reviewer session
 * receives as parsed file-import data. The import carries data, not a tool or
 * filesystem capability.
 */
import { inArray, and, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { application, job, jobScore } from "../db/schema.ts";
import { listBoard } from "../db/repo.ts";
import { loadProfile } from "../profile/load.ts";

export type JobSweepSnapshotCandidate = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  fit: number | null;
  cluster: string | null;
  breakdown: {
    title: number | null;
    keywords: number | null;
    seniority: number | null;
    geography: number | null;
    compensation: number | null;
    freshness: number | null;
    benefits: number | null;
  };
  blockers: unknown;
  reasons: unknown;
  matchedKeywords: unknown;
  missingKeywords: unknown;
  pipelineStatus: string | null;
  description: string | null;
};

export type JobSweepSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  minFit: number;
  /** Source adapters that failed during the preceding sync. */
  sourcesFailed: string[];
  profile: {
    targets: Record<string, { titles: string[]; cvVariant: string }>;
    avoidTitles: string[];
    constraints: {
      workAuthorization: string[];
      remoteOnly: boolean;
      acceptableRegions: string[];
      contractModels: string[];
    };
    seniorityYears: number;
    evidence: Record<string, string[]>;
  };
  candidates: JobSweepSnapshotCandidate[];
};

function snapshotProfile(
  profile: Awaited<ReturnType<typeof loadProfile>>,
): JobSweepSnapshot["profile"] {
  return {
    targets: Object.fromEntries(
      Object.entries(profile.targets.clusters).map(([name, cluster]) => [name, {
        titles: cluster.titles,
        cvVariant: cluster.cv_variant,
      }]),
    ),
    avoidTitles: profile.targets.avoid_titles,
    constraints: {
      workAuthorization: profile.constraints.work_authorization,
      remoteOnly: profile.constraints.remote_only,
      acceptableRegions: profile.constraints.acceptable_regions,
      contractModels: profile.constraints.contract_models,
    },
    seniorityYears: profile.seniority.years_experience,
    evidence: profile.evidence,
  };
}

/**
 * Build the only source-content payload that the reviewer agent may read.
 * Nothing here mutates `application`; the query only reads the board and score.
 */
export async function buildJobSweepSnapshot(
  candidateId: number,
  minFit: number,
  limit: number,
  sourcesFailed: string[] = [],
): Promise<JobSweepSnapshot> {
  const profile = await loadProfile();
  const board = await listBoard(candidateId, {
    minFit,
    limit,
    sort: "fit",
  });
  const ids = board.map((row) => row.jobId);
  if (ids.length === 0) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      minFit,
      sourcesFailed,
      profile: snapshotProfile(profile),
      candidates: [],
    };
  }

  const details = await getDb()
    .select({ job, score: jobScore, application })
    .from(job)
    .leftJoin(
      jobScore,
      and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, candidateId)),
    )
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), eq(application.candidateId, candidateId)),
    )
    .where(inArray(job.id, ids));
  const byId = new Map(details.map((row) => [row.job.id, row]));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    minFit,
    sourcesFailed,
    profile: snapshotProfile(profile),
    candidates: board.map((row) => {
      const detail = byId.get(row.jobId);
      const score = detail?.score;
      return {
        id: row.jobId,
        title: row.title,
        company: row.companyName,
        location: row.locationRaw,
        url: row.applyUrl ?? row.url,
        postedAt: row.postedAt,
        firstSeenAt: row.firstSeenAt,
        fit: row.fit,
        cluster: row.cluster,
        breakdown: {
          title: row.titleScore,
          keywords: row.keywordScore,
          seniority: row.seniorityScore,
          geography: row.geoScore,
          compensation: row.compScore,
          freshness: row.freshnessScore,
          benefits: row.benefitScore,
        },
        blockers: row.blockers,
        reasons: row.reasons,
        matchedKeywords: score?.matchedKeywords ?? [],
        missingKeywords: score?.missingKeywords ?? [],
        pipelineStatus: detail?.application?.status ?? null,
        description: detail?.job.descriptionText ?? null,
      } satisfies JobSweepSnapshotCandidate;
    }),
  };
}
