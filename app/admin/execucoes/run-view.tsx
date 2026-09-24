import { Badge } from "@/components/ui/badge";
import type { RunStatus, SourceRunRow } from "../../../src/contexts/operations/index.ts";
import type { Translator } from "../../../src/core/i18n/index.ts";

type T = Translator["t"];

/** Chave do dicionário por estado — texto nunca mora aqui (regra 9). */
export const RUN_STATUS_LABEL = {
  queued: "runs.statusQueued",
  running: "runs.statusRunning",
  succeeded: "runs.statusSucceeded",
  partial: "runs.statusPartial",
  failed: "runs.statusFailed",
  cancelled: "runs.statusCancelled",
  interrupted: "runs.statusInterrupted",
} as const satisfies Record<RunStatus, string>;

export const RUN_SCOPE_LABEL = {
  source: "runs.scopeSource",
  all: "runs.scopeAll",
  verify: "runs.scopeVerify",
} as const;

/** Motivo visível da espera ou da falha, por código estável de `source_run`. */
export const RUN_REASON_LABEL = {
  no_token: "runs.reasonNoToken",
  waiting_slot: "runs.reasonWaitingSlot",
  dispatch_rejected: "runs.reasonDispatchRejected",
  work_failed: "runs.reasonWorkFailed",
  children_failed: "runs.reasonChildrenFailed",
  lease_expired: "runs.reasonLeaseExpired",
} as const;

const COUNT_LABEL = {
  fetched: "runs.fetched",
  inserted: "runs.inserted",
  updated: "runs.updated",
  unchanged: "runs.unchanged",
  closed: "runs.closed",
  alive: "runs.alive",
  inconclusive: "runs.inconclusive",
} as const;

const CAPTURE_COUNTS = ["fetched", "inserted", "updated", "unchanged", "closed"] as const;
const VERIFY_COUNTS = ["fetched", "alive", "closed", "inconclusive"] as const;

function statusOf(run: SourceRunRow): RunStatus {
  return (run.status in RUN_STATUS_LABEL ? run.status : "failed") as RunStatus;
}

export function RunStatusBadge({ run, t }: { run: SourceRunRow; t: T }) {
  const status = statusOf(run);
  const variant = status === "succeeded" ? "default" : status === "failed" || status === "interrupted" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} data-testid={`run-status-${run.id}`} data-status={status}>
      {t(RUN_STATUS_LABEL[status])}
    </Badge>
  );
}

export function scopeLabel(run: SourceRunRow, t: T): string {
  const key = run.scopeKind in RUN_SCOPE_LABEL ? RUN_SCOPE_LABEL[run.scopeKind as keyof typeof RUN_SCOPE_LABEL] : RUN_SCOPE_LABEL.source;
  return t(key);
}

export function reasonLabel(run: SourceRunRow, t: T): string | null {
  if (!run.errorCode || !(run.errorCode in RUN_REASON_LABEL)) return null;
  return t(RUN_REASON_LABEL[run.errorCode as keyof typeof RUN_REASON_LABEL]);
}

/** Contagens da execução; nula aparece como "desconhecido", nunca zero (US-009.EC-2). */
export function RunCounts({ run, t }: { run: SourceRunRow; t: T }) {
  const keys = run.scopeKind === "verify" ? VERIFY_COUNTS : CAPTURE_COUNTS;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5" data-testid={`run-counts-${run.id}`}>
      {keys.map((key) => (
        <div key={key} className="min-w-0">
          <dt className="type-caption-sm text-muted-foreground">{t(COUNT_LABEL[key])}</dt>
          <dd className="type-body-md font-mono" data-testid={`run-count-${run.id}-${key}`} data-known={run[key] === null ? "false" : "true"}>
            {run[key] === null ? t("runs.unknown") : run[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
