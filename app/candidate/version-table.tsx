"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readVersionAction } from "./actions";
import {
  RenameForm,
  VersionErrorAlert,
  VersionView,
  useVersionActions,
  type VersionLabels,
  type VersionRow,
} from "./versions";

/**
 * A lista de versões da página, com as ações ao alcance da linha.
 *
 * Recurso ADICIONAL ao modal Histórico (issue #312), que continua igual: aqui
 * é o atalho para uma operação pontual, lá é a comparação com foco. As duas
 * superfícies usam `useVersionActions`, portanto as mesmas Server Actions e os
 * mesmos erros traduzidos.
 *
 * O risco de um atalho na página é o clique perdido. Por isso toda ação com
 * efeito passa por um painel que exige um segundo gesto explícito: restaurar e
 * excluir nomeiam a versão e abrem com o foco em Cancelar; renomear só grava
 * com Salvar. Esc cancela qualquer painel, e o foco volta ao ícone que o abriu.
 *
 * Identificar a ação sem texto: tooltip no hover e no foco, `aria-label` para
 * leitor de tela. Toque não abre tooltip, então abaixo de `sm` o rótulo aparece
 * ao lado do ícone — o mesmo texto do dicionário, nunca um adivinha-o-ícone.
 */

type Viewing =
  | { row: VersionRow; state: "loading" }
  | { row: VersionRow; state: "ready"; content: string }
  | { row: VersionRow; state: "error"; message: string };

