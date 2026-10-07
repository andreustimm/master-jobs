"use client";

import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publishMutationFeedback } from "../mutation-feedback";

/**
 * As ilhas cliente da seção "Acesso de recrutadores" (#465).
 *
 * Cliente por três motivos, e só por eles: o fuso do navegador entra num campo
 * oculto (ADR-016); a recusa aparece embaixo do campo que a causou, com o
 * e-mail digitado preservado (US-001.EC-1); e revogar ou cancelar pede
 * confirmação num popover nativo, como a exclusão de conta. Todo texto chega
 * pronto do servidor, do dicionário (regra 9).
 *
 * Erro inesperado (sessão vencida, rede) faz `router.refresh()`: a página
 * reavalia a sessão e, sem ela, `requirePage` leva ao login (US-001.EC-8).
 */

export type ActionResult = { ok: boolean; error?: string; retryAt?: string; kind?: string };
export type AccessServerAction = (formData: FormData) => Promise<ActionResult>;

/** Mensagens de recusa por código, mais a genérica. `cap_reached` traz `{time}`. */
export type ErrorLabels = Record<string, string> & { unexpected: string };

const EMAIL_ERRORS = new Set(["blank_email", "invalid_email", "self", "already_active", "already_invited"]);
const DATE_ERRORS = new Set(["date_invalid", "date_past", "date_too_far"]);

function refusal(result: ActionResult, errors: ErrorLabels, locale: string): string {
  const message = (result.error && errors[result.error]) || errors.unexpected;
  if (!result.retryAt) return message;
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(result.retryAt));
  return message.replace("{time}", time);
}

/** O fuso IANA do navegador; até a hidratação, e se ele não disser, UTC. */
function useBrowserZone(): string {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) setZone(resolved);
  }, []);
  return zone;
}

function FieldError({ id, message, testId }: { id: string; message: string | undefined; testId: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" data-testid={testId} className="type-meta border-l-4 border-[var(--bad)] pl-2 text-foreground">
      {message}
    </p>
  );
}

export function GrantAccessForm({
  action,
  locale,
  labels,
  errors,
}: {
  action: AccessServerAction;
  locale: string;
  labels: {
    email: string;
    emailHint: string;
    endDate: string;
    endDateHint: string;
    /** Com `{tz}`, trocado aqui pelo fuso do navegador. */
    timezone: string;
    submit: string;
    granted: string;
    invited: string;
  };
  errors: ErrorLabels;
}) {
  const zone = useBrowserZone();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [endDate, setEndDate] = useState("");
  const [problem, setProblem] = useState<{ field: "email" | "date" | "form"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const base = useId();

  function submit(formData: FormData) {
    // Do estado, não do DOM: o navegador restaura campo ao recarregar, e o
    // que vale é o que a tela mostra (ver `AccessActionButton`).
    formData.set("email", email);
    formData.set("endDate", endDate);
    formData.set("tz", zone);
    const typed = email.trim();
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.ok) {
          setProblem(null);
          setEmail("");
          setEndDate("");
          const template = result.kind === "invite" ? labels.invited : labels.granted;
          publishMutationFeedback({ kind: "success", message: template.replace("{email}", typed) });
          return;
        }
        const message = refusal(result, errors, locale);
        const field = EMAIL_ERRORS.has(result.error ?? "") ? "email" : DATE_ERRORS.has(result.error ?? "") ? "date" : "form";
        setProblem({ field, message });
      } catch {
        setProblem({ field: "form", message: errors.unexpected });
        router.refresh();
      }
    });
  }

  const emailError = problem?.field === "email" ? problem.message : undefined;
  const dateError = problem?.field === "date" ? problem.message : undefined;

  return (
    // `noValidate`: a recusa vem do servidor, com a mesma mensagem embaixo do
    // campo em todo navegador; a validação nativa de `type="email"` mostraria
    // outra, fora do dicionário.
    <form
      action={submit}
      noValidate
      autoComplete="off"
      className="grid gap-3"
      data-testid="recruiter-access-form"
      aria-busy={pending || undefined}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${base}-email`}>{labels.email}</Label>
        <Input
          id={`${base}-email`}
          name="email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={`${base}-email-hint${emailError ? ` ${base}-email-error` : ""}`}
          data-testid="recruiter-access-email"
        />
        <p id={`${base}-email-hint`} className="type-meta text-muted-foreground">
          {labels.emailHint}
        </p>
        <FieldError id={`${base}-email-error`} message={emailError} testId="recruiter-access-email-error" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${base}-end`}>{labels.endDate}</Label>
        <Input
          id={`${base}-end`}
          name="endDate"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={`${base}-end-hint${dateError ? ` ${base}-end-error` : ""}`}
          data-testid="recruiter-access-end-date"
        />
        <p id={`${base}-end-hint`} className="type-meta text-muted-foreground">
          {labels.endDateHint}{" "}
          <span data-testid="recruiter-access-timezone">{labels.timezone.replace("{tz}", zone)}</span>
        </p>
        <FieldError id={`${base}-end-error`} message={dateError} testId="recruiter-access-date-error" />
      </div>
      <FieldError id={`${base}-form-error`} message={problem?.field === "form" ? problem.message : undefined} testId="recruiter-access-form-error" />
      <div>
        <Button type="submit" className="min-h-11" disabled={pending} data-testid="recruiter-access-submit">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * Data de fim de uma concessão: salvar, mover ou tirar (US-006.AC-3). O fuso
 * vai junto, o do navegador de agora.
 */
