"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TrackResult, UndoResult } from "../../actions";
import { isNavigationSignal, publishMutationFeedback } from "../../mutation-feedback";
import type { ApplicationStatusOption } from "../../status.ts";
import type { ApplicationStatus } from "../../../src/contexts/pursuit/domain/application.ts";
import { runUndo, type UndoLabels } from "./undo";

/** Tempo do aviso com "Desfazer": o dobro do aviso comum, para dar tempo de ler. */
const UNDO_NOTICE_MS = 10_000;

/** As opções do seletor, agrupadas como no domínio (`transitionGroups`). */
export type TrackFormGroups = {
  forward: ApplicationStatusOption[];
  back: ApplicationStatusOption[];
  close: ApplicationStatusOption[];
};

export type TrackFormLabels = {
  moveTo: string;
  notePlaceholder: string;
  save: string;
  success: string;
  error: string;
  rejected: string;
  conflict: string;
  groupForward: string;
  groupBack: string;
  groupClose: string;
  movedTo: string;
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
  undoAction,
  jobId,
  currentStatus,
  groups,
  labels,
  undoLabels,
  statusLabels,
}: {
  action: (formData: FormData) => Promise<TrackResult>;
  undoAction: (formData: FormData) => Promise<UndoResult>;
  jobId: number;
  currentStatus: ApplicationStatus | null;
  groups: TrackFormGroups;
  labels: TrackFormLabels;
  undoLabels: UndoLabels;
  statusLabels: Record<ApplicationStatus, string>;
}) {
  // O estágio atual vem primeiro e sozinho: salvar nele grava só a nota. Fora do
  // funil não é estágio que se escolha — a lista começa pelos grupos.
  const current: ApplicationStatusOption[] =
    currentStatus && currentStatus !== "untracked" && statusLabels[currentStatus]
      ? [{ value: currentStatus, label: statusLabels[currentStatus] }]
      : [];
  const options = [...current, ...groups.forward, ...groups.back, ...groups.close];
  const [status, setStatus] = useState<string>(initialChoice(currentStatus));
  const [note, setNote] = useState("");
  // O estágio pode mudar fora deste formulário — "não me interessa", outra aba.
  // Sem acompanhar, o seletor ficava na escolha anterior e caía na primeira
  // opção da lista nova: arquivada, a tela mostrava `backlog`, e Salvar
  // desfazia o arquivamento. A nota digitada não é tocada.
  const [seenStatus, setSeenStatus] = useState(currentStatus);
  if (currentStatus !== seenStatus) {
    setSeenStatus(currentStatus);
    setStatus(initialChoice(currentStatus));
  }
  const selected = options.some((option) => option.value === status)
    ? status
    : options[0]?.value ?? status;

  /**
   * O React limpa o formulário quando a action conclui, e a limpeza é do DOM:
   * o `select` volta para a primeira opção. Como o estado não mudou, não há
   * re-renderização que o corrija, e a tela passa a mostrar um estágio que não
   * é o gravado — com o botão Salvar ali do lado, pronto para mover a
   * candidatura para onde ninguém pediu. Reescrever o valor depois de cada
   * render devolve o DOM ao que o estado diz.
   */
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const element = selectRef.current;
    if (element && element.value !== selected) element.value = selected;
  });

  const [, formAction, pending] = useActionState(async (_previous: null, formData: FormData) => {
    try {
      const result = await action(formData);
      if (result.status === "ok") {
        const moved = String(formData.get("status")) as ApplicationStatus;
        const eventId = result.eventId;
        publishMutationFeedback(
          eventId === null
            ? { kind: "success", message: labels.success }
            : {
                kind: "success",
                message: labels.movedTo.replace("{to}", statusLabels[moved] ?? moved),
                durationMs: UNDO_NOTICE_MS,
                action: {
                  label: undoLabels.undo,
                  testId: "track-undo",
                  run: () => startTransition(() => runUndo(undoAction, jobId, eventId, undoLabels)),
                },
              },
        );
        // A nota pertence à transição que acabou de ser gravada; mantê-la na
        // tela convidaria a repeti-la na próxima.
        setNote("");
        return null;
      }
      // O servidor acabou de dizer qual é o estágio gravado. Apontar o seletor
      // para ele deixa a tela coerente com a lista que a revalidação traz; sem
      // isso a escolha recusada continuaria selecionada sobre uma lista nova.
      if (result.code === "illegal_transition") setStatus(result.from);
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
      {/* O rótulo visível acima não é `<label>`, então o `select` não tinha
          nome acessível e o axe reprova `select-name`. Só a visão do dono
          renderiza este formulário — a do recrutador, onde a tela foi medida
          antes de entrar na varredura, não. */}
      <select
        ref={selectRef}
        name="status"
        aria-label={labels.moveTo}
        data-testid="track-status"
        // O valor sai da lista oferecida, nunca do estado cru. Num conflito de
        // concorrência a revalidação traz opções novas e a escolha anterior
        // pode não estar entre elas: um `select` controlado com valor ausente
        // renderiza vazio e envia SEM `status`, e o servidor recebe "null".
        value={selected}
        onChange={(event) => setStatus(event.target.value)}
        className={cn(
          "h-9 rounded-lg border border-input bg-background px-3 text-sm",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        )}
      >
        {current.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
        {([
          ["forward", labels.groupForward],
          ["back", labels.groupBack],
          ["close", labels.groupClose],
        ] as const).map(([group, groupLabel]) =>
          groups[group].length === 0 ? null : (
            <optgroup key={group} label={groupLabel} data-testid={`track-group-${group}`}>
              {groups[group].map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          ),
        )}
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

/**
 * Sem candidatura (ou fora do funil), o seletor abre em `shortlisted`: o
 * primeiro movimento útil é encurtar a lista, não registrar que a vaga existe.
 */
function initialChoice(current: ApplicationStatus | null): string {
  return current === null || current === "untracked" ? "shortlisted" : current;
}
