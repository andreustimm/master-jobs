/**
 * Persisting scores. Separated from the pure scorer so the scoring logic stays
 * trivially unit-testable with no database in the picture.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { candidate, job, jobScore } from "../db/schema.ts";
import { ageInDays, loadRates, STALE_AFTER_DAYS } from "../../contexts/fx/index.ts";
import {
  ensureMatchingProfile,
  matchingProfile,
  type ResultadoPerfil,
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
