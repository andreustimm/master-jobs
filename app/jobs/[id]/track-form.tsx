"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TrackResult } from "../../actions";
import { isNavigationSignal, publishMutationFeedback } from "../../mutation-feedback";
import type { ApplicationStatusOption } from "../../status.ts";
import type { ApplicationStatus } from "../../../src/contexts/pursuit/domain/application.ts";

export type TrackFormLabels = {
  moveTo: string;
  notePlaceholder: string;
  save: string;
  success: string;
  error: string;
  rejected: string;
  conflict: string;
};

/**
 * Mover a candidatura de estágio, com o rascunho preservado quando o servidor
 * recusa.
 *
 * Os campos são controlados de propósito. Com campos não controlados, a `form`
 * do React limpa o DOM ao concluir a action — inclusive quando ela concluiu
 * recusando —, e a nota digitada ia embora junto com a tentativa. Quem escreveu
 * "Entrevista técnica marcada para sexta às 14h" perdia a frase por ter
 * escolhido um estágio que o funil não alcança a partir do atual.
 */
export function TrackForm({
  action,
  jobId,
  currentStatus,
  options,
  labels,
  statusLabels,
}: {
  action: (formData: FormData) => Promise<TrackResult>;
  jobId: number;
  currentStatus: ApplicationStatus | null;
  options: ApplicationStatusOption[];
  labels: TrackFormLabels;
  statusLabels: Record<ApplicationStatus, string>;
}) {
  // Sem candidatura, o seletor abre em `shortlisted`: o primeiro movimento útil
  // é encurtar a lista, não registrar que a vaga existe.
  const [status, setStatus] = useState<string>(currentStatus ?? "shortlisted");
  const [note, setNote] = useState("");

  const [, formAction, pending] = useActionState(async (_previous: null, formData: FormData) => {
    try {
      const result = await action(formData);
      if (result.status === "ok") {
        publishMutationFeedback({ kind: "success", message: labels.success });
        // A nota pertence à transição que acabou de ser gravada; mantê-la na
        // tela convidaria a repeti-la na próxima.
        setNote("");
        return null;
      }
      publishMutationFeedback({ kind: "error", message: messageFor(result, labels, statusLabels) });
    } catch (error) {
      // Redirect e notFound viajam como exceção; engoli-los deixaria a sessão
      // vencida presa nesta tela. Só falha comum vira aviso — e o rascunho
      // continua no estado, que é o ponto de tudo isto.
      if (isNavigationSignal(error)) throw error;
      publishMutationFeedback({ kind: "error", message: labels.error });
    }
    return null;
  }, null);

  return (
    <form
      action={formAction}
      aria-busy={pending || undefined}
      data-testid="track-form"
      className="mb-7 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        {labels.moveTo}
      </span>
      <select
        name="status"
        data-testid="track-status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className={cn(
          "h-9 rounded-lg border border-input bg-background px-3 text-sm",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        )}
      >
        {options.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Input
        name="note"
        data-testid="track-note"
        placeholder={labels.notePlaceholder}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="max-w-[260px]"
      />
      <Button type="submit" data-testid="track-submit" disabled={pending}>
        {labels.save}
      </Button>
    </form>
  );
}

function messageFor(
  result: Extract<TrackResult, { status: "error" }>,
  labels: TrackFormLabels,
  statusLabels: Record<ApplicationStatus, string>,
): string {
  if (result.code === "conflict") return labels.conflict;
  return labels.rejected
    .replace("{from}", statusLabels[result.from])
    .replace("{to}", statusLabels[result.to]);
}
