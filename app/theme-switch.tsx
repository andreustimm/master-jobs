"use client";

import { useRef, useTransition } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  MODES,
  THEMES,
  modeAttribute,
  type ModeId,
  type ThemeId,
} from "../src/core/theme.ts";
import { setAppearanceAction } from "./theme-action";
import { cn } from "@/lib/utils";

const MODE_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

const POPOVER_ID = "appearance-popover";

/**
 * Aparência: identidade visual e luminosidade, em eixos separados.
 *
 * Aplica no `<html>` na hora e só depois persiste. A ordem importa: esperar o
 * servidor para trocar a cor deixaria um atraso perceptível numa ação que
 * deveria parecer instantânea. A gravação é registro, não gatilho.
 *
 * Usa o Popover API nativo, e não `<details>`.
 *
 * `<details>` parecia suficiente e não é: ele abre e fecha pelo próprio
 * summary, mas **não fecha ao clicar fora**. O Popover tem light dismiss de
 * verdade — clique fora e Escape — pelo navegador, sem estado, sem listener de
 * documento e sem JavaScript nosso.
 *
 * Depois de escolher, fecha explicitamente com `hidePopover()`: manter aberto
 * após a ação obrigaria um segundo clique só para sair do caminho.
 */
export function AppearanceSwitch({
  theme,
  mode,
}: {
  theme: ThemeId;
  mode: ModeId;
}) {
  const [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * Posiciona o painel sob o botão, na abertura.
   *
   * O CSS Anchor Positioning resolveria isto sem script, mas o suporte ainda é
   * irregular e onde falta o popover vai para o centro da tela — foi o que
   * aconteceu. Um canto fixo também não serve: o botão não fica na borda da
   * janela, então o painel abria longe dele.
   *
   * Alinha pela direita do botão e recua se não couber, para nunca sair da
   * janela numa tela estreita.
   */
  function place() {
    const button = trigger.current;
    const panel = document.getElementById(POPOVER_ID);
    if (!button || !panel) return;

    const rect = button.getBoundingClientRect();
    const width = panel.offsetWidth || 256;
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.right - width),
      window.innerWidth - width - margin,
    );

    panel.style.left = `${left}px`;
    panel.style.top = `${rect.bottom + 6}px`;
  }

  function apply(nextTheme: ThemeId, nextMode: ModeId) {
    const root = document.documentElement;
    root.dataset.theme = nextTheme;

    // Em `system` o atributo tem de sumir: é a ausência dele que devolve a
    // decisão para a media query.
    const attr = modeAttribute(nextMode);
    if (attr) root.dataset.mode = attr;
    else delete root.dataset.mode;

    startTransition(() => setAppearanceAction(nextTheme, nextMode));

    // Fecha depois de escolher; deixar aberto obrigaria um clique só para sair.
    document.getElementById(POPOVER_ID)?.hidePopover?.();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={POPOVER_ID}
        onClick={place}
        aria-label="Aparência"
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-action)]",
          "border border-[var(--hairline)] px-2.5 type-micro text-muted-foreground",
          "transition-colors hover:text-foreground",
          pending && "opacity-60",
        )}
      >
        <Palette className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">aparência</span>
      </button>

      <div
        id={POPOVER_ID}
        popover="auto"
        className={cn(
          "w-[16rem] overflow-hidden p-0",
          "rounded-[var(--radius-surface)] border border-[var(--hairline)]",
          "bg-[var(--surface-raised)] text-[var(--card-foreground)] shadow-lg",
          // `left` e `top` vêm de `place()`, na abertura. O `right-auto` impede
          // que o padrão do popover (inset 0 + margin auto) centralize o painel
          // antes de o script medir o botão.
          "fixed top-0 right-auto bottom-auto left-0 m-0",
        )}
      >
        <div className="border-b border-[var(--hairline)] px-3 pt-2.5 pb-1">
          <span className="type-micro text-muted-foreground">tema</span>
        </div>
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => apply(t.id, mode)}
            className={cn(
              "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]",
              t.id === theme && "bg-[var(--muted)]",
            )}
          >
            <Check
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                t.id === theme ? "text-[var(--primary)]" : "opacity-0",
              )}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="type-caption-bold block">{t.label}</span>
              <span className="type-caption-sm block text-muted-foreground">{t.description}</span>
            </span>
          </button>
        ))}

        <div className="border-t border-b border-[var(--hairline)] px-3 pt-2.5 pb-1">
          <span className="type-micro text-muted-foreground">ambiente</span>
        </div>
        <div className="flex gap-1 p-2">
          {MODES.map((m) => {
            const Icon = MODE_ICON[m.id];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => apply(theme, m.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-action)]",
                  "border px-2 py-1.5 type-caption-sm transition-colors",
                  m.id === mode
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--hairline)] text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
