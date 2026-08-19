"use client";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { markdownHighlight } from "./highlight.ts";
import { Vim, vim } from "@replit/codemirror-vim";
import { useEffect, useRef, useState } from "react";
import { Columns2, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "./markdown-preview";

/**
 * Markdown editor with optional vim bindings.
 *
 * This is the project's first Client Component, and it is deliberate: an editor
 * is interactive by definition, and there is no server-rendered way to give
 * someone `ciw`. Everything else in the dashboard stays a Server Component —
 * this island is the exception, not a new default.
 *
 * CodeMirror 6 rather than Monaco: a tenth of the weight, first-class vim
 * bindings, and markdown highlighting that matches what Obsidian shows.
 *
 * The vim preference persists in localStorage. Someone who edits in vim wants
 * vim every time, and asking again on each visit is its own kind of rudeness.
 */

const VIM_KEY = "jho:cv-editor:vim";

/**
 * Rótulos já traduzidos.
 *
 * Vêm prontos porque o tradutor é um objeto com métodos, e método não
 * atravessa a fronteira do React Server Component — só dado serializável
 * atravessa. Passar strings mantém o i18n na página, do lado servidor, e este
 * componente sem plumbing de idioma.
 */
export type EditorLabels = {
  edit: string;
  split: string;
  preview: string;
  viewMode: string;
  vimHint: string;
  nothingToShow: string;
};

export function MarkdownEditor({
  name,
  defaultValue,
  labels,
  minHeight = 460,
}: {
  name: string;
  defaultValue: string;
  labels: EditorLabels;
  minHeight?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The form posts this hidden input; CodeMirror keeps it in sync.
  const mirror = useRef<HTMLTextAreaElement>(null);
  const [vimOn, setVimOn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"edit" | "split" | "preview">("edit");
  const [previewSource, setPreviewSource] = useState(defaultValue);
  const [status, setStatus] = useState("");

  // Read the preference before the first mount that builds the editor, so the
  // editor is never created twice.
  useEffect(() => {
    setVimOn(localStorage.getItem(VIM_KEY) === "1");
  }, []);

  useEffect(() => {
    if (vimOn === null || !host.current) return;

    const extensions = [
      // vim() must come first — it needs to win the keymap race.
      ...(vimOn ? [vim({ status: true })] : []),
      lineNumbers(),
      highlightActiveLine(),
      history(),
      syntaxHighlighting(markdownHighlight, { fallback: true }),
      drawSelection(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && mirror.current) {
          mirror.current.value = update.state.doc.toString();
        }
      }),
      EditorView.theme({
        "&": {
          fontSize: "13px",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-md)",
          // Superfície própria, não `--background`: um editor com a mesma cor
          // da página só se distingue pela borda, e no escuro os três temas
          // ficavam com a área de digitação diluída no resto da tela.
          backgroundColor: "var(--cm-surface)",
          color: "var(--foreground)",
        },
        "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "1px" },
        ".cm-scroller": {
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          lineHeight: "1.65",
        },
        ".cm-content": {
          minHeight: `${minHeight}px`,
          padding: "10px 0",
          caretColor: "var(--cm-cursor)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--cm-gutter)",
          color: "var(--cm-marker)",
          border: "none",
          borderRight: "1px solid var(--hairline)",
        },
        ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px" },
        ".cm-activeLine": { backgroundColor: "var(--cm-active-line)" },
        // A linha ativa do gutter era transparente, então o número da linha em
        // que o cursor está não se destacava de nenhum outro.
        ".cm-activeLineGutter": {
          backgroundColor: "var(--cm-active-line)",
          color: "var(--foreground)",
        },
        // Seleção desenhada pelo CodeMirror em vez da nativa: a nativa não é
        // estilizável por tema, e o vim a esconde para desenhar o cursor de
        // bloco. Com `drawSelection` as duas seguem o mesmo token.
        "& .cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--cm-selection)",
        },
        // O `&light`/`&dark` do CodeMirror decide por um facet que este editor
        // nunca setou — logo o realce de busca ficava fixo no amarelo de tema
        // claro, invisível no escuro. Resolvido por token, que não depende do
        // facet e acompanha a troca de tema sem recriar o editor.
        ".cm-searchMatch": {
          backgroundColor: "var(--cm-search)",
          outline: "1px solid var(--cm-marker)",
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
          backgroundColor: "var(--cm-selection)",
        },
        // Cursor de bloco do vim. O pacote traz um rosa fixo que ignora o tema,
        // e o texto sob o bloco precisa do contraste invertido para continuar
        // legível — daí a superfície do editor virar cor de texto aqui.
        ".cm-fat-cursor": {
          background: "var(--cm-cursor)",
          color: "var(--cm-surface) !important",
        },
        "&:not(.cm-focused) .cm-fat-cursor": {
          background: "none",
          outline: "solid 1px var(--cm-cursor)",
        },
        ".cm-vim-panel": {
          backgroundColor: "var(--cm-gutter)",
          color: "var(--foreground)",
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: "12px",
          padding: "2px 8px",
        },
        ".cm-panels": {
          borderTop: "1px solid var(--hairline)",
          backgroundColor: "var(--cm-gutter)",
          color: "var(--foreground)",
        },
      }),
    ];

    const state = EditorState.create({ doc: defaultValue, extensions });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;

    if (vimOn) {
      // :w writes the form rather than pretending to save a file — the muscle
      // memory is the point, so it should do the thing the page can do.
      Vim.defineEx("write", "w", () => {
        host.current?.closest("form")?.requestSubmit();
      });
      setStatus(`vim — ${labels.vimHint}`);
    } else {
      setStatus("");
    }

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [vimOn, defaultValue, minHeight, labels.vimHint]);

  /**
   * Keeps the preview fed while typing.
   *
   * CodeMirror owns its own document, so React never sees the keystrokes. The
   * hidden textarea already mirrors the value for form submission; this reads
   * the same source, on a small debounce, only while a preview is visible.
   */
  useEffect(() => {
    // Voltar de "visualizar" reexibe um editor que estava em `display: none`,
    // onde toda medida vale zero. Sem pedir nova medição, a primeira rolagem e
    // o posicionamento do cursor saem errados.
    view.current?.requestMeasure();
    if (mode === "edit" || !view.current) return;
    const tick = setInterval(() => {
      const next = view.current?.state.doc.toString() ?? "";
      setPreviewSource((current) => (current === next ? current : next));
    }, 300);
    // Seed immediately so switching to preview is not blank for a frame.
    setPreviewSource(view.current.state.doc.toString());
    return () => clearInterval(tick);
  }, [mode]);

  function toggleVim() {
    const next = !vimOn;
    setVimOn(next);
    localStorage.setItem(VIM_KEY, next ? "1" : "0");
  }

  const MODES = [
    { id: "edit" as const, label: labels.edit, Icon: Pencil },
    { id: "split" as const, label: labels.split, Icon: Columns2 },
    { id: "preview" as const, label: labels.preview, Icon: Eye },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {/* Segmented control. Icons carry a visible label from `sm` up: an icon
            alone is a guess, and this toolbar has room. */}
        <div
          role="group"
          aria-label={labels.viewMode}
          className="inline-flex overflow-hidden rounded-lg border border-[var(--color-hairline)]"
        >
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              title={label}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 px-2.5 type-micro transition-colors",
                mode === id
                  ? "bg-[var(--color-brand)] text-white"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant={vimOn ? "default" : "outline"}
          size="sm"
          onClick={toggleVim}
          className="h-7"
        >
          vim {vimOn ? "on" : "off"}
        </Button>
        {status && (
          <span className="font-mono type-meta text-muted-foreground">{status}</span>
        )}
        <span className="ml-auto font-mono type-meta text-muted-foreground">markdown</span>
      </div>

      <div
        className={cn(
          "grid gap-3",
          // Side by side only where there is width for it; stacked columns on a
          // phone would be two half-useless panes.
          mode === "split" && "lg:grid-cols-2",
        )}
      >
        {/* Kept mounted in every mode: unmounting would destroy the CodeMirror
            instance and lose the cursor, the history and the vim state. */}
        <div
          ref={host}
          data-user-content
          className={cn(
            "overflow-hidden",
            vimOn === null && "opacity-0",
            mode === "preview" && "hidden",
          )}
        />

        {mode !== "edit" && (
          <div
            data-user-content
            className="overflow-y-auto rounded-lg border border-[var(--color-hairline)] bg-card p-4"
            style={{ minHeight }}
          >
            <MarkdownPreview source={previewSource} emptyLabel={labels.nothingToShow} />
          </div>
        )}
      </div>

      {/* CodeMirror is not a form control, so the value travels through here. */}
      {/* `data-user-content` também aqui: o textarea está oculto, mas o
          currículo é filho de texto dele e a varredura de idioma percorre o DOM
          inteiro, visível ou não. */}
      <textarea
        ref={mirror}
        name={name}
        defaultValue={defaultValue}
        data-user-content
        hidden
        readOnly
      />
    </div>
  );
}
