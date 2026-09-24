/**
 * Persisting scores. Separated from the pure scorer so the scoring logic stays
 * trivially unit-testable with no database in the picture.
 *
 * Scores are per target track (ADR-008, ADR-009): the primary track scores
 * every open job; an accepted track scores only the jobs relevant to it. This
 * module is the only writer of `job_score`.
 */
import { and, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { clock } from "../clock.ts";
import { getDb, type DB } from "../db/client.ts";
import { candidate, job, jobScore, scoreCursor } from "../db/schema.ts";
import {
  SCORE_BATCH,
  afterBatch,
  mayStartBatch,
  startPosition,
  type BatchPosition,
  type StoredCursor,
} from "./batch.ts";
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
  /** False when `deadline` stopped the run with stale scores left for the next one. */
  complete: boolean;
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
    } else if (ageInDays(fx, new Date(asOf)) > STALE_AFTER_DAYS) {
      fxWarning = `Cotações de ${fx.date} têm mais de ${STALE_AFTER_DAYS} dias. Rode \`jho fx refresh\`.`;
    }
    contexts.push({ track, profile, profileHash: hash, fx, fxWarning, asOf });
  }
  return contexts;
}

/**
 * A ordem da passada: mais recente primeiro. Precisa ser idêntica à expressão
 * do índice `job_recency_open_idx` em `schema.ts`, ou o planner não o usa.
 * `first_seen_at` nunca é nulo, então a chave também não.
 */
const RECENCY = sql<string>`coalesce(${job.postedAt}, ${job.firstSeenAt})`;

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

/** O cursor gravado de uma trilha, ou `null` quando ela nunca foi percorrida. */
async function readCursor(db: DB, candidateId: number, trackId: number): Promise<StoredCursor | null> {
  const [row] = await db
    .select()
    .from(scoreCursor)
    .where(and(eq(scoreCursor.candidateId, candidateId), eq(scoreCursor.trackId, trackId)))
    .limit(1);
  if (!row) return null;
  const position =
    row.positionKey !== null && row.positionJobId !== null ? { key: row.positionKey, jobId: row.positionJobId } : null;
  return { profileHash: row.profileHash, scorerVersion: row.scorerVersion, position, lastCompletedAt: row.lastCompletedAt };
}

/**
 * Grava onde a passada parou. `last_completed_at` nunca volta a nulo: um lote
 * do meio não apaga o registro de que a trilha já completou uma passada — é
 * ele que tira o candidato da fila "sem nota".
 */
async function writeCursor(
  db: DB,
  candidateId: number,
  context: TrackContext,
  next: { position: BatchPosition | null; completedAt: string | null },
): Promise<void> {
  const values = {
    profileHash: context.profileHash,
    scorerVersion: SCORER_VERSION,
    positionKey: next.position?.key ?? null,
    positionJobId: next.position?.jobId ?? null,
    updatedAt: clock().iso(),
  };
  await db
    .insert(scoreCursor)
    .values({
      candidateId,
      trackId: context.track.id,
      ...values,
      lastCompletedAt: next.completedAt,
      firstCompletedAt: next.completedAt,
    })
    .onConflictDoUpdate({
      target: [scoreCursor.candidateId, scoreCursor.trackId],
      set: {
        ...values,
        lastCompletedAt: sql`coalesce(excluded.last_completed_at, ${scoreCursor.lastCompletedAt})`,
        // A primeira só é gravada uma vez: é a medida de "tempo até completo".
        firstCompletedAt: sql`coalesce(${scoreCursor.firstCompletedAt}, excluded.first_completed_at)`,
      },
    });
}

/**
 * Score every open job whose score is missing or stale, on every active track.
 *
 * Stale means another scorer version, another effective profile (the track or
 * the person changed) or older than the freshness window. `all: true` rescores
 * everything. On an accepted track, a job that stopped being relevant loses its
 * row: it is outside that track now.
 *
 * Em lotes de cem, da vaga mais recente para a mais antiga, retomando de onde
 * a chamada anterior parou (`score_cursor`, regras em `batch.ts`). A trilha
 * principal vai primeiro: é a nota que a tela mostra. O cursor avança depois
 * de cada lote, mesmo que nada tenha sido gravado — a vaga fora do alvo de uma
 * trilha aceita nunca ganha linha, e sem avançar ela voltaria em todo lote.
 *
 * Com `deadline` (epoch ms, `clock()`), só começa um lote que caberia pelo mais
 * lento até ali, e devolve `complete: false` quando o prazo parou a passada; a
 * próxima execução retoma do cursor. Sem prazo, uma passada retomada do meio é
 * seguida de outra do topo, para que vaga nova acima do cursor não fique para
 * depois — é a CLI, que promete tudo em dia ao terminar.
 */
