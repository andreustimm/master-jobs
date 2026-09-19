/**
 * Regras do termo salvo. Puras: recebem o instante, nunca leem o relógio.
 */
import type { CaptureStatus } from "../../sourcing/index.ts";

/** Termos ativos por candidato. */
export const MAX_ACTIVE_TERMS = 20;
/**
 * Buscas pedidas pela tela por candidato, por dia UTC. O dobro do teto de
 * termos ativos: apagar e salvar de novo não zera a conta, então um ciclo de
 * salvar-apagar não ocupa as janelas por minuto de todo mundo.
 */
export const MAX_TERM_REQUESTS_PER_DAY = 40;

/** Uma busca manual por termo a cada 24 horas; a primeira conta (ADR-001). */
export const RERUN_COOLDOWN_MS = 24 * 3_600_000;

/** Dias seguidos sem nenhuma vaga que viram o aviso "sem resultado". */
export const ZERO_STREAK_DAYS = 14;

export function cooldownState(
  lastRunRequestedAt: string | null,
  now: Date,
): { allowed: true } | { allowed: false; availableAt: string } {
  if (!lastRunRequestedAt) return { allowed: true };
  const availableAt = Date.parse(lastRunRequestedAt) + RERUN_COOLDOWN_MS;
  return now.getTime() >= availableAt
    ? { allowed: true }
    : { allowed: false, availableAt: new Date(availableAt).toISOString() };
}

/** Vaga vista depois da última visita ao filtro do termo — ou nunca visitado. */
export function isNew(firstSeenAt: string, lastVisitAt: string | null): boolean {
  return lastVisitAt === null || firstSeenAt > lastVisitAt;
}

export type TermRunState =
  | "never_run"
  | "running"
  | "succeeded"
  | "partial"
  | "waiting_quota"
  | "failed"
  | "captures_off"
  | "no_platform";

/**
 * O estado do termo, somando as plataformas.
 *
 * Plataforma pulada não pesa quando outra rodou: "desligada no YAML" ao lado de
 * "trouxe 12" é uma captura que funcionou. Só quando todas foram puladas o
 * motivo vira o estado do termo.
 */
export function termStatus(
  states: ReadonlyArray<{ status: CaptureStatus; reasonCode: string | null }>,
): TermRunState {
  if (states.length === 0) return "never_run";
  if (states.some((state) => state.status === "queued" || state.status === "running")) return "running";
  const ran = states.filter((state) => state.status !== "skipped");
  if (ran.length === 0) {
    return states.every((state) => state.reasonCode === "ingestion_blocked") ? "captures_off" : "no_platform";
  }
  if (ran.some((state) => state.status === "waiting_quota")) return "waiting_quota";
  const failed = ran.filter((state) => state.status === "failed").length;
  if (failed === 0) return "succeeded";
  return failed === ran.length ? "failed" : "partial";
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Catorze dias UTC seguidos, até o mais recente, em que o termo rodou sem
 * trazer vaga nenhuma. O termo continua ativo — é aviso, não pausa.
 */
export function zeroStreak(
  captures: ReadonlyArray<{ windowDay: string; status: CaptureStatus; fetched: number }>,
): "no_results_14d" | null {
  const days = new Map<string, { succeeded: boolean; fetched: number }>();
  for (const capture of captures) {
    if (capture.status !== "succeeded") continue;
    const day = days.get(capture.windowDay) ?? { succeeded: true, fetched: 0 };
    day.fetched += capture.fetched;
    days.set(capture.windowDay, day);
  }
  let day = [...days.keys()].sort().at(-1);
  let streak = 0;
  while (day !== undefined && days.get(day)?.fetched === 0) {
    streak++;
    if (streak >= ZERO_STREAK_DAYS) return "no_results_14d";
    day = previousDay(day);
  }
  return null;
}
