"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, RotateCcw, Pencil, Trash2, X, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "./markdown-preview";
import {
  deleteVersionAction,
  readVersionAction,
  renameVersionAction,
  restoreVersionAction,
  type VersionActionResult,
} from "./actions";

/**
 * Histórico de versões do currículo: ver, restaurar, renomear, excluir.
 *
 * `<dialog>` nativo, e não uma biblioteca de modal. Ele traz foco preso,
 * `Escape` e backdrop do próprio navegador — o mesmo raciocínio do Popover
 * nativo no seletor de aparência. Uma dependência aqui pagaria por comportamento
 * que a plataforma já entrega, e pagaria em JavaScript numa aplicação cujo
 * resto é Server Component.
 *
 * O que motivou a tela: a lista somente-leitura de antes mostrava três versões
 * com o rótulo `ATS EN 2026-07` medindo 8.227, 8.228 e 8.166 caracteres. O
 * rótulo é a única alça humana da versão, e ele não distinguia nada. Por isso
 * cada linha aqui carrega a diferença de tamanho contra a atual, e por isso
 * renomear não é enfeite.
 */

export type VersionRow = {
  id: number;
  label: string;
  isCurrent: boolean;
  length: number;
  createdAt: string;
};

export type VersionLabels = Record<string, string>;

type Panel =
  | { kind: "none" }
  | { kind: "view"; id: number; label: string; content: string }
  | { kind: "rename"; id: number; label: string }
  | { kind: "confirm"; id: number; label: string; action: "delete" | "restore" };

const ERROR_KEY: Record<string, string> = {
  "not-found": "errorNotFound",
  "empty-label": "errorEmptyLabel",
  "label-too-long": "errorLabelTooLong",
  "is-current": "errorIsCurrent",
  referenced: "errorReferenced",
};

