/**
 * Saúde agregada de uma plataforma de captura por termo.
 *
 * Só contagens e códigos: nenhum campo carrega termo, consulta, chave de termo
 * ou candidato. A tela de administração mostra se a integração funciona; quem
 * busca o quê é privado (ADR-006).
 */
import type { FetchableSourceKind, PlatformBudget } from "../../../core/sources/types.ts";
import type { CaptureOrigin, CaptureStatus } from "../ports.ts";
import { dailyRepeatPaused } from "./windows.ts";

/** Dias UTC seguidos de captura falha que deixam a plataforma vermelha. */
export const RED_AFTER_FAILED_DAYS = 3;

export type CaptureRecord = {
  status: CaptureStatus;
  reasonCode: string | null;
  origin: CaptureOrigin;
  windowDay: string;
  termKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformHealth = {
  platform: FetchableSourceKind;
  validated: boolean;
  enabled: boolean;
  quota: {
    dayUsed: number | null;
    dayLimit: number | null;
    minuteUsed: number;
    minuteLimit: number | null;
    exhausted: boolean;
  };
  last24h: Record<CaptureStatus, number>;
  lastErrorCode: string | null;
  consecutiveFailedDays: number;
  activeTerms: number;
  dailyRepeatPaused: boolean;
  red: boolean;
};

const STATUSES: CaptureStatus[] = ["queued", "running", "succeeded", "waiting_quota", "failed", "skipped"];

/** Dias mais recentes primeiro; conta enquanto o dia só teve falha. */
function failedDaysInARow(records: readonly CaptureRecord[]): number {
  const byDay = new Map<string, { failed: boolean; succeeded: boolean }>();
  for (const record of records) {
    if (record.status !== "failed" && record.status !== "succeeded") continue;
    const day = byDay.get(record.windowDay) ?? { failed: false, succeeded: false };
    if (record.status === "failed") day.failed = true;
    else day.succeeded = true;
    byDay.set(record.windowDay, day);
  }
  let count = 0;
  for (const day of [...byDay.keys()].sort().reverse()) {
    const state = byDay.get(day)!;
    if (!state.failed || state.succeeded) break;
    count++;
  }
  return count;
}

export function summarizeHealth(input: {
  platform: FetchableSourceKind;
  validated: boolean;
  enabled: boolean;
  budget: PlatformBudget;
  quota: { dayUsed: number; minuteUsed: number; exhausted: boolean };
  records: readonly CaptureRecord[];
  now: Date;
}): PlatformHealth {
  const since = input.now.getTime() - 24 * 3_600_000;
  const recent = input.records.filter((record) => Date.parse(record.createdAt) >= since);
  const last24h = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<CaptureStatus, number>;
  for (const record of recent) last24h[record.status]++;

  const latestFailure = [...input.records]
    .filter((record) => record.status === "failed")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestTerminal = [...input.records]
    .filter((record) => record.status === "failed" || record.status === "succeeded")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const lastSweep = input.records
    .filter((record) => record.origin === "sweep")
    .map((record) => record.createdAt)
    .sort()
    .at(-1);
  const consecutiveFailedDays = failedDaysInARow(input.records);
  const endpointGone = latestTerminal?.status === "failed" && latestTerminal.reasonCode === "endpoint_gone";

  return {
    platform: input.platform,
    validated: input.validated,
    enabled: input.enabled,
    quota: {
      dayUsed: input.quota.exhausted ? (input.budget.perDay ?? null) : input.quota.dayUsed,
      dayLimit: input.budget.perDay ?? null,
      minuteUsed: input.quota.minuteUsed,
      minuteLimit: input.budget.perMinute ?? null,
      exhausted: input.quota.exhausted,
    },
    last24h,
    lastErrorCode: latestFailure?.reasonCode ?? null,
    consecutiveFailedDays,
    activeTerms: new Set(recent.map((record) => record.termKey)).size,
    dailyRepeatPaused: dailyRepeatPaused(lastSweep ?? null, input.now),
    red: consecutiveFailedDays >= RED_AFTER_FAILED_DAYS || endpointGone,
  };
}