export function EndDateForm({
  action,
  grantId,
  current,
  locale,
  labels,
  errors,
}: {
  action: AccessServerAction;
  grantId: number;
  /** `YYYY-MM-DD` no fuso guardado, ou vazio. */
  current: string;
  locale: string;
  labels: { endDate: string; save: string; clear: string; saved: string };
  errors: ErrorLabels;
}) {
  const zone = useBrowserZone();
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const base = useId();

  useEffect(() => setValue(current), [current]);

  function submit(formData: FormData) {
    formData.set("grantId", String(grantId));
    formData.set("tz", zone);
    formData.set("endDate", formData.get("clear") === "1" ? "" : value);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.ok) {
          setError(undefined);
          publishMutationFeedback({ kind: "success", message: labels.saved });
        } else {
          setError(refusal(result, errors, locale));
        }
      } catch {
        setError(errors.unexpected);
        router.refresh();
      }
    });
  }

  return (
    <form action={submit} noValidate autoComplete="off" className="grid gap-1.5" aria-busy={pending || undefined}>
      <Label htmlFor={`${base}-end`} className="type-meta">
        {labels.endDate}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${base}-end`}
          name="endDate"
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-auto"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${base}-error` : undefined}
          data-testid="recruiter-grant-end-date"
        />
        <Button type="submit" variant="outline" className="min-h-11" disabled={pending} data-testid="recruiter-grant-save-end">
          {labels.save}
        </Button>
        {current !== "" && (
          <Button
            type="submit"
            name="clear"
            value="1"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            data-testid="recruiter-grant-clear-end"
          >
            {labels.clear}
          </Button>
        )}
      </div>
      <FieldError id={`${base}-error`} message={error} testId="recruiter-grant-end-error" />
    </form>
  );
}

/**
 * Um botão que chama uma action com campos ocultos — reenviar, dispensar,
 * revogar, cancelar. Com `confirm`, o botão abre um popover, e só o botão de
 * dentro executa (US-008.EC-3: voltar não muda nada).
 */
export function AccessActionButton({
  action,
  fields,
  label,
  testId,
  success,
  errors,
  locale,
  variant = "outline",
  confirm,
}: {
  action: AccessServerAction;
  fields: Record<string, string | number>;
  label: string;
  testId: string;
  success: string;
  errors: ErrorLabels;
  locale: string;
  variant?: "outline" | "destructive";
  /** `title` pode levar o e-mail marcado como dado de usuário. */
  confirm?: { title: ReactNode; body: string; confirm: string; keep: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const popover = `${useId().replace(/:/g, "")}-confirm`;

  function submit(formData: FormData) {
    // O id vem da prop, não de campo oculto: há navegador (Firefox) que
    // restaura campo oculto pela posição ao recarregar, e depois de um
    // reenvio ou de uma revogação a posição de um item é a de outro.
    for (const [name, value] of Object.entries(fields)) formData.set(name, String(value));
    startTransition(async () => {
      try {
        const result = await action(formData);
        document.getElementById(popover)?.hidePopover();
        publishMutationFeedback(
          result.ok ? { kind: "success", message: success } : { kind: "error", message: refusal(result, errors, locale) },
        );
      } catch {
        publishMutationFeedback({ kind: "error", message: errors.unexpected });
        router.refresh();
      }
    });
  }

  const form = (submitLabel: string, submitTestId: string, submitVariant: "outline" | "destructive") => (
    <form action={submit} autoComplete="off" className="inline">
      <Button type="submit" variant={submitVariant} className="min-h-11" disabled={pending} data-testid={submitTestId}>
        {submitLabel}
      </Button>
    </form>
  );

  if (!confirm) return form(label, testId, variant);

  return (
    <>
      <Button type="button" variant={variant} className="min-h-11" popoverTarget={popover} popoverTargetAction="show" data-testid={testId}>
        {label}
      </Button>
      <div
        id={popover}
        popover="auto"
        role="dialog"
        aria-labelledby={`${popover}-title`}
        data-testid={`${testId}-dialog`}
        className="m-auto max-h-[85dvh] w-[min(92vw,520px)] overflow-y-auto rounded-xl bg-card p-0 text-card-foreground ring-1 ring-foreground/10 backdrop:bg-foreground/40"
      >
        <div className="grid gap-3 px-5 py-5">
          <h2 id={`${popover}-title`} className="type-display-xs leading-tight break-words">
            {confirm.title}
          </h2>
          <p className="type-caption-sm">{confirm.body}</p>
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              popoverTarget={popover}
              popoverTargetAction="hide"
              data-testid={`${testId}-keep`}
            >
              {confirm.keep}
            </Button>
            {form(confirm.confirm, `${testId}-confirm`, "destructive")}
          </div>
        </div>
      </div>
    </>
  );
}
