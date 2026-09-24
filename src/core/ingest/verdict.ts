/**
 * O caminho único de um veredito de verificação (#223, tarefa 04).
 *
 * Antes havia dois: a fila (`recordVerdict`) atualizava a vaga e concluía a
 * tarefa em comandos soltos, e o lote (`jho jobs verify`) fechava a vaga sem
 * registrar veredito nenhum. Agora os dois passam por `applyVerdict`, que
 * grava o evento e o estado da vaga na MESMA transação; concluir a
 * `verify_task` continua só na fila.
 *
 * As decisões são puras e moram fora daqui: o que fecha é `classify` de
 * `probe.ts` (só 404/410, G26), o que reabre é `decideReopen` de
 * `lifecycle.ts`, o motivo é `reasonFor` e a ordem é `decidesState`.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { redactDetail, EVIDENCE_MAX } from "../../contexts/operations/domain/runs.ts";
import { clock } from "../clock.ts";
import { getDb } from "../db/client.ts";
import { job, jobCheckEvent } from "../db/schema.ts";
import {
  AVAILABILITY_STALE_MS,
  currentAvailability,
  decidesState,
  gateInstant,
  latestEvent,
  reasonFor,
  reconcileAvailability,
  type Availability,
  type StatusReason,
} from "./availability.ts";
import { decideReopen, type ReopenDecision } from "./lifecycle.ts";
import type { ProbeVerdict } from "./probe.ts";

export type JobAvailability = {
  state: Availability;
  /** A checagem mais recente, conclusiva ou não; nula quando nunca houve. */
  lastCheckedAt: string | null;
  reason: StatusReason;
};

/**
 * O que a tela da vaga mostra: estado derivado dos eventos (puro, em
 * `availability.ts`), conciliado com `closed_at` da vaga — o sync fecha e
 * reabre sem evento —, e a data da última checagem. Vaga verificada antes de
 * os eventos existirem é "desconhecida", mas a data vem de `job.checked_at`:
 * ela foi conferida, e dizer "nunca" seria falso.
 */
export async function jobAvailability(jobId: number, now = clock().iso()): Promise<JobAvailability> {
  const db = getDb();
  const [row] = await db.select({ closedAt: job.closedAt, checkedAt: job.checkedAt }).from(job).where(eq(job.id, jobId));
  const events = await db
    .select({ id: jobCheckEvent.id, checkedAt: jobCheckEvent.checkedAt, verdict: jobCheckEvent.verdict, reason: jobCheckEvent.reason })
    .from(jobCheckEvent)
    .where(eq(jobCheckEvent.jobId, jobId));
  const typed = events.map((event) => ({ ...event, verdict: event.verdict as ProbeVerdict }));
  const state = reconcileAvailability(currentAvailability(typed, now, AVAILABILITY_STALE_MS), row?.closedAt ?? null);
  const last = latestEvent(typed);
  const decisive = latestEvent(typed.filter((event) => event.verdict !== "inconclusive"));
  return {
    state,
    lastCheckedAt: last?.checkedAt ?? row?.checkedAt ?? null,
    // Só um 404/410 sustenta motivo; encerrada pelo sync fica sem motivo provado.
    reason: state === "closed" && decisive?.verdict === "gone" ? (decisive.reason as StatusReason) : "unknown",
  };
}

export type AppliedVerdict = {
  /** `false` quando a vaga não existe mais: nada foi gravado. */
  found: boolean;
  /** `false` quando já havia evento mais novo: o evento entra, o estado fica. */
  changedState: boolean;
  reopen: ReopenDecision;
};

/**
 * Grava o veredito de `jobId`. `checkedAt` padrão é agora; um evento mais
 * antigo que o último gravado entra no histórico e não mexe no estado —
 * chegada fora de ordem não reabre nem fecha a vaga.
 */
export async function applyVerdict(input: {
  jobId: number;
  verdict: ProbeVerdict;
  httpCode: number | null;
  runId?: number | null;
  evidence?: string | null;
  checkedAt?: string;
}): Promise<AppliedVerdict> {
  const checkedAt = input.checkedAt ?? clock().iso();
  return getDb().transaction(async (tx) => {
    // Trava a linha da vaga: dois vereditos simultâneos da mesma vaga decidem
    // em fila, e o segundo vê o evento do primeiro.
    const [current] = await tx
      .select({ closedAt: job.closedAt, archivedAt: job.archivedAt })
      .from(job)
      .where(eq(job.id, input.jobId))
      .for("update");
    if (!current) return { found: false, changedState: false, reopen: { kind: "noop", reason: "not-alive" } };

    const newestOf = async (onlyConclusive: boolean) => {
      const [row] = await tx
        .select({ checkedAt: jobCheckEvent.checkedAt })
        .from(jobCheckEvent)
        .where(
          onlyConclusive
            ? and(eq(jobCheckEvent.jobId, input.jobId), ne(jobCheckEvent.verdict, "inconclusive"))
            : eq(jobCheckEvent.jobId, input.jobId),
        )
        .orderBy(desc(jobCheckEvent.checkedAt), desc(jobCheckEvent.id))
        .limit(1);
      return row?.checkedAt ?? null;
    };
    const newest = { any: await newestOf(false), conclusive: await newestOf(true) };

    await tx.insert(jobCheckEvent).values({
      jobId: input.jobId,
      runId: input.runId ?? null,
      checkedAt,
      verdict: input.verdict,
      httpCode: input.httpCode,
      reason: reasonFor(input.verdict),
      evidence: input.evidence ? redactDetail(input.evidence, EVIDENCE_MAX) : null,
    });

    if (!decidesState(checkedAt, gateInstant(input.verdict, newest))) {
      return { found: true, changedState: false, reopen: { kind: "noop", reason: "not-alive" } };
    }

    const reopen = decideReopen({ verdict: input.verdict, closedAt: current.closedAt, archivedAt: current.archivedAt });
    const patch: Partial<typeof job.$inferInsert> = {
      // A última checagem só anda para frente: um conclusivo que decide depois
      // de um inconclusivo mais novo muda o estado, não o relógio.
      checkedAt: newest.any !== null && newest.any > checkedAt ? newest.any : checkedAt,
      checkStatus: input.verdict,
      checkCode: input.httpCode,
    };
    // Fechada, não apagada — ADR 0005: uma candidatura pode apontar para ela.
    // Só `gone` fecha, e só 404/410 viram `gone` (G26).
    if (input.verdict === "gone" && current.closedAt === null) patch.closedAt = checkedAt;
    if (reopen.kind === "reopen") {
      patch.closedAt = null;
      // Um `alive` desfaz também o arquivamento automático: a vaga que voltou a
      // responder volta ao quadro inteira, não meio escondida.
      if (reopen.clearsArchive) patch.archivedAt = null;
    }
    await tx.update(job).set(patch).where(eq(job.id, input.jobId));
    return { found: true, changedState: true, reopen };
  });
}
