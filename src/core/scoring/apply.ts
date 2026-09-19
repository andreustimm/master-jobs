/**
 * Persisting scores. Separated from the pure scorer so the scoring logic stays
 * trivially unit-testable with no database in the picture.
 *
 * Scores are per target track (ADR-008, ADR-009): the primary track scores
 * every open job; an accepted track scores only the jobs relevant to it. This
 * module is the only writer of `job_score`.
 */
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type DB } from "../db/client.ts";
import { candidate, job, jobScore } from "../db/schema.ts";
import { ageInDays, loadRates, STALE_AFTER_DAYS } from "../../contexts/fx/index.ts";
import {
  ensureMatchingProfile,
  isRelevant,
  trackScoringProfiles,
  type ResultadoPerfil,
  type Track,
} from "../../contexts/matching/index.ts";
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

type TrackContext = ScoringContext & {
  track: Track;
  profileHash: string;
  fx: Awaited<ReturnType<typeof loadRates>>;
  fxWarning?: string;
};

export const FRESHNESS_RESCORE_AFTER_HOURS = 24;

/**
 * The scoring context of every active track, or null for a pending primary.
 *
 * Without an own profile there is nothing to score against: using the default
 * profile would give this person another person's ranking (M-06).
 */
async function loadTrackContexts(candidateId: number): Promise<TrackContext[] | null> {
  const profiles = await trackScoringProfiles(candidateId);
  if (!profiles) return null;
  const asOf = Date.now();
  const rates = new Map<string, Awaited<ReturnType<typeof loadRates>>>();

  const contexts: TrackContext[] = [];
  for (const { track, profile, hash } of profiles) {
    const reference = profile.compensation.reference_currency;
    // Loaded once per run: scoring stays pure and offline, and every job in a
    // run is graded against the same quote.
    if (!rates.has(reference)) rates.set(reference, await loadRates(reference));
    const fx = rates.get(reference) ?? null;
    let fxWarning: string | undefined;
    if (!fx) {
      fxWarning = "Sem cotações em cache — vagas em outras moedas não serão comparadas. Rode `jho fx refresh`.";
    } else if (ageInDays(fx) > STALE_AFTER_DAYS) {
      fxWarning = `Cotações de ${fx.date} têm mais de ${STALE_AFTER_DAYS} dias. Rode \`jho fx refresh\`.`;
    }
    contexts.push({ track, profile, profileHash: hash, fx, fxWarning, asOf });
  }
  return contexts;
}

/** Cem scores por comando: poucas idas ao banco, parâmetros bem abaixo do limite do protocolo. */
const LOTE = 100;

type Writer = Pick<DB, "insert">;

function scoreValues(result: ScoreResult, context: TrackContext) {
  const scoredAt = new Date(context.asOf).toISOString();
  return {
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
}

type ScoreField = keyof ReturnType<typeof scoreValues>;

const SCORE_COLUMNS = getTableColumns(jobScore);

/** Each rewritten field taken from the row the insert proposed. */
function fromExcluded(fields: ScoreField[]): Record<ScoreField, SQL> {
  return Object.fromEntries(
    fields.map((field) => [field, sql`excluded.${sql.identifier(SCORE_COLUMNS[field].name)}`]),
  ) as Record<ScoreField, SQL>;
}

/**
 * Upsert a batch of one track's scores in a single statement.
 *
 * One statement per score cost a network round trip each, and the daily sweep
 * runs far from the database: re-grading every open posting for freshness took
 * longer than the sweep's whole hour.
 */
function upsertScores(
  db: Writer,
  candidateId: number,
  rows: { jobId: number; result: ScoreResult }[],
  context: TrackContext,
) {
  const values = rows.map(({ jobId, result }) => ({
    candidateId,
    trackId: context.track.id,
    jobId,
    ...scoreValues(result, context),
  }));
  const fields = Object.keys(scoreValues(rows[0]!.result, context)) as ScoreField[];
  return db
    .insert(jobScore)
    .values(values)
    .onConflictDoUpdate({
      target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId],
      set: fromExcluded(fields),
    });
}

/**
 * Drop every score of a job, for every candidate and track.
 *
 * Called when the posting's content changes: the old notes graded a text that
 * no longer exists, and keeping any track's row would leave that ranking stale.
 * Returns how many rows were dropped.
 */
export async function deleteJobScores(db: Pick<DB, "delete">, jobId: number): Promise<number> {
  const rows = await db
    .delete(jobScore)
    .where(eq(jobScore.jobId, jobId))
    .returning({ candidateId: jobScore.candidateId });
  return rows.length;
}

const JOB_COLUMNS = {
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
};

