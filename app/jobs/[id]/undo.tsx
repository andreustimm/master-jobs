"use client";

import { startTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import type { UndoResult } from "../../actions";
import { isNavigationSignal, publishMutationFeedback } from "../../mutation-feedback";

export type UndoLabels = {
  undo: string;
  done: string;
  conflict: string;
  unavailable: string;
  error: string;
};

type UndoAction = (formData: FormData) => Promise<UndoResult>;

/**
 * Desfaz uma movimentação e diz como foi. Usado pelo aviso que aparece logo
 * depois de salvar e pelo botão na linha mais recente do histórico — os dois
 * mandam o id do evento que a pessoa viu, e o servidor recusa se outra aba
 * mexeu desde então.
 */
export async function runUndo(action: UndoAction, jobId: number, eventId: number, labels: UndoLabels): Promise<void> {
  const data = new FormData();
  data.set("jobId", String(jobId));
  data.set("eventId", String(eventId));
  try {
    const result = await action(data);
    if (result.status === "ok") {
      publishMutationFeedback({ kind: "success", message: labels.done });
      return;
    }
    publishMutationFeedback({
      kind: "error",
      message: result.code === "conflict" ? labels.conflict : labels.unavailable,
    });
  } catch (error) {
    if (isNavigationSignal(error)) throw error;
    publishMutationFeedback({ kind: "error", message: labels.error });
  }
}

/** "Desfazer" na movimentação mais recente do histórico, sem prazo. */
export function UndoButton({
  action,
  jobId,
  eventId,
  labels,
  label,
}: {
  action: UndoAction;
  jobId: number;
  eventId: number;
  labels: UndoLabels;
  /** Nome acessível completo; o texto visível é o curto. */
  label: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="application-undo"
      aria-label={label}
      disabled={pending}
      onClick={() => {
        setPending(true);
        startTransition(async () => {
          try {
            await runUndo(action, jobId, eventId, labels);
          } finally {
            setPending(false);
          }
        });
      }}
    >
      {labels.undo}
    </Button>
  );
}
