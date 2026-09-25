/**
 * Qual trilha um leitor de `job_score` enxerga.
 *
 * `job_score` guarda uma nota por (candidato, trilha, vaga). Todo leitor tem de
 * escolher uma: a principal por padrão, uma trilha escolhida, ou "todas" — a
 * melhor linha de cada vaga. Esquecer a escolha misturaria trilhas numa lista
 * só, e um teste de arquitetura exige que todo arquivo que lê `jobScore`
 * passe por aqui (ADR-008).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { jobScore, targetTrack } from "../../../core/db/schema.ts";
import type { Track } from "../domain/track.ts";
import { listTracks } from "../infra/drizzle-tracks.ts";

export type TrackChoice = { kind: "primary" } | { kind: "track"; trackId: number } | { kind: "all" };

export type TrackScope = {
  candidateId: number;
  primaryTrackId: number;
  /** Um id para uma trilha; todos os ativos para "todas". */
  trackIds: number[];
  mode: "single" | "best";
  /** A trilha pedida não é do candidato ou está arquivada: caiu na principal. */
  notice?: "track_unknown";
};

/**
 * `null` quando a principal está pendente: não há nota para mostrar.
 *
 * `known` é a lista de trilhas do candidato que o chamador já leu. A tela de
 * vagas as lê para o seletor e pedia de novo aqui — a mesma consulta duas
 * vezes, em série, cada uma um round-trip. Sem `known`, lê como sempre.
 */
export async function trackScope(
  candidateId: number,
  choice: TrackChoice,
  known?: Track[],
): Promise<TrackScope | null> {
  const tracks = known ?? (await listTracks(candidateId));
  const primary = tracks.find((track) => track.isPrimary);
  if (!primary?.target) return null;
  const active = tracks.filter((track) => track.status === "active" && track.target);
  const base = { candidateId, primaryTrackId: primary.id };
  if (choice.kind === "all") return { ...base, trackIds: active.map((track) => track.id), mode: "best" };
  if (choice.kind === "track") {
    const chosen = active.find((track) => track.id === choice.trackId);
    if (chosen) return { ...base, trackIds: [chosen.id], mode: "single" };
    return { ...base, trackIds: [primary.id], mode: "single", notice: "track_unknown" };
  }
  return { ...base, trackIds: [primary.id], mode: "single" };
}

/**
 * O predicado sobre a linha de `job_score` já ligada ao candidato.
 *
 * Em "todas", fica a linha da trilha em que a vaga pontua melhor; empate vai
 * para a principal e depois para a trilha listada primeiro. A subconsulta é
 * correlacionada à própria linha, então funciona em qualquer junção.
 */
export function scoreTrackFilter(scope: TrackScope): SQL {
  if (scope.mode === "single") return eq(jobScore.trackId, scope.trackIds[0]!);
  return sql`${jobScore.trackId} = (
    select best.track_id from ${jobScore} best
    join ${targetTrack} best_track on best_track.id = best.track_id
    where best.candidate_id = ${jobScore.candidateId}
      and best.job_id = ${jobScore.jobId}
      and best_track.status = 'active'
    order by best.fit desc, best_track.is_primary desc, best_track.position asc, best_track.id asc
    limit 1
  )`;
}

/**
 * Só linhas da trilha principal — para quem mostra uma nota por vaga sem que o
 * leitor tenha escolhido trilha (dossiê, relatório, exportação), e para as
 * leituras entre candidatos (`max(fit)` da verificação e da raspagem).
 *
 * `alias` serve ao SQL cru que apelida a tabela (`job_score s`).
 */
export function primaryScoreFilter(alias?: string): SQL {
  if (alias !== undefined && !/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`invalid alias ${alias}`);
  const column = alias === undefined ? sql`${jobScore.trackId}` : sql.raw(`${alias}.track_id`);
  return sql`exists (select 1 from ${targetTrack} pt where pt.id = ${column} and pt.is_primary)`;
}

/**
 * Só a linha da trilha principal DESTE candidato — o mesmo conjunto de
 * `primaryScoreFilter` para quem já sabe de quem é a nota.
 *
 * `primaryScoreFilter` pergunta, linha por linha, se a trilha da nota é uma
 * principal: um `exists` correlacionado que o planner resolve com um laço sobre
 * `job_score_job_idx` e `target_track`. No cockpit isso custava 20 mil blocos
 * por leitura (#222). Aqui a principal é uma subconsulta escalar, calculada uma
 * vez, e a junção usa a chave primária `(candidato, trilha, vaga)`.
 */
export function candidatePrimaryScoreFilter(candidateId: number, alias?: string): SQL {
  if (alias !== undefined && !/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`invalid alias ${alias}`);
  const column = alias === undefined ? sql`${jobScore.trackId}` : sql.raw(`${alias}.track_id`);
  return sql`${column} = (select pt.id from ${targetTrack} pt where pt.candidate_id = ${candidateId} and pt.is_primary)`;
}

/**
 * A melhor nota de cada vaga entre candidatos, só nas trilhas principais, como
 * CTE: `job_score` é agregado UMA vez por consulta e ligado à vaga por junção.
 *
 * A forma anterior era uma subconsulta correlacionada por vaga, repetida no
 * WHERE e no ORDER BY — foi ela que leu 77,4 milhões de linhas por varredura
 * no incidente de cota de 03/09. A trilha aceita fica de fora pelo mesmo
 * motivo de `primaryScoreFilter` (ADR-008).
 */
export function bestPrimaryFitByJob() {
  const db = getDb();
  return db.$with("best_primary_fit").as(
    db
      .select({ jobId: jobScore.jobId, fit: sql<number>`max(${jobScore.fit})`.as("best_fit") })
      .from(jobScore)
      .where(primaryScoreFilter())
      .groupBy(jobScore.jobId),
  );
}

/** Quantas vagas cada trilha do candidato tem pontuadas — para `jho tracks list`. */
export async function scoredJobsPerTrack(candidateId: number): Promise<Map<number, number>> {
  const tracks = await listTracks(candidateId);
  const primaryTrackId = tracks.find((track) => track.isPrimary)?.id ?? 0;
  const counts = new Map<number, number>();
  for (const track of tracks) {
    const scope: TrackScope = { candidateId, primaryTrackId, trackIds: [track.id], mode: "single" };
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)` })
      .from(jobScore)
      .where(and(eq(jobScore.candidateId, candidateId), scoreTrackFilter(scope)));
    counts.set(track.id, Number(row?.n ?? 0));
  }
  return counts;
}

/**
 * O filtro de cluster só vale para clusters da trilha escolhida. Um cluster de
 * outra trilha na URL cai fora com aviso, em vez de devolver lista vazia sem
 * explicação.
 */
export async function resolveClusterFilter(
  scope: TrackScope,
  cluster: string | undefined,
  known?: Track[],
): Promise<{ cluster?: string; notice?: "cluster_unknown" }> {
  if (!cluster) return {};
  const tracks = (known ?? (await listTracks(scope.candidateId))).filter((track) => scope.trackIds.includes(track.id));
  const allowed = new Set(["other", ...tracks.flatMap((track) => Object.keys(track.target?.targets.clusters ?? {}))]);
  return allowed.has(cluster) ? { cluster } : { notice: "cluster_unknown" };
}
