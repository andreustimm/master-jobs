/**
 * Casos de uso dos termos salvos. Orquestração burra: regras em
 * `domain/saved-term.ts`, SQL em `infra/`, captura pela API pública do
 * contexto de sourcing — que nunca fica sabendo quem salvou o termo.
 *
 * O candidato vem sempre do escopo da sessão; id de termo ou de trilha na
 * entrada é pedido, conferido contra esse escopo.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { isDuplicateKey } from "../../../core/db/retry.ts";
import { savedTerm } from "../../../core/db/schema.ts";
import { validateTerm, type TermError } from "../../../core/term.ts";
import {
  captureHistory,
  captureStatusFor,
  capturesAllowed,
  dailyRepeatPaused,
  lastSweepCaptureAt,
  requestTermCaptures,
  retryFailedCaptures,
  windowStarts,
  type PlatformCaptureState,
} from "../../sourcing/index.ts";
import {
  MAX_ACTIVE_TERMS,
  ZERO_STREAK_DAYS,
  cooldownState,
  termStatus,
  zeroStreak,
  type TermRunState,
} from "../domain/saved-term.ts";
import {
  activeKeys,
  countActiveTerms,
  countNewJobs,
  findTerm,
  findTermByKey,
  listTerms,
} from "../infra/drizzle-saved-terms.ts";
import { findTrack, lockCandidateTracks } from "../infra/drizzle-tracks.ts";
import { ensurePrimaryTrack } from "./tracks.ts";

/** O candidato da sessão. Nunca vem do formulário. */
export type CandidateScope = { candidateId: number };

export type ActionContext = { now: Date; impersonated: boolean };

export type SaveTermResult =
  | { ok: true; termId: number; run: "started" | "waiting_sweep" | "captures_off" | "no_platform" }
  | { ok: false; code: "term_duplicate"; termId: number }
  | {
      ok: false;
      code: TermError | "term_limit" | "track_required" | "track_archived" | "primary_pending";
    };

type RunRequest = { termKey: string; query: string; now: Date };

async function startRun(
  request: RunRequest,
  writer?: Parameters<typeof requestTermCaptures>[1],
): Promise<"started" | "captures_off" | "no_platform"> {
  const result = await requestTermCaptures({ ...request, origin: "web" }, writer);
  if (result.skipped === "ingestion_blocked") return "captures_off";
  if (result.skipped === "no_platform") return "no_platform";
  return "started";
}

/**
 * Salva o termo numa trilha e pede a primeira busca, numa transação só.
 *
 * Termo sem captura, ou captura sem termo, seria um meio-salvo que a tela não
 * sabe explicar. Sessão emprestada salva, mas não dispara busca: a varredura
 * diária busca por ela (ADR-004 item 7).
 */
export async function saveTerm(
  scope: CandidateScope,
  input: { term: string; trackId: number | null },
  ctx: ActionContext,
): Promise<SaveTermResult> {
  const valid = validateTerm(input.term);
  if (!valid.ok) return { ok: false, code: valid.code };
  if (!(await ensurePrimaryTrack(scope.candidateId))) return { ok: false, code: "primary_pending" };
  if (input.trackId === null || !Number.isInteger(input.trackId)) return { ok: false, code: "track_required" };
  const trackId = input.trackId;
  const { term, key } = valid.value;
  const runs = !ctx.impersonated && capturesAllowed();
  const stamp = ctx.now.toISOString();

  try {
    return await getDb().transaction(async (tx): Promise<SaveTermResult> => {
      await lockCandidateTracks(tx, scope.candidateId);
      const track = await findTrack(scope.candidateId, trackId, tx);
      if (!track) return { ok: false, code: "track_required" };
      if (track.status === "archived") return { ok: false, code: "track_archived" };
      const existing = await findTermByKey(scope.candidateId, key, tx);
      if (existing) return { ok: false, code: "term_duplicate", termId: existing.id };
      if ((await countActiveTerms(tx, scope.candidateId)) >= MAX_ACTIVE_TERMS) return { ok: false, code: "term_limit" };

      const [row] = await tx
        .insert(savedTerm)
        .values({
          candidateId: scope.candidateId,
          trackId,
          term,
          termKey: key,
          status: "active",
          lastRunRequestedAt: runs ? stamp : null,
          updatedAt: stamp,
        })
        .returning({ id: savedTerm.id });
      if (ctx.impersonated) return { ok: true, termId: row!.id, run: "waiting_sweep" };
      return { ok: true, termId: row!.id, run: await startRun({ termKey: key, query: term, now: ctx.now }, tx) };
    });
  } catch (error) {
    // Dois envios simultâneos do mesmo termo: o índice único escolhe um.
    if (!isDuplicateKey(error)) throw error;
    const winner = await findTermByKey(scope.candidateId, key);
    return winner ? { ok: false, code: "term_duplicate", termId: winner.id } : { ok: false, code: "term_limit" };
  }
}