export function VersionHistory({
  rows,
  labels,
  currentLength,
  locale,
}: {
  rows: VersionRow[];
  labels: VersionLabels;
  /** Tamanho da versão atual, para a diferença por linha. */
  currentLength: number;
  locale: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [pending, start] = useTransition();

  const t = (key: string, values?: Record<string, string | number>) => {
    const raw = labels[key] ?? key;
    return values
      ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`))
      : raw;
  };

  function open() {
    setError(null);
    setPanel({ kind: "none" });
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  /** Traduz o código que a ação devolveu; nunca exibe o código cru. */
  function handle(result: VersionActionResult) {
    if (result.ok) {
      setPanel({ kind: "none" });
      setError(null);
      return;
    }
    setError({ message: t(ERROR_KEY[result.error] ?? "errorNotFound"), detail: result.detail });
  }

  function view(row: VersionRow) {
    setError(null);
    start(async () => {
      const result = await readVersionAction(row.id);
      if (!result.ok) {
        setError({ message: t(ERROR_KEY[result.error] ?? "errorNotFound") });
        return;
      }
      setPanel({ kind: "view", id: row.id, label: result.label, content: result.content });
    });
  }

  function confirmed() {
    if (panel.kind !== "confirm") return;
    const { id, label, action } = panel;
    start(async () => {
      handle(
        action === "delete"
          ? await deleteVersionAction(id)
          : await restoreVersionAction(id, `${label} (${t("restoredSuffix")})`),
      );
    });
  }

  function rename(value: string) {
    if (panel.kind !== "rename") return;
    const { id } = panel;
    start(async () => handle(await renameVersionAction(id, value)));
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={open}
        className="h-7 gap-1.5"
        data-testid="version-history-open"
      >
        <History className="size-3.5" aria-hidden />
        {t("open")}
      </Button>

      <dialog
        ref={dialog}
        aria-label={t("title")}
        onClose={() => setPanel({ kind: "none" })}
        className={cn(
          "m-auto w-[min(56rem,92vw)] max-h-[85vh] overflow-hidden p-0",
          "rounded-[var(--radius-surface)] border border-[var(--hairline)]",
          "bg-[var(--card)] text-[var(--card-foreground)] shadow-lg",
          "backdrop:bg-black/50",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-5 py-3">
          <h2 className="type-display-xs">{t("title")}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[var(--radius-action)] text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="border-b border-[var(--hairline)] bg-[var(--bad)]/10 px-5 py-3"
          >
            <p className="type-body-sm text-[var(--bad)]">{error.message}</p>
            {error.detail && (
              <>
                <p className="type-meta mt-2 text-muted-foreground">{t("referencedBy")}</p>
                <ul className="type-meta mt-1 list-disc pl-4 text-muted-foreground">
                  {error.detail.split(" | ").map((item) => (
                    <li key={item} data-user-content>
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="max-h-[calc(85vh-8rem)] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="type-body-sm p-5 text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {rows.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {row.isCurrent && <Badge className="type-micro">{t("current")}</Badge>}
                    <span data-user-content className="type-body-md min-w-0 flex-1 break-words">
                      {row.label}
                    </span>
                    <span className="type-meta font-mono tabular-nums text-muted-foreground">
                      {row.length.toLocaleString(locale)} {t("chars")}
                    </span>
                    <span className="type-meta font-mono text-muted-foreground">
                      {row.createdAt.slice(0, 10)}
                    </span>
                  </div>

                  {/* A diferença contra a atual é o que distingue versões de
                      rótulo parecido — o defeito que motivou esta tela. Na
                      própria linha atual seria uma tautologia, então não vai. */}
                  {!row.isCurrent && (
                    <p className="type-meta mt-0.5 text-muted-foreground">
                      {row.length === currentLength
                        ? t("sameAsCurrent")
                        : row.length > currentLength
                          ? t("deltaMore", { n: (row.length - currentLength).toLocaleString(locale) })
                          : t("deltaLess", { n: (currentLength - row.length).toLocaleString(locale) })}
                    </p>
                  )}

                  {/* Sempre visíveis: controle que só existe no hover não existe
                      para quem navega por teclado. */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <RowButton
                      icon={Eye}
                      label={t("view")}
                      onClick={() => view(row)}
                      busy={pending}
                      testId="version-view-action"
                    />
                    {!row.isCurrent && (
                      <RowButton
                        icon={RotateCcw}
                        label={t("restore")}
                        busy={pending}
                        testId="version-restore"
                        onClick={() =>
                          setPanel({ kind: "confirm", id: row.id, label: row.label, action: "restore" })
                        }
                      />
                    )}
                    <RowButton
                      icon={Pencil}
                      label={t("rename")}
                      busy={pending}
                      testId="version-rename"
                      onClick={() => setPanel({ kind: "rename", id: row.id, label: row.label })}
                    />
                    {!row.isCurrent && (
                      <RowButton
                        icon={Trash2}
                        label={t("remove")}
                        busy={pending}
                        tone="danger"
                        testId="version-delete"
                        onClick={() =>
                          setPanel({ kind: "confirm", id: row.id, label: row.label, action: "delete" })
                        }
                      />
                    )}
                  </div>

                  {panel.kind === "rename" && panel.id === row.id && (
                    <RenameForm
                      defaultValue={panel.label}
                      labels={{ field: t("newLabel"), save: t("save"), cancel: t("cancel") }}
                      busy={pending}
                      onCancel={() => setPanel({ kind: "none" })}
                      onSubmit={rename}
                    />
                  )}

                  {panel.kind === "confirm" && panel.id === row.id && (
                    <div className="mt-3 rounded-[var(--radius-action)] border border-[var(--hairline)] bg-[var(--muted)] p-3">
                      {/* A confirmação NOMEIA a versão: rótulos parecidos são
                          exatamente o problema que esta tela resolve. */}
                      <p className="type-body-sm">
                        {t(panel.action === "delete" ? "confirmDelete" : "confirmRestore", {
                          label: panel.label,
                        })}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={panel.action === "delete" ? "destructive" : "default"}
                          disabled={pending}
                          onClick={confirmed}
                        >
                          {t(panel.action === "delete" ? "remove" : "restore")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setPanel({ kind: "none" })}
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {panel.kind === "view" && panel.id === row.id && (
                    <VersionView content={panel.content} labels={{ rendered: t("rendered"), raw: t("raw") }} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  );
}

function RowButton({
  icon: Icon,
  label,
  onClick,
  busy,
  tone,
  testId,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  busy: boolean;
  tone?: "danger";
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid={testId}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-action)]",
        "border border-[var(--hairline)] px-2.5 type-micro transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "text-[var(--bad)] hover:bg-[var(--bad)]/10"
          : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function RenameForm({
  defaultValue,
  labels,
  busy,
  onCancel,
  onSubmit,
}: {
  defaultValue: string;
  labels: { field: string; save: string; cancel: string };
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={labels.field}
        maxLength={120}
        autoFocus
        className="h-8 max-w-[24rem] flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          }
        }}
      />
      <Button type="button" size="sm" disabled={busy} onClick={() => onSubmit(value)}>
        {labels.save}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
        {labels.cancel}
      </Button>
    </div>
  );
}

/**
 * O conteúdo da versão, renderizado e cru.
 *
 * As duas visões porque respondem a perguntas diferentes: renderizado responde
 * "está bom para ler?", markdown responde "o que mudou?" — e a segunda é a que
 * decide se vale restaurar.
 */
function VersionView({
  content,
  labels,
}: {
  content: string;
  labels: { rendered: string; raw: string };
}) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  return (
    <div className="mt-3 rounded-[var(--radius-action)] border border-[var(--hairline)]">
      <div className="flex gap-1 border-b border-[var(--hairline)] p-1.5">
        {(["rendered", "raw"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
            className={cn(
              "cursor-pointer rounded-[var(--radius-action)] px-2.5 py-1 type-micro transition-colors",
              mode === id
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-muted-foreground hover:bg-[var(--muted)]",
            )}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div data-testid="version-view" data-user-content className="max-h-[40vh] overflow-y-auto p-4">
        {mode === "rendered" ? (
          <MarkdownPreview source={content} emptyLabel="" />
        ) : (
          <pre className="type-mono-sm whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </div>
  );
}
