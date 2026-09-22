/**
 * Armazenamento das trilhas. Adapter burro: lê, grava e mapeia colunas para o
 * tipo do domínio. As regras moram em `domain/track.ts`.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DB } from "../../../core/db/client.ts";
import { candidate, savedTerm, targetTrack } from "../../../core/db/schema.ts";
import type { Track, TrackStatus, TrackTarget, UnreviewedField } from "../domain/track.ts";

type Executor = Pick<DB, "select" | "insert" | "update" | "execute">;
type Row = typeof targetTrack.$inferSelect;

export function toTrack(row: Row): Track {
  return {
    id: row.id,
    candidateId: row.candidateId,
    name: row.name,
    isPrimary: row.isPrimary,
    status: row.status as TrackStatus,
    position: row.position,
    target: row.targetJson ? (JSON.parse(row.targetJson) as TrackTarget) : null,
    unreviewed: JSON.parse(row.unreviewedJson) as UnreviewedField[],
    updatedAt: row.updatedAt,
  };
}

/** Primary first, then display order: the order every screen and tie-break uses. */
export async function listTracks(candidateId: number, db: Executor = getDb()): Promise<Track[]> {
  const rows = await db
    .select()
    .from(targetTrack)
    .where(eq(targetTrack.candidateId, candidateId))
    .orderBy(sql`${targetTrack.isPrimary} desc`, asc(targetTrack.position), asc(targetTrack.id));
  return rows.map(toTrack);
}

export async function findTrack(
  candidateId: number,
  trackId: number,
  db: Executor = getDb(),
): Promise<Track | null> {
  const [row] = await db
    .select()
    .from(targetTrack)
    .where(and(eq(targetTrack.candidateId, candidateId), eq(targetTrack.id, trackId)))
    .limit(1);
  return row ? toTrack(row) : null;
}

/**
 * Serializa as mudanças de trilha de um candidato.
 *
 * Sem isto, duas promoções concorrentes a principal leem o mesmo estado e a
 * segunda esbarra no índice de principal única; duas criações contam o mesmo
 * total e passam juntas do limite de seis.
 */
export async function lockCandidateTracks(db: Executor, candidateId: number): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('target_track'), ${candidateId})`);
}

export async function isOwner(candidateId: number, db: Executor = getDb()): Promise<boolean> {
  // O dono é UM candidato padrão, e não qualquer linha marcada:
  // `ensureCandidate` marcava como padrão todo candidato que criava, inclusive
  // o de cada convidado cadastrado em /admin/users, e essas linhas continuam no
  // banco. Com a marca sozinha, o convidado era pontuado — e via as trilhas —
  // pelo `profile.yaml` do dono, piso salarial incluído.
  const [row] = await db
    .select({ id: candidate.id })
    .from(candidate)
    .where(eq(candidate.isDefault, true))
    // O slug `default` primeiro — é o que `syncCandidateFromProfile` cria —, e
    // o id só desempata instalações sem ele.
    .orderBy(sql`${candidate.slug} = 'default' desc`, asc(candidate.id))
    .limit(1);
  return row?.id === candidateId;
}

export async function nextPosition(db: Executor, candidateId: number): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${targetTrack.position}), 0)` })
    .from(targetTrack)
    .where(eq(targetTrack.candidateId, candidateId));
  return Number(row?.max ?? 0) + 1;
}

export async function countActive(db: Executor, candidateId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(targetTrack)
    .where(and(eq(targetTrack.candidateId, candidateId), eq(targetTrack.status, "active")));
  return Number(row?.n ?? 0);
}

/** Pausa os termos ativos da trilha arquivada, marcando o motivo. */
export async function pauseTermsOf(db: Executor, trackId: number, now: string): Promise<void> {
  await db
    .update(savedTerm)
    .set({ status: "paused", pausedReason: "track_archived", updatedAt: now })
    .where(and(eq(savedTerm.trackId, trackId), eq(savedTerm.status, "active")));
}

/**
 * Retoma só o que o arquivamento pausou — pausa manual continua pausa — e só
 * até `limit`: as vagas que o arquivamento liberou podem ter sido ocupadas. Os
 * que sobram ficam pausados com o mesmo motivo, na ordem em que foram salvos.
 */
export async function resumeTermsOf(db: Executor, trackId: number, now: string, limit: number): Promise<void> {
  if (limit <= 0) return;
  const rows = await db
    .select({ id: savedTerm.id })
    .from(savedTerm)
    .where(and(eq(savedTerm.trackId, trackId), eq(savedTerm.pausedReason, "track_archived")))
    .orderBy(asc(savedTerm.id))
    .limit(limit);
  if (rows.length === 0) return;
  await db
    .update(savedTerm)
    .set({ status: "active", pausedReason: null, updatedAt: now })
    .where(inArray(savedTerm.id, rows.map((row) => row.id)));
}