export async function scoreAll(
  candidateId: number,
  opts: { all?: boolean; deadline?: number } = {},
): Promise<ScoreRunResult> {
  const db = getDb();
  const contexts = await loadTrackContexts(candidateId);
  if (!contexts) return { scored: 0, skipped: 0, topFit: 0, complete: true };
  const ordered = [...contexts].sort((a, b) => Number(b.track.isPrimary) - Number(a.track.isPrimary));

  let scored = 0;
  let skipped = 0;
  let topFit = 0;
  let complete = true;
  // Só conta o lote que leu vaga: uma trilha já em dia responde com leitura
  // vazia, e ela não pode gastar o "primeiro lote sempre começa" da chamada —
  // senão a trilha seguinte nunca começaria com prazo curto.
  let batches = 0;
  let slowest = 0;

  for (const context of ordered) {
    const freshnessCutoff = new Date(
      context.asOf - FRESHNESS_RESCORE_AFTER_HOURS * 3_600_000,
    ).toISOString();
    const pending = opts.all
      ? undefined
      : sql`(
          ${jobScore.jobId} is null
          or ${jobScore.scorerVersion} <> ${SCORER_VERSION}
          or ${jobScore.profileHash} <> ${context.profileHash}
          or ${jobScore.scoredAt} < ${freshnessCutoff}
        )`;

    let position = startPosition(
      await readCursor(db, candidateId, context.track.id),
      { profileHash: context.profileHash, scorerVersion: SCORER_VERSION },
      { restart: opts.all },
    );
    let fromTop = position === null;

    for (;;) {
      if (!mayStartBatch({ batchesDone: batches, now: clock().now(), slowestMs: slowest }, opts.deadline)) {
        complete = false;
        break;
      }
      const began = clock().now();
      const rows = await db
        .select({ ...JOB_COLUMNS, key: RECENCY, existing: jobScore.jobId })
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
          and(
            isNull(job.closedAt),
            position ? sql`(${RECENCY}, ${job.id}) < (${position.key}, ${position.jobId})` : undefined,
            pending,
          ),
        )
        .orderBy(desc(RECENCY), desc(job.id))
        .limit(SCORE_BATCH);

      const writes: { jobId: number; result: ScoreResult }[] = [];
      const outside: number[] = [];
      for (const row of rows) {
        if (!scores(context, row)) {
          if (row.existing !== null) outside.push(row.id);
          skipped++;
          continue;
        }
        const result = scoreJob(row, context);
        if (context.track.isPrimary) topFit = Math.max(topFit, result.fit);
        writes.push({ jobId: row.id, result });
        scored++;
      }
      // Um comando por lote, atômico; o cursor vem depois das notas, então uma
      // função morta entre os dois só repete o lote.
      if (writes.length > 0) await upsertScores(db, candidateId, writes, context);
      if (outside.length > 0) {
        await db
          .delete(jobScore)
          .where(
            and(
              eq(jobScore.candidateId, candidateId),
              eq(jobScore.trackId, context.track.id),
              inArray(jobScore.jobId, outside),
            ),
          );
      }
      const next = afterBatch(
        rows.map((row) => ({ key: row.key, jobId: row.id })),
        SCORE_BATCH,
        clock().iso(),
      );
      await writeCursor(db, candidateId, context, next);
      if (rows.length > 0) batches++;
      slowest = Math.max(slowest, clock().now() - began);

      if (next.completedAt === null) {
        position = next.position;
        continue;
      }
      if (fromTop || opts.deadline !== undefined) break;
      position = null;
      fromTop = true;
    }
    if (!complete) break;
  }

  const primary = contexts.find((context) => context.track.isPrimary);
  return {
    scored,
    skipped,
    topFit,
    complete,
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
    const r = await scoreCandidate(c.id, opts);
    resultados.push({ candidateId: c.id, slug: c.slug, perfil: r.perfil, scored: r.scored, topFit: r.topFit });
  }
  return resultados;
}

export type ResultadoDoCandidato = {
  perfil: ResultadoPerfil["estado"];
  scored: number;
  topFit: number;
  /** Presente quando a pontuação lançou; o candidato conta como zero. */
  erro?: string;
};

/**
 * Pontua UM candidato, derivando o perfil se ele ainda não tiver. Nunca lança.
 *
 * É a unidade de `scoreEveryCandidate` e das fatias `sem-nota` e `manutencao`
 * da varredura (ADR 0025, #288): todas precisam da mesma regra — sem perfil
 * próprio, não pontua —, e duas cópias dela seriam duas chances de divergir.
 * `deadline` é o prazo da chamada da fatia; `scoreAll` para entre lotes.
 */
export async function scoreCandidate(
  candidateId: number,
  opts: { all?: boolean; deadline?: number } = {},
): Promise<ResultadoDoCandidato> {
  let perfil: ResultadoPerfil["estado"] = "sem-curriculo";
  try {
    perfil = (await ensureMatchingProfile(candidateId)).estado;

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
    if (perfil !== "ja-tinha" && perfil !== "derivado") return { perfil, scored: 0, topFit: 0 };

    const r = await scoreAll(candidateId, opts);
    return { perfil, scored: r.scored, topFit: r.topFit };
  } catch (erro) {
    // Registrado como zero e seguido adiante. O chamador vê `scored: 0` e o
    // erro, e sabe onde olhar.
    return { perfil, scored: 0, topFit: 0, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