export type RerunResult =
  | { ok: true; run: "started" | "waiting_sweep" | "captures_off" }
  | { ok: false; code: "cooldown"; availableAt: string }
  | { ok: false; code: "not_found" | "running" };

/**
 * Busca de novo, a pedido. Uma vez a cada 24 horas; dentro da janela, só a
 * plataforma que falhou hoje é tentada outra vez — a que respondeu não é
 * chamada duas vezes.
 */
export async function rerunTerm(scope: CandidateScope, termId: number, ctx: ActionContext): Promise<RerunResult> {
  const term = await findTerm(scope.candidateId, termId);
  if (!term) return { ok: false, code: "not_found" };
  if (ctx.impersonated) return { ok: true, run: "waiting_sweep" };
  if (!capturesAllowed()) return { ok: true, run: "captures_off" };

  const today = (await captureStatusFor([term.termKey], ctx.now)).get(term.termKey) ?? [];
  if (today.some((state) => state.today && (state.status === "queued" || state.status === "running"))) {
    return { ok: false, code: "running" };
  }
  const cooldown = cooldownState(term.lastRunRequestedAt, ctx.now);
  if (!cooldown.allowed) {
    if ((await retryFailedCaptures(term.termKey, ctx.now)) > 0) return { ok: true, run: "started" };
    return { ok: false, code: "cooldown", availableAt: cooldown.availableAt };
  }

  // A âncora avança só para quem a leu: de dois cliques simultâneos, um pede
  // a busca e o outro vê a busca já pedida.
  const claimed = await getDb()
    .update(savedTerm)
    .set({ lastRunRequestedAt: ctx.now.toISOString(), updatedAt: ctx.now.toISOString() })
    .where(
      and(
        eq(savedTerm.id, term.id),
        sql`${savedTerm.lastRunRequestedAt} is not distinct from ${term.lastRunRequestedAt}`,
      ),
    )
    .returning({ id: savedTerm.id });
  if (claimed.length === 0) return { ok: true, run: "started" };
  const run = await startRun({ termKey: term.termKey, query: term.term, now: ctx.now });
  return { ok: true, run: run === "captures_off" ? "captures_off" : "started" };
}

/** Pausar tira o termo da varredura; retomar respeita o limite de ativos. */
export async function setTermStatus(
  scope: CandidateScope,
  termId: number,
  status: "active" | "paused",
  now = new Date(),
): Promise<{ ok: boolean; code?: "not_found" | "term_limit" }> {
  return getDb().transaction(async (tx) => {
    await lockCandidateTracks(tx, scope.candidateId);
    const term = await findTerm(scope.candidateId, termId, tx);
    if (!term) return { ok: false, code: "not_found" as const };
    if (term.status === status) return { ok: true };
    if (status === "active" && (await countActiveTerms(tx, scope.candidateId)) >= MAX_ACTIVE_TERMS) {
      return { ok: false, code: "term_limit" as const };
    }
    await tx
      .update(savedTerm)
      .set({ status, pausedReason: status === "paused" ? "manual" : null, updatedAt: now.toISOString() })
      .where(eq(savedTerm.id, term.id));
    return { ok: true };
  });
}

