"use client";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { Vim, vim } from "@replit/codemirror-vim";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

export function MarkdownEditor({
  name,
  defaultValue,
  minHeight = 460,
}: {
  name: string;
  defaultValue: string;
  minHeight?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The form posts this hidden input; CodeMirror keeps it in sync.
  const mirror = useRef<HTMLTextAreaElement>(null);
  const [vimOn, setVimOn] = useState<boolean | null>(null);
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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--background)",
          color: "var(--foreground)",
        },
        "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "1px" },
        ".cm-content": {
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          minHeight: `${minHeight}px`,
          caretColor: "var(--foreground)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--muted)",
          color: "var(--muted-foreground)",
          border: "none",
        },
        ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--accent) 35%, transparent)" },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
        // The vim command line, styled like the rest rather than left default.
        ".cm-vim-panel": {
          backgroundColor: "var(--muted)",
          color: "var(--foreground)",
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: "12px",
          padding: "2px 8px",
        },
        ".cm-panels": { borderTop: "1px solid var(--border)" },
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
      setStatus("vim — :w salva");
    } else {
      setStatus("");
    }

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [vimOn, defaultValue, minHeight]);

  function toggleVim() {
    const next = !vimOn;
    setVimOn(next);
    localStorage.setItem(VIM_KEY, next ? "1" : "0");
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
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
          <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          markdown
        </span>
      </div>

      <div ref={host} className={cn("overflow-hidden", vimOn === null && "opacity-0")} />

      {/* CodeMirror is not a form control, so the value travels through here. */}
      <textarea ref={mirror} name={name} defaultValue={defaultValue} hidden readOnly />
    </div>
  );
}
