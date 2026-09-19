/**
 * Armazenamento dos termos salvos. Adapter burro: lê, grava, mapeia.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DB } from "../../../core/db/client.ts";
import { job, savedTerm, savedTermRequest, targetTrack } from "../../../core/db/schema.ts";
import { attributedJobIds } from "../../sourcing/index.ts";

type Executor = Pick<DB, "select" | "insert" | "update" | "delete">;

export type SavedTerm = typeof savedTerm.$inferSelect;

export async function findTerm(candidateId: number, termId: number, db: Executor = getDb()): Promise<SavedTerm | null> {
  const [row] = await db
    .select()
    .from(savedTerm)
    .where(and(eq(savedTerm.candidateId, candidateId), eq(savedTerm.id, termId)))
    .limit(1);
  return row ?? null;
}

export async function findTermByKey(candidateId: number, termKey: string, db: Executor = getDb()): Promise<SavedTerm | null> {
  const [row] = await db
    .select()
    .from(savedTerm)
    .where(and(eq(savedTerm.candidateId, candidateId), eq(savedTerm.termKey, termKey)))
    .limit(1);
  return row ?? null;
}

/** Soma um pedido de busca do dia e devolve quantos o candidato já fez nele. */
export async function recordTermRequest(db: Executor, candidateId: number, windowDay: string, now: string): Promise<number> {
  const [row] = await db
    .insert(savedTermRequest)
    .values({ candidateId, windowDay, requested: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [savedTermRequest.candidateId, savedTermRequest.windowDay],
      set: { requested: sql`${savedTermRequest.requested} + 1`, updatedAt: now },
    })
    .returning({ requested: savedTermRequest.requested });
  return row!.requested;
}

export async function countActiveTerms(db: Executor, candidateId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(savedTerm)
    .where(and(eq(savedTerm.candidateId, candidateId), eq(savedTerm.status, "active")));
  return Number(row?.n ?? 0);
}

export async function listTerms(candidateId: number): Promise<SavedTerm[]> {
  return getDb()
    .select()
    .from(savedTerm)
    .where(eq(savedTerm.candidateId, candidateId))
    .orderBy(asc(savedTerm.createdAt), asc(savedTerm.id));
}

/**
 * Cada chave ativa uma vez, entre todos os candidatos: a varredura busca o
 * termo, não a pessoa. Termo pausado ou em trilha arquivada não entra. A
 * consulta enviada é a grafia de quem salvou primeiro.
 */
export async function activeKeys(): Promise<Array<{ termKey: string; query: string }>> {
  return getDb()
    .selectDistinctOn([savedTerm.termKey], { termKey: savedTerm.termKey, query: savedTerm.term })
    .from(savedTerm)
    .innerJoin(targetTrack, eq(targetTrack.id, savedTerm.trackId))
    .where(and(eq(savedTerm.status, "active"), eq(targetTrack.status, "active")))
    .orderBy(savedTerm.termKey, asc(savedTerm.createdAt), asc(savedTerm.id));
}

/** Vagas abertas que o termo trouxe e que apareceram depois da última visita. */
export async function countNewJobs(termKey: string, lastVisitAt: string | null): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(job)
    .where(
      and(
        sql`${job.id} in ${attributedJobIds(termKey)}`,
        isNull(job.closedAt),
        lastVisitAt === null ? undefined : sql`${job.firstSeenAt} > ${lastVisitAt}`,
      ),
    );
  return Number(row?.n ?? 0);
}