export async function moveTerm(
  scope: CandidateScope,
  termId: number,
  trackId: number,
  now = new Date(),
): Promise<{ ok: boolean; code?: "not_found" | "track_archived" }> {
  return getDb().transaction(async (tx) => {
    await lockCandidateTracks(tx, scope.candidateId);
    const term = await findTerm(scope.candidateId, termId, tx);
    const track = await findTrack(scope.candidateId, trackId, tx);
    if (!term || !track) return { ok: false, code: "not_found" as const };
    if (track.status === "archived") return { ok: false, code: "track_archived" as const };
    await tx.update(savedTerm).set({ trackId, updatedAt: now.toISOString() }).where(eq(savedTerm.id, term.id));
    return { ok: true };
  });
}

/**
 * Apaga o termo. As vagas que ele trouxe continuam — com a atribuição, com as
 * candidaturas, com tudo: o termo era o pedido, não o dono das vagas.
 */
export async function deleteTerm(scope: CandidateScope, termId: number): Promise<{ ok: boolean }> {
  await getDb()
    .delete(savedTerm)
    .where(and(eq(savedTerm.candidateId, scope.candidateId), eq(savedTerm.id, termId)));
  return { ok: true };
}

/** Vagas abertas trazidas pelo termo e ainda não vistas no filtro dele. */
export async function newCount(scope: CandidateScope, termId: number): Promise<number | null> {
  const term = await findTerm(scope.candidateId, termId);
  return term ? countNewJobs(term.termKey, term.lastVisitAt) : null;
}

/** As chaves que a varredura diária busca: cada termo ativo uma vez. */
export async function activeTermKeys(): Promise<Array<{ termKey: string; query: string }>> {
  return activeKeys();
}

export type TermView = {
  id: number;
  term: string;
  termKey: string;
  trackId: number;
  status: "active" | "paused";
  pausedReason: string | null;
  run: TermRunState;
  /** Today's result came from an earlier request, without a new call. */
  reused: boolean;
  platforms: PlatformCaptureState[];
  newCount: number;
  lastVisitAt: string | null;
  notice: "no_results_14d" | null;
  rerun: { allowed: true } | { allowed: false; availableAt: string };
};

export type TermOverview = {
  /** Ingestion is not permitted here: terms are saved, nothing is fetched. */
  capturesOff: boolean;
  /** No capture from the daily sweep in 36 hours. */
  dailyRepeatPaused: boolean;
  terms: TermView[];
};

/** Os termos do candidato com o estado de cada plataforma. Só leitura. */
export async function termOverview(scope: CandidateScope, now: Date): Promise<TermOverview> {
  const terms = await listTerms(scope.candidateId);
  const keys = terms.map((term) => term.termKey);
  const since = windowStarts(new Date(now.getTime() - ZERO_STREAK_DAYS * 86_400_000)).day;
  const [states, history, lastSweep] = await Promise.all([
    captureStatusFor(keys, now),
    captureHistory(keys, since),
    lastSweepCaptureAt(),
  ]);
  const capturesOff = !capturesAllowed();

  const views: TermView[] = [];
  for (const term of terms) {
    const platforms = states.get(term.termKey) ?? [];
    const run = termStatus(platforms);
    views.push({
      id: term.id,
      term: term.term,
      termKey: term.termKey,
      trackId: term.trackId,
      status: term.status === "paused" ? "paused" : "active",
      pausedReason: term.pausedReason,
      run: run === "never_run" && capturesOff ? "captures_off" : run,
      reused: platforms.some((state) => state.today && state.reused),
      platforms,
      newCount: await countNewJobs(term.termKey, term.lastVisitAt),
      lastVisitAt: term.lastVisitAt,
      notice: zeroStreak(history.filter((capture) => capture.termKey === term.termKey)),
      rerun: cooldownState(term.lastRunRequestedAt, now),
    });
  }
  return { capturesOff, dailyRepeatPaused: dailyRepeatPaused(lastSweep, now), terms: views };
}
