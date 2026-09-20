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
  MAX_TERM_REQUESTS_PER_DAY,
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
  recordTermRequest,
} from "../infra/drizzle-saved-terms.ts";
import { findTrack, lockCandidateTracks } from "../infra/drizzle-tracks.ts";
import { ensurePrimaryTrack } from "./tracks.ts";

/** O candidato da sessão. Nunca vem do formulário. */
export type CandidateScope = { candidateId: number };

export type ActionContext = { now: Date; impersonated: boolean };

export type SaveTermResult =
  | { ok: true; termId: number; run: "started" | "waiting_sweep" | "captures_off" | "no_platform" | "daily_limit" }
  | { ok: false; code: "term_duplicate"; termId: number }
  | {
      ok: false;
      code: TermError | "term_limit" | "track_required" | "track_archived" | "primary_pending";
    };

type RunRequest = { termKey: string; query: string; now: Date };

export type TermAvailability =
  | { ok: true }
  | { ok: false; code: "term_duplicate"; termId: number }
  | { ok: false; code: TermError | "term_limit" };

/**
 * O termo poderia ser salvo agora? A criação de trilha comita sozinha; conferir
 * antes é o que impede uma recusa do termo de deixar uma trilha órfã e um
 * formulário que só responde "nome já existe".
 */
export async function termAvailability(scope: CandidateScope, rawTerm: string): Promise<TermAvailability> {
  const valid = validateTerm(rawTerm);
  if (!valid.ok) return { ok: false, code: valid.code };
  const existing = await findTermByKey(scope.candidateId, valid.value.key);
  if (existing) return { ok: false, code: "term_duplicate", termId: existing.id };
  if ((await countActiveTerms(getDb(), scope.candidateId)) >= MAX_ACTIVE_TERMS) return { ok: false, code: "term_limit" };
  return { ok: true };
}

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
  const wantsRun = !ctx.impersonated && capturesAllowed();
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
      const overDailyLimit =
        wantsRun &&
        (await recordTermRequest(tx, scope.candidateId, windowStarts(ctx.now).day, stamp)) > MAX_TERM_REQUESTS_PER_DAY;
      const runs = wantsRun && !overDailyLimit;

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
      if (overDailyLimit) return { ok: true, termId: row!.id, run: "daily_limit" };
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
  | { ok: true; run: "started" | "waiting_sweep" | "captures_off" | "no_platform" }
  | { ok: false; code: "cooldown"; availableAt: string }
  | { ok: false; code: "not_found" | "running" | "paused" | "request_limit" };

/**
 * Busca de novo, a pedido. Uma vez a cada 24 horas; dentro da janela, só a
 * plataforma que falhou hoje é tentada outra vez — a que respondeu não é
 * chamada duas vezes.
 */
export async function rerunTerm(scope: CandidateScope, termId: number, ctx: ActionContext): Promise<RerunResult> {
  const term = await findTerm(scope.candidateId, termId);
  if (!term) return { ok: false, code: "not_found" };
  // Pausar é "nem sozinho, nem pela mão" (US-011); arquivar a trilha também pausa.
  if (term.status === "paused") return { ok: false, code: "paused" };
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

  if (
    (await recordTermRequest(getDb(), scope.candidateId, windowStarts(ctx.now).day, ctx.now.toISOString())) >
    MAX_TERM_REQUESTS_PER_DAY
  ) {
    return { ok: false, code: "request_limit" };
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
  if (run === "no_platform") {
    // Nada foi buscado: a âncora de 24 horas volta para quem a tinha.
    await getDb()
      .update(savedTerm)
      .set({ lastRunRequestedAt: term.lastRunRequestedAt })
      .where(eq(savedTerm.id, term.id));
    return { ok: true, run: "no_platform" };
  }
  // O enfileiramento só reaproveita a captura bem-sucedida de hoje; a que
  // falhou hoje precisa voltar para a fila explicitamente.
  if (run === "started") await retryFailedCaptures(term.termKey, ctx.now);
  return { ok: true, run };
}

/**
 * Pausar tira o termo da varredura; retomar respeita o limite de ativos e recusa
 * trilha arquivada — a varredura só lê termos de trilha ativa, então um termo
 * "ativo" ali ocuparia vaga sem nunca rodar.
 */
export async function setTermStatus(
  scope: CandidateScope,
  termId: number,
  status: "active" | "paused",
  now = new Date(),
): Promise<{ ok: boolean; code?: "not_found" | "term_limit" | "track_archived" }> {
  return getDb().transaction(async (tx) => {
    await lockCandidateTracks(tx, scope.candidateId);
    const term = await findTerm(scope.candidateId, termId, tx);
    if (!term) return { ok: false, code: "not_found" as const };
    if (term.status === status) return { ok: true };
    if (status === "active") {
      const track = await findTrack(scope.candidateId, term.trackId, tx);
      if (!track || track.status === "archived") return { ok: false, code: "track_archived" as const };
      if ((await countActiveTerms(tx, scope.candidateId)) >= MAX_ACTIVE_TERMS) {
        return { ok: false, code: "term_limit" as const };
      }
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

export type SavedTermSummary = {
  id: number;
  term: string;
  termKey: string;
  trackId: number;
  status: "active" | "paused";
  lastVisitAt: string | null;
};

function summary(term: Awaited<ReturnType<typeof listTerms>>[number]): SavedTermSummary {
  return {
    id: term.id,
    term: term.term,
    termKey: term.termKey,
    trackId: term.trackId,
    status: term.status === "paused" ? "paused" : "active",
    lastVisitAt: term.lastVisitAt,
  };
}

/** Os termos do candidato, para o seletor "trazida por" da tela Vagas. */
export async function listSavedTerms(scope: CandidateScope): Promise<SavedTermSummary[]> {
  return (await listTerms(scope.candidateId)).map(summary);
}

/**
 * O termo do filtro "trazida por", com o estado da última busca — é o que a
 * tela diz quando o filtro volta vazio. `null` para termo de outra pessoa ou
 * apagado: o id da URL é pedido, não prova.
 */
export async function savedTermForBoard(
  scope: CandidateScope,
  termId: number,
  now: Date,
): Promise<(SavedTermSummary & { run: TermRunState }) | null> {
  const term = await findTerm(scope.candidateId, termId);
  if (!term) return null;
  const platforms = (await captureStatusFor([term.termKey], now)).get(term.termKey) ?? [];
  const run = termStatus(platforms);
  return { ...summary(term), run: run === "never_run" && !capturesAllowed() ? "captures_off" : run };
}

/**
 * Marca a visita ao filtro do termo. Chamado depois da resposta: a página
 * marca as vagas novas contra a visita ANTERIOR, e só então a âncora avança.
 */
export async function recordTermVisit(scope: CandidateScope, termId: number, at: Date): Promise<void> {
  await getDb()
    .update(savedTerm)
    .set({ lastVisitAt: at.toISOString() })
    .where(and(eq(savedTerm.candidateId, scope.candidateId), eq(savedTerm.id, termId)));
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
  // Duas de cada vez, nunca três: o pool tem três conexões, e um caminho que
  // pede as três exatas deixa a requisição concorrente esperando até a Vercel
  // matar as duas aos 30 segundos. Foi assim que `/candidate/skills` travava.
  const [states, history] = await Promise.all([
    captureStatusFor(keys, now),
    captureHistory(keys, since),
  ]);
  const lastSweep = await lastSweepCaptureAt();
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
