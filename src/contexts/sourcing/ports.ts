/**
 * Portas do contexto de captura por termo.
 *
 * Duas, e só duas, porque só duas absorvem variação real:
 *
 *  - `TermCaptureQueuePort` — hoje uma tabela drenada por `after()` e pela
 *    varredura; a ADR 0009 já nomeia a fila hospedada como substituta quando o
 *    runtime web precisar (ADR-007).
 *  - `PlatformQuotaPort` — o livro de cota. Hoje uma tabela com upsert
 *    condicional; um contador compartilhado em outro serviço é a troca óbvia.
 *
 * Atribuição, fonte `~terms` e leituras de saúde não têm porta: uma
 * implementação, nenhuma alternativa plausível (ADR 0007).
 */
import type { FetchableSourceKind, PlatformBudget } from "../../core/sources/types.ts";
import type { FailureCode } from "./domain/capture.ts";

export type CaptureOrigin = "web" | "sweep" | "cli";

export type CaptureStatus = "queued" | "running" | "succeeded" | "waiting_quota" | "failed" | "skipped";

export type SkipCode = "platform_disabled" | "ingestion_blocked";

export type CaptureOutcome =
  | {
      status: "succeeded";
      fetched: number;
      created: number;
      known: number;
      attributed: number;
      totalHint: number | null;
    }
  | { status: "waiting_quota"; retryAt: string }
  | { status: "failed"; code: FailureCode; retryable: boolean }
  | { status: "skipped"; code: SkipCode };

export type CaptureRequest = {
  platform: FetchableSourceKind;
  termKey: string;
  query: string;
  windowDay: string;
  origin: CaptureOrigin;
  priority: number;
  /** A platform switched off in the configuration is recorded as skipped. */
  skipped?: SkipCode;
};

export type ClaimedCapture = {
  id: number;
  platform: FetchableSourceKind;
  termKey: string;
  query: string;
  windowDay: string;
};

export interface TermCaptureQueuePort {
  /** Idempotent on (platform, term key, day): one call serves everyone. */
  enqueue(rows: CaptureRequest[]): Promise<{ created: number; existing: number }>;
  claim(worker: string, now: Date): Promise<ClaimedCapture | null>;
  finish(id: number, outcome: CaptureOutcome, now: Date): Promise<void>;
}

export interface PlatformQuotaPort {
  reserve(
    platform: FetchableSourceKind,
    budget: PlatformBudget,
    now: Date,
  ): Promise<{ ok: true } | { ok: false; retryAt: string }>;
  /** A 429: nothing more goes to the platform until the next UTC day. */
  exhaustDay(platform: FetchableSourceKind, now: Date): Promise<void>;
}