export function VersionTable({
  rows,
  labels,
  locale,
  feedback,
}: {
  rows: VersionRow[];
  labels: VersionLabels;
  locale: string;
  feedback: { success: string; error: string };
}) {
  const { t, panel, setPanel, error, setError, pending, confirmed, rename, errorMessage } =
    useVersionActions({ labels, feedback });
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Um clique em Ver numa linha e logo em outra não pode deixar a resposta
  // lenta da primeira aparecer sob o cabeçalho da segunda.
  const request = useRef(0);

  // Sucesso também fecha o painel (em `handle`), e o campo ou botão focado
  // desmonta com ele: sem isto, o teclado recomeçaria do topo da página. Depois
  // de excluir o ícone não existe mais, e `focus()` num nó solto não faz nada.
  // Espera `pending` cair: o painel fecha ainda dentro da transição, com o
  // ícone `disabled`, e botão desabilitado não recebe foco.
  useEffect(() => {
    if (!pending && panel.kind === "none" && document.activeElement === document.body) {
      lastTrigger.current?.focus();
    }
  }, [panel.kind, pending]);

  function openPanel(next: Parameters<typeof setPanel>[0], trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setError(null);
    setPanel(next);
  }

  function cancel() {
    setPanel({ kind: "none" });
    lastTrigger.current?.focus();
  }

  function view(row: VersionRow, trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    const ticket = ++request.current;
    setViewing({ row, state: "loading" });
    dialog.current?.showModal();
    readVersionAction(row.id).then(
      (result) => {
        if (ticket !== request.current) return;
        setViewing(
          result.ok
            ? { row, state: "ready", content: result.content }
            : { row, state: "error", message: errorMessage(result.error) },
        );
      },
      () => {
        if (ticket !== request.current) return;
        setViewing({ row, state: "error", message: errorMessage("not-found") });
      },
    );
  }

  return (
    <>
      {error && (
        <VersionErrorAlert
          error={error}
          referencedBy={t("referencedBy")}
          className="mb-3 rounded-[var(--radius-action)] px-4 py-3"
          testId="version-table-error"
        />
      )}

      <div className="divide-y overflow-hidden rounded-xl border" data-testid="version-table">
        {rows.map((row) => {
          const open = panel.kind !== "none" && panel.kind !== "view" && panel.id === row.id;
          return (
            <div
              key={row.id}
              className="bg-card px-4 py-2.5 text-sm"
              data-testid="version-table-row"
              data-version-id={row.id}
              data-current={row.isCurrent ? "true" : undefined}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {row.isCurrent ? (
                  <Badge className="type-micro">{t("current")}</Badge>
                ) : (
                  <span className="hidden w-[46px] sm:inline-block" />
                )}
                <span data-user-content className="min-w-0 flex-1 break-words">
                  {row.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.length.toLocaleString(locale)} {t("chars")}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.createdAt.slice(0, 10)}
                </span>
                {/* No celular, a fileira desce para a própria linha em duas
                    colunas: quatro alvos de 44px com rótulo não cabem ao lado
                    do rótulo da versão em 375px. */}
                <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:gap-1">
                  <IconAction
                    icon={Eye}
                    label={t("view")}
                    busy={pending}
                    testId="version-table-view"
                    onClick={(el) => view(row, el)}
                  />
                  <IconAction
                    icon={Pencil}
                    label={t("rename")}
                    busy={pending}
                    testId="version-table-rename"
                    onClick={(el) => openPanel({ kind: "rename", id: row.id, label: row.label }, el)}
                  />
                  {!row.isCurrent && (
                    <IconAction
                      icon={RotateCcw}
                      label={t("restore")}
                      busy={pending}
                      testId="version-table-restore"
                      onClick={(el) =>
                        openPanel(
                          { kind: "confirm", id: row.id, label: row.label, action: "restore" },
                          el,
                        )
                      }
                    />
                  )}
                  {!row.isCurrent && (
                    <IconAction
                      icon={Trash2}
                      label={t("remove")}
                      busy={pending}
                      tone="danger"
                      testId="version-table-delete"
                      onClick={(el) =>
                        openPanel(
                          { kind: "confirm", id: row.id, label: row.label, action: "delete" },
                          el,
                        )
                      }
                    />
                  )}
                </div>
              </div>

              {open && (
                // Esc aqui cancela o painel, e não sai para a página: é o
                // mesmo gesto que fecha o modal Histórico.
                <div
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancel();
                    }
                  }}
                >
                  {panel.kind === "rename" && (
                    <RenameForm
                      defaultValue={panel.label}
                      labels={{ field: t("newLabel"), save: t("save"), cancel: t("cancel") }}
                      busy={pending}
                      onCancel={cancel}
                      onSubmit={rename}
                      testIds={{
                        field: "version-table-rename-field",
                        save: "version-table-rename-save",
                        cancel: "version-table-rename-cancel",
                      }}
                    />
                  )}
                  {panel.kind === "confirm" && (
                    <div
                      className="mt-3 rounded-[var(--radius-action)] border border-[var(--hairline)] bg-[var(--muted)] p-3"
                      data-testid="version-table-confirm-panel"
                    >
                      <p className="type-body-sm">
                        {t(panel.action === "delete" ? "confirmDelete" : "confirmRestore", {
                          label: panel.label,
                        })}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {/* Cancelar primeiro e com o foco: Enter logo após o
                            clique acidental desfaz, não confirma. */}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={cancel}
                          autoFocus
                          data-testid="version-table-cancel"
                          className="min-h-11 xl:min-h-0"
                        >
                          {t("cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={panel.action === "delete" ? "destructive" : "default"}
                          disabled={pending}
                          onClick={confirmed}
                          data-testid="version-table-confirm"
                          className="min-h-11 xl:min-h-0"
                        >
                          {t(panel.action === "delete" ? "remove" : "restore")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <dialog
        ref={dialog}
        aria-label={viewing?.row.label ?? t("view")}
        data-testid="version-table-dialog"
        onClose={() => {
          request.current++;
          setViewing(null);
          lastTrigger.current?.focus();
        }}
        className={cn(
          "m-auto w-[min(56rem,92vw)] max-h-[85vh] overflow-hidden p-0",
          "rounded-[var(--radius-surface)] border border-[var(--hairline)]",
          "bg-[var(--card)] text-[var(--card-foreground)] shadow-lg",
          "backdrop:bg-black/50",
        )}
      >
        {viewing && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {viewing.row.isCurrent && <Badge className="type-micro">{t("current")}</Badge>}
                  <h2 data-user-content className="type-display-xs min-w-0 break-words">
                    {viewing.row.label}
                  </h2>
                </div>
                <p className="type-meta mt-1 font-mono text-muted-foreground">
                  {viewing.row.length.toLocaleString(locale)} {t("chars")} ·{" "}
                  {viewing.row.createdAt.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label={t("close")}
                data-testid="version-table-dialog-close"
                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-action)] text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground xl:size-7"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="px-5 pb-5">
              {viewing.state === "loading" && (
                <p role="status" className="type-body-sm mt-3 text-muted-foreground">
                  {t("loading")}
                </p>
              )}
              {viewing.state === "error" && (
                <p role="alert" className="type-body-sm mt-3 text-[var(--bad)]">
                  {viewing.message}
                </p>
              )}
              {viewing.state === "ready" && (
                <VersionView
                  content={viewing.content}
                  labels={{ rendered: t("rendered"), raw: t("raw") }}
                  scrollClassName="max-h-[calc(85vh-11rem)]"
                  testId="version-table-view-content"
                />
              )}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

/**
 * Botão só-ícone da linha. O nome da ação existe em três lugares, todos com o
 * mesmo texto do dicionário: tooltip acima (mouse e teclado), `aria-label`
 * (leitor de tela) e o rótulo visível abaixo de `sm` (toque). Sem `title`, que
 * duplicaria o tooltip no hover.
 */
function IconAction({
  icon: Icon,
  label,
  onClick,
  busy,
  tone,
  testId,
}: {
  icon: typeof Eye;
  label: string;
  onClick: (trigger: HTMLButtonElement) => void;
  busy: boolean;
  tone?: "danger";
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid={testId}
            disabled={busy}
            onClick={(e) => onClick(e.currentTarget)}
            className={cn(
              "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5",
              "rounded-[var(--radius-action)] border border-[var(--hairline)] px-3 type-micro transition-colors",
              "sm:px-0 xl:size-7 xl:min-h-0 xl:min-w-0",
              "disabled:cursor-not-allowed disabled:opacity-50",
              tone === "danger"
                ? "text-[var(--bad)] hover:bg-[var(--bad)]/10"
                : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
            )}
          >
            <Icon className="size-4 xl:size-3.5" aria-hidden />
            <span className="sm:hidden" aria-hidden>
              {label}
            </span>
          </button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
