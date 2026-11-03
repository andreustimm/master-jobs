"use client";

import type { FormEvent } from "react";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNavigationSignal } from "../../mutation-feedback";
import type { SignupActionResult } from "../actions";

export type VerifyLabels = {
  code: string;
  submit: string;
  resend: string;
  /** Com `{seconds}`, trocado a cada segundo. */
  resendIn: string;
  resent: string;
};

type State = { message: string | null };

function fill(template: string, key: string, value: number): string {
  return template.replace(`{${key}}`, String(value));
}

/**
 * O código e o reenvio (US-017).
 *
 * O campo aceita colar e o preenchimento automático de código de uso único
 * (`autocomplete="one-time-code"`); quem extrai os dígitos é o servidor
 * (`normalizeCode`). O reenvio fica desabilitado com contagem regressiva até a
 * espera de 60 s passar (US-017.EC-8) — a contagem começa do que o servidor
 * calculou, e o servidor recusa de novo se alguém forçar o clique.
 */
export function VerifyForm({
  confirm,
  resend,
  labels,
  messages,
  initialResendIn,
  resendSeconds,
  initialMessage,
}: {
  confirm: (formData: FormData) => Promise<SignupActionResult>;
  resend: () => Promise<SignupActionResult | { ok: true }>;
  labels: VerifyLabels;
  messages: Record<string, string>;
  initialResendIn: number;
  resendSeconds: number;
  initialMessage: string | null;
}) {
  const [wait, setWait] = useState(initialResendIn);
  const [status, setStatus] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_previous: State, formData: FormData): Promise<State> => {
      try {
        const result = await confirm(formData);
        if (result && result.ok === false) {
          const template = messages[result.code] ?? messages.generic ?? "";
          return { message: fill(template, "count", result.attemptsLeft ?? 0) };
        }
        return { message: null };
      } catch (error) {
        if (isNavigationSignal(error)) throw error;
        return { message: messages.generic ?? null };
      }
    },
    { message: initialMessage },
  );
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const submitKeepingFields = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const requestResend = async () => {
    setStatus(null);
    setResendMessage(null);
    const result = await resend();
    if (result.ok) {
      setStatus(labels.resent);
      setWait(resendSeconds);
      return;
    }
    if (result.code === "resend_wait" && result.retryInSeconds) {
      setWait(result.retryInSeconds);
      return;
    }
    setResendMessage(messages[result.code] ?? messages.generic ?? null);
  };

  const message = resendMessage ?? state.message;

  return (
    <div className="grid gap-4">
      <form action={formAction} onSubmit={submitKeepingFields} aria-busy={pending || undefined} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="verify-code">{labels.code}</Label>
          <Input
            id="verify-code"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={32}
            className="font-mono"
            data-testid="verify-code"
          />
        </div>
        {message && (
          <p className="type-body-sm text-[var(--color-alert)]" role="alert" data-testid="verify-error">
            {message}
          </p>
        )}
        <Button type="submit" disabled={pending} data-testid="verify-submit">
          {labels.submit}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={wait > 0}
          onClick={() => void requestResend()}
          data-testid="verify-resend"
        >
          {wait > 0 ? fill(labels.resendIn, "seconds", wait) : labels.resend}
        </Button>
        {status && (
          <p className="type-body-sm text-muted-foreground" role="status" data-testid="verify-status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
