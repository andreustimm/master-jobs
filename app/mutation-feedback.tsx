"use client";

import type { FormHTMLAttributes, ReactNode } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { CircleAlert, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const MUTATION_FEEDBACK_MS = 5_000;
export const MUTATION_FEEDBACK_EVENT = "master-jobs:mutation-feedback";

export type MutationFeedbackPayload = {
  id?: string;
  kind: "success" | "error";
  message: string;
};

type MutationFeedbackState = {
  status: "idle" | "success" | "error";
};

const INITIAL_MUTATION_FEEDBACK: MutationFeedbackState = { status: "idle" };

type MutationAction = (formData: FormData) => Promise<unknown>;

function isFailedResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  if ("status" in result && result.status === "error") return true;
  return "ok" in result && result.ok === false;
}

function isNavigationSignal(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return String(error.digest).startsWith("NEXT_");
}

export function publishMutationFeedback(payload: MutationFeedbackPayload): void {
  window.dispatchEvent(new CustomEvent<MutationFeedbackPayload>(MUTATION_FEEDBACK_EVENT, {
    detail: payload,
  }));
}

export function MutationFeedbackHost({
  initial,
  dismissLabel,
}: {
  initial?: MutationFeedbackPayload | null;
  dismissLabel: string;
}) {
  const [feedback, setFeedback] = useState<MutationFeedbackPayload | null>(initial ?? null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      const payload = (event as CustomEvent<MutationFeedbackPayload>).detail;
      if (!payload || (payload.kind !== "success" && payload.kind !== "error")) return;
      setFeedback(payload);
    };
    window.addEventListener(MUTATION_FEEDBACK_EVENT, receive);
    // Flash cookies are intentionally non-HTTP-only so the host can consume
    // them after a redirect without showing the same notice on the next page.
    document.cookie = "jho_mutation_feedback=; Max-Age=0; Path=/; SameSite=Lax";
    return () => window.removeEventListener(MUTATION_FEEDBACK_EVENT, receive);
  }, []);

  // A redirect from a Server Action can update the existing root layout via a
  // client navigation instead of remounting it. Keep the host in sync with a
  // flash notice that arrived in the refreshed server props as well as with
  // notices dispatched by an already-mounted form.
  useEffect(() => {
    if (!initial) return;
    setFeedback(initial);
    document.cookie = "jho_mutation_feedback=; Max-Age=0; Path=/; SameSite=Lax";
  }, [initial?.id, initial?.kind, initial?.message]);

  useEffect(() => {
    if (!feedback) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setFeedback(null);
    }, MUTATION_FEEDBACK_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [feedback]);

  if (!feedback) return null;
  return (
    <MutationNotice
      kind={feedback.kind}
      message={feedback.message}
      dismissLabel={dismissLabel}
      onDismiss={() => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        setFeedback(null);
      }}
    />
  );
}

export function MutationNotice({
  kind,
  message,
  dismissLabel,
  onDismiss,
  testId = "mutation-feedback",
}: {
  kind: "success" | "error";
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  testId?: string;
}) {
  const isError = kind === "error";

  return (
    <div
      data-testid={testId}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "fixed z-50 flex items-start gap-3 rounded-[var(--radius-surface)] border",
        "bg-card px-4 py-3 text-card-foreground shadow-lg",
        isError ? "border-[var(--bad)]" : "border-[var(--good)]",
      )}
      style={{
        top: "max(var(--spacing-md), env(safe-area-inset-top))",
        right: "max(var(--spacing-md), env(safe-area-inset-right))",
        width:
          "min(calc(100vw - max(var(--spacing-md), env(safe-area-inset-left)) - max(var(--spacing-md), env(safe-area-inset-right))), 24rem)",
      }}
    >
      {isError ? (
        <CircleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--bad)]" />
      ) : (
        <CheckCircle2 aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--good)]" />
      )}
      <p className="type-body-sm min-w-0 flex-1">{message}</p>
      <button
        type="button"
        data-testid={`${testId}-dismiss`}
        aria-label={dismissLabel}
        onClick={onDismiss}
        className={cn(
          "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-action)]",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-[var(--primary-text)]",
        )}
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

export function MutationFeedbackForm({
  action,
  successMessage,
  errorMessage,
  dismissLabel,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: MutationAction;
  successMessage: string;
  errorMessage: string;
  dismissLabel: string;
  children: ReactNode;
}) {
  const [, formAction, pending] = useActionState(
    async (_previous: MutationFeedbackState, formData: FormData): Promise<MutationFeedbackState> => {
      try {
        const result = await action(formData);
        const kind = isFailedResult(result) ? "error" : "success";
        publishMutationFeedback({
          kind,
          message: kind === "success" ? successMessage : errorMessage,
        });
        return { status: kind };
      } catch (error) {
        // Next uses a thrown control-flow signal for redirect/notFound. Let it
        // reach the router; only ordinary action failures become feedback.
        if (isNavigationSignal(error)) throw error;
        publishMutationFeedback({ kind: "error", message: errorMessage });
        return { status: "error" };
      }
    },
    INITIAL_MUTATION_FEEDBACK,
  );

  return (
    <form {...props} action={formAction} aria-busy={pending || undefined}>
      {children}
    </form>
  );
}
