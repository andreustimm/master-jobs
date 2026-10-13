"use client";

import type { Route } from "next";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { publishMutationFeedback } from "../../../mutation-feedback";

/**
 * A escolha da vaga e a nota (#465, US-018). Cliente por dois motivos: a nota
 * recusada fica no campo, com o erro embaixo dele (US-018.EC-1), e o sucesso
 * volta à página do candidato, onde a sugestão aparece como Pendente. Todo
 * texto chega pronto do servidor, do dicionário (regra 9).
 *
 * Erro inesperado — inclusive o acesso que acabou entre abrir e enviar —
 * recarrega a página: sem concessão, ela responde o 404 de sempre
 * (US-018.EC-7).
 */

type Result = { ok: boolean; error?: string; retryAt?: string };

export type SuggestJobOption = { id: number; title: string; company: string; location: string | null };

export function SuggestJobForm({
  action,
  candidateId,
  jobs,
  locale,
  labels,
  errors,
}: {
  action: (formData: FormData) => Promise<Result>;
  candidateId: number;
  jobs: SuggestJobOption[];
  locale: string;
  labels: { job: string; note: string; noteHint: string; submit: string; suggested: string };
  /** Por código de recusa, mais `unexpected`; `cap_reached` traz `{time}`. */
  errors: Record<string, string> & { unexpected: string };
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<{ field: "job" | "note" | "form"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const base = useId();

  function refusal(result: Result): string {
    const message = (result.error && errors[result.error]) || errors.unexpected;
    if (!result.retryAt) return message;
    const time = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(result.retryAt));
    return message.replace("{time}", time);
  }

  function submit(formData: FormData) {
    // Do estado, não do DOM: o que vale é o que a tela mostra.
    formData.set("candidateId", String(candidateId));
    formData.set("jobId", jobId);
    formData.set("note", note);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.ok) {
          setProblem(null);
          publishMutationFeedback({ kind: "success", message: labels.suggested });
          router.push(`/recruiter/${candidateId}` as Route);
          return;
        }
        const field = result.error === "note_too_long" ? "note" : result.error === "pick_job" ? "job" : "form";
        setProblem({ field, message: refusal(result) });
      } catch {
        setProblem({ field: "form", message: errors.unexpected });
        router.refresh();
      }
    });
  }

  const error = (field: "job" | "note" | "form", testId: string) =>
    problem?.field === field ? (
      <p id={`${base}-${field}-error`} role="alert" data-testid={testId} className="type-meta border-l-4 border-[var(--bad)] pl-2 text-foreground">
        {problem.message}
      </p>
    ) : null;

  return (
    <form action={submit} noValidate autoComplete="off" className="grid gap-4" data-testid="suggest-form" aria-busy={pending || undefined}>
      <fieldset className="grid gap-2" aria-describedby={problem?.field === "job" ? `${base}-job-error` : undefined}>
        <legend className="type-body-sm mb-1 font-medium">{labels.job}</legend>
        <ul className="divide-y overflow-hidden rounded-xl border">
          {jobs.map((job) => (
            <li key={job.id} className="bg-card">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3" data-testid={`suggest-job-${job.id}`}>
                <input
                  type="radio"
                  name="jobChoice"
                  value={String(job.id)}
                  checked={jobId === String(job.id)}
                  onChange={() => setJobId(String(job.id))}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-semibold break-words" data-user-content>
                    {job.title}
                  </span>
                  <span className="block text-xs text-muted-foreground break-words">
                    <span data-user-content>{job.company}</span>
                    {job.location ? (
                      <>
                        {" · "}
                        <span data-user-content>{job.location}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error("job", "suggest-job-error")}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor={`${base}-note`}>{labels.note}</Label>
        <Textarea
          id={`${base}-note`}
          name="note"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={problem?.field === "note" ? true : undefined}
          aria-describedby={`${base}-note-hint${problem?.field === "note" ? ` ${base}-note-error` : ""}`}
          data-testid="suggest-note"
        />
        <p id={`${base}-note-hint`} className="type-meta text-muted-foreground">
          {labels.noteHint}
        </p>
        {error("note", "suggest-note-error")}
      </div>
      {error("form", "suggest-form-error")}
      <div>
        <Button type="submit" className="min-h-11" disabled={pending} data-testid="suggest-submit">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