/** Does this track score this job? The primary always does; accepted tracks only when relevant. */
function scores(context: TrackContext, row: { title: string; descriptionText: string | null }): boolean {
  return (
    context.track.isPrimary ||
    isRelevant(context.track.target!, { title: row.title, description: row.descriptionText })
  );
}

/**
 * Score one known job through the exact same profiles and scorer as a full run.
 *
 * Returns the primary track's result, which is what single-fit callers show;
 * `null` when the job does not exist or the candidate has a pending primary.
 */
export async function scoreOne(candidateId: number, jobId: number): Promise<ScoreResult | null> {
  const db = getDb();
  const contexts = await loadTrackContexts(candidateId);
  if (!contexts) return null;
  const [row] = await db.select(JOB_COLUMNS).from(job).where(eq(job.id, jobId)).limit(1);
  if (!row) return null;

  let primary: ScoreResult | null = null;
  for (const context of contexts) {
    if (!scores(context, row)) {
      await db
        .delete(jobScore)
        .where(
          and(
            eq(jobScore.candidateId, candidateId),
            eq(jobScore.trackId, context.track.id),
            eq(jobScore.jobId, jobId),
          ),
        );
      continue;
    }
    const result = scoreJob(row, context);
    await upsertScores(db, candidateId, [{ jobId: row.id, result }], context);
    if (context.track.isPrimary) primary = result;
  }
  return primary;
}

export type TrackFit = {
  trackId: number;
  name: string;
  isPrimary: boolean;
  /** No stored row for this track: the fit was computed now and not persisted. */
  computed: boolean;
  fit: number;
  cluster: string;
  titleScore: number;
  keywordScore: number;
  seniorityScore: number;
  geoScore: number;
  compScore: number;
  freshnessScore: number;
  benefitScore: number;
  penalty: number;
  matchedKeywords: unknown;
  missingKeywords: unknown;
  reasons: unknown;
  blockers: unknown;
};

/**
 * The job's fit under every active track, for the job detail.
 *
 * An accepted track has no row for a job outside its relevance gate, and a
 * track created a minute ago has none yet. The detail still shows that fit,
 * computed here with the same scorer — but writing it would put a job into a
 * track's ranking that the gate keeps out, so nothing is persisted.
 * `null` for a missing job or a pending primary.
 */
export async function trackFitsForJob(candidateId: number, jobId: number): Promise<TrackFit[] | null> {
  const db = getDb();
  const contexts = await loadTrackContexts(candidateId);
  if (!contexts) return null;
  const [row] = await db.select(JOB_COLUMNS).from(job).where(eq(job.id, jobId)).limit(1);
  if (!row) return null;
  const stored = new Map(
    (
      await db
        .select()
        .from(jobScore)
        .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.jobId, jobId)))
    ).map((score) => [score.trackId, score]),
  );

  return contexts.map((context) => {
    const track = { trackId: context.track.id, name: context.track.name, isPrimary: context.track.isPrimary };
    const saved = stored.get(context.track.id);
    const score = saved ?? scoreJob(row, context);
    return {
      ...track,
      computed: saved === undefined,
      fit: score.fit,
      cluster: score.cluster,
      titleScore: score.titleScore,
      keywordScore: score.keywordScore,
      seniorityScore: score.seniorityScore,
      geoScore: score.geoScore,
      compScore: score.compScore,
      freshnessScore: score.freshnessScore,
      benefitScore: score.benefitScore,
      penalty: score.penalty,
      matchedKeywords: score.matchedKeywords,
      missingKeywords: score.missingKeywords,
      reasons: score.reasons,
      blockers: score.blockers,
    };
  });
}

/**
 * Score every open job whose score is missing or stale, on every active track.
 *
 * Stale means another scorer version, another effective profile (the track or
 * the person changed) or older than the freshness window. `all: true` rescores
 * everything. On an accepted track, a job that stopped being relevant loses its
 * row: it is outside that track now.
 */
