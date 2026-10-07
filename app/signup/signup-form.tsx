"use client";

import type { FormEvent } from "react";
import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isNavigationSignal } from "../mutation-feedback";
import type { SignupActionResult } from "./actions";

/** Os textos da tela, já traduzidos no servidor: o cliente não carrega o dicionário. */
export type SignupFormLabels = {
  roleLegend: string;
  roleCandidate: string;
  roleCandidateHint: string;
  roleRecruiter: string;
  roleRecruiterHint: string;
  name: string;
  headline: string;
  headlineHint: string;
  cv: string;
  cvHint: string;
  cvPdf: string;
  cvPdfHint: string;
  email: string;
  password: string;
  passwordHint: string;
  verifiedEmail: string;
  acceptLead: string;
  terms: string;
  acceptAnd: string;
  privacy: string;
  submit: string;
};

type State = { message: string | null };

/**
 * Os documentos abrem em outra aba: navegar na mesma levaria embora o que a
 * pessoa já digitou no formulário (US-021.AC-1).
 */
const LEGAL_HREF = { terms: "/terms", privacy: "/privacy" } as const;

/**
 * O formulário da tela única (ADR-007), nos dois modos.
 *
 * - **social**: o e-mail veio do provedor e aparece só para leitura; não há
 *   e-mail nem senha a digitar (US-004.AC-1);
 * - **manual**: e-mail e senha, e o envio leva ao código (US-016).
 *
 * O papel é o primeiro campo, e os campos de candidato somem para o
 * recrutador (US-005.AC-1) — num `fieldset` desabilitado, que o navegador não
 * envia. Uma recusa mantém tudo o que foi digitado: o envio é feito à mão, sem
 * o reset que o React aplica ao formulário quando a ação termina.
 */
export function SignupForm({
  mode,
  action,
  labels,
  messages,
  verifiedEmail,
  limits,
}: {
  mode: "social" | "manual";
  action: (formData: FormData) => Promise<SignupActionResult>;
  labels: SignupFormLabels;
  /** Mensagem por código de recusa; `generic` para o inesperado. */
  messages: Record<string, string>;
  verifiedEmail: string | null;
  limits: { nameMax: number; headlineMax: number; passwordMin: number };
}) {
  const [role, setRole] = useState<"candidate" | "recruiter">("candidate");
  const [state, formAction, pending] = useActionState(
    async (_previous: State, formData: FormData): Promise<State> => {
      try {
        const result = await action(formData);
        if (result && result.ok === false) return { message: messages[result.code] ?? messages.generic ?? null };
        return { message: null };
      } catch (error) {
        // `redirect()` da ação é sinal de navegação, não falha: segue para o roteador.
        if (isNavigationSignal(error)) throw error;
        return { message: messages.generic ?? null };
      }
    },
    { message: null },
  );

  const submitKeepingFields = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  };

  const roleOption = (value: "candidate" | "recruiter", title: string, hint: string) => (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[var(--radius-action)] border p-3 transition-colors",
        role === value ? "border-[var(--primary)] bg-[var(--muted)]" : "border-[var(--hairline)] hover:bg-[var(--muted)]",
      )}
    >
      <input
        type="radio"
        name="role"
        value={value}
        checked={role === value}
        onChange={() => setRole(value)}
        className="mt-1 cursor-pointer"
        data-testid={`signup-role-${value}`}
      />
      <span className="min-w-0">
        <span className="type-body-md block font-medium">{title}</span>
        <span className="type-body-sm block text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <form
      action={formAction}
      onSubmit={submitKeepingFields}
      aria-busy={pending || undefined}
      className="grid gap-4"
      data-testid="signup-form"
    >
      <fieldset className="grid gap-2">
        <legend className="type-body-sm mb-1.5 font-medium">{labels.roleLegend}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roleOption("candidate", labels.roleCandidate, labels.roleCandidateHint)}
          {roleOption("recruiter", labels.roleRecruiter, labels.roleRecruiterHint)}
        </div>
      </fieldset>

      {mode === "social" && verifiedEmail !== null && (
        <div className="grid gap-1.5">
          <span className="type-body-sm font-medium">{labels.verifiedEmail}</span>
          <p
            className="type-body-md min-w-0 break-words rounded-[var(--radius-action)] bg-[var(--muted)] px-3 py-2"
            data-user-content
            data-testid="signup-verified-email"
          >
            {verifiedEmail}
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="signup-name">{labels.name}</Label>
        <Input id="signup-name" name="name" required maxLength={limits.nameMax} autoComplete="name" data-testid="signup-name" />
      </div>

      <fieldset disabled={role !== "candidate"} hidden={role !== "candidate"} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="signup-headline">{labels.headline}</Label>
          <Input
            id="signup-headline"
            name="headline"
            maxLength={limits.headlineMax}
            aria-describedby="signup-headline-hint"
            data-testid="signup-headline"
          />
          <p id="signup-headline-hint" className="type-body-sm text-muted-foreground">
            {labels.headlineHint}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="signup-cv-file">{labels.cvPdf}</Label>
          <Input
            id="signup-cv-file"
            name="cvFile"
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby="signup-cv-file-hint"
            className="min-w-0"
            data-testid="signup-cv-file"
          />
          <p id="signup-cv-file-hint" className="type-body-sm text-muted-foreground">
            {labels.cvPdfHint}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="signup-cv">{labels.cv}</Label>
          <Textarea id="signup-cv" name="cv" rows={6} aria-describedby="signup-cv-hint" data-testid="signup-cv" />
          <p id="signup-cv-hint" className="type-body-sm text-muted-foreground">
            {labels.cvHint}
          </p>
        </div>
      </fieldset>

      {mode === "manual" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="signup-email">{labels.email}</Label>
            <Input id="signup-email" name="email" type="email" required autoComplete="email" data-testid="signup-email" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="signup-password">{labels.password}</Label>
            <Input
              id="signup-password"
              name="password"
              type="password"
              required
              minLength={limits.passwordMin}
              autoComplete="new-password"
              aria-describedby="signup-password-hint"
              data-testid="signup-password"
            />
            <p id="signup-password-hint" className="type-body-sm text-muted-foreground">
              {labels.passwordHint}
            </p>
          </div>
        </>
      )}

      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" name="terms" className="mt-1 cursor-pointer" data-testid="signup-terms" />
        <span className="type-body-sm min-w-0">
          {labels.acceptLead}{" "}
          <a href={LEGAL_HREF.terms} target="_blank" rel="noopener" className="text-[var(--primary-text)] underline">
            {labels.terms}
          </a>{" "}
          {labels.acceptAnd}{" "}
          <a href={LEGAL_HREF.privacy} target="_blank" rel="noopener" className="text-[var(--primary-text)] underline">
            {labels.privacy}
          </a>
          .
        </span>
      </label>

      {state.message && (
        <p className="type-body-sm text-[var(--color-alert)]" role="alert" data-testid="signup-error">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending} data-testid="signup-submit">
        {labels.submit}
      </Button>
    </form>
  );
}