export async function scoreAll(
  candidateId: number,
  opts: { all?: boolean } = {},
): Promise<ScoreRunResult> {
  const db = getDb();
  const contexts = await loadTrackContexts(candidateId);
  if (!contexts) return { scored: 0, skipped: 0, topFit: 0 };

  let scored = 0;
  let skipped = 0;
  let topFit = 0;

  for (const context of contexts) {
    const freshnessCutoff = new Date(
      context.asOf - FRESHNESS_RESCORE_AFTER_HOURS * 3_600_000,
    ).toISOString();
    const rows = await db
      .select({ ...JOB_COLUMNS, existing: jobScore.jobId })
      .from(job)
      .leftJoin(
        jobScore,
        and(
          eq(jobScore.jobId, job.id),
          eq(jobScore.candidateId, candidateId),
          eq(jobScore.trackId, context.track.id),
        ),
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

    // Calcula antes e persiste em lotes: cada lote é um único comando, atômico.
    type Gravacao = { jobId: number; result: ScoreResult };
    let pendentes: Gravacao[] = [];
    const descarregar = async () => {
      if (pendentes.length === 0) return;
      await upsertScores(db, candidateId, pendentes, context);
      pendentes = [];
    };

    const outside: number[] = [];
    for (const row of rows) {
      if (!scores(context, row)) {
        if (row.existing !== null) outside.push(row.id);
        skipped++;
        continue;
      }
      const result = scoreJob(row, context);
      if (context.track.isPrimary) topFit = Math.max(topFit, result.fit);
      pendentes.push({ jobId: row.id, result });
      scored++;
      if (pendentes.length >= LOTE) await descarregar();
    }
    await descarregar();

    for (let offset = 0; offset < outside.length; offset += LOTE) {
      await db
        .delete(jobScore)
        .where(
          and(
            eq(jobScore.candidateId, candidateId),
            eq(jobScore.trackId, context.track.id),
            inArray(jobScore.jobId, outside.slice(offset, offset + LOTE)),
          ),
        );
    }
  }

  const primary = contexts.find((context) => context.track.isPrimary);
  return {
    scored,
    skipped,
    topFit,
    fxDate: primary?.fx?.date,
    fxWarning: primary?.fxWarning,
  };
}

export type ResultadoPorCandidato = {
  candidateId: number;
  slug: string;
  perfil: ResultadoPerfil["estado"];
  scored: number;
  topFit: number;
};

/**
 * Pontua TODOS os candidatos, derivando o perfil de quem ainda não tem.
 *
 * ## Por que existe
 *
 * `scoreAll` recebe um candidato, e todo chamador passava `activeCandidateId()`
 * — o candidato padrão. O resultado, no banco de produção: 8.768 pontuações,
 * todas do candidato 1, e board sem ranking para qualquer outra pessoa que
 * entrasse. A tabela sempre foi por candidato; o que faltava era alguém
 * percorrer a lista.
 *
 * ## Por que aqui, e não no carregamento da página
 *
 * Mesmo em lote, pontuar um candidato novo contra o acervo inteiro é trabalho de
 * segundos e milhares de escritas. Fazer isso enquanto alguém espera uma página
 * seria trocar "board sem ranking" por "board que não carrega" — pior, porque o
 * primeiro pelo menos explica o que fazer.
 *
 * A varredura diária já roda e já é o lugar onde o acervo muda. Quem acabou de
 * subir um currículo não precisa esperar até amanhã: `jho jobs score` sem
 * argumento continua pontuando só o candidato ativo, na hora.
 *
 * ## Por que um candidato quebrado não derruba os outros
 *
 * Perfil ilegível ou currículo corrompido é problema de uma pessoa. Abortar a
 * varredura inteira por causa disso deixaria todo mundo sem pontuação nova, e o
 * relatório no fim é o que expõe quem falhou.
 */
export async function scoreEveryCandidate(
  opts: { all?: boolean } = {},
): Promise<ResultadoPorCandidato[]> {
  const candidatos = await getDb()
    .select({ id: candidate.id, slug: candidate.slug })
    .from(candidate)
    .orderBy(candidate.id);

  const resultados: ResultadoPorCandidato[] = [];

  for (const c of candidatos) {
    let perfil: ResultadoPerfil["estado"] = "sem-curriculo";
    try {
      perfil = (await ensureMatchingProfile(c.id)).estado;

      // Sem perfil próprio, NÃO pontua.
      //
      // A alternativa seria pontuar com o perfil padrão da instalação, e foi o
      // que esta função fazia até ser exercitada contra dados reais: o
      // candidato 2 do banco de dev, que não tem currículo, começou a receber
      // 2.757 pontuações calculadas com o perfil de outra pessoa. Seria
      // reintroduzir, por outro caminho, exatamente o problema que o M-06
      // existe para resolver — com o agravante de o ranking PARECER dele.
      //
      // Board sem ranking é o estado honesto: a tela convida a subir um
      // currículo, e é disso que o perfil sai.
      if (perfil !== "ja-tinha" && perfil !== "derivado") {
        resultados.push({ candidateId: c.id, slug: c.slug, perfil, scored: 0, topFit: 0 });
        continue;
      }

      const r = await scoreAll(c.id, opts);
      resultados.push({ candidateId: c.id, slug: c.slug, perfil, scored: r.scored, topFit: r.topFit });
    } catch {
      // Registrado como zero e seguido adiante. O chamador vê a linha com
      // `scored: 0` e sabe onde olhar.
      resultados.push({ candidateId: c.id, slug: c.slug, perfil, scored: 0, topFit: 0 });
    }
  }

  return resultados;
}
