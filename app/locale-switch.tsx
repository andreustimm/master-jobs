"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { LOCALES, type LocaleId } from "../src/core/i18n/index.ts";
import { setLocaleAction } from "./locale-action";
import { cn } from "@/lib/utils";

const POPOVER_ID = "locale-popover";

/**
 * Troca de idioma.
 *
 * Recarrega depois de gravar, ao contrário do seletor de tema: cor é CSS e
 * troca no cliente, texto vem do servidor. Sem o reload a página ficaria no
 * idioma anterior até a próxima navegação.
 */
export function LocaleSwitch({ current, label }: { current: LocaleId; label: string }) {
  const [pending, startTransition] = useTransition();

  function choose(id: LocaleId) {
    document.getElementById(POPOVER_ID)?.hidePopover?.();
    startTransition(async () => {
      await setLocaleAction(id);
      window.location.reload();
    });
  }

  function place() {
    const button = document.getElementById(`${POPOVER_ID}-trigger`);
    const panel = document.getElementById(POPOVER_ID);
    if (!button || !panel) return;
    const rect = button.getBoundingClientRect();
    const width = panel.offsetWidth || 180;
    panel.style.left = `${Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)}px`;
    panel.style.top = `${rect.bottom + 6}px`;
  }

  const active = LOCALES.find((l) => l.id === current) ?? LOCALES[0];

  return (
    <>
      <button
        id={`${POPOVER_ID}-trigger`}
        type="button"
        popoverTarget={POPOVER_ID}
        onClick={place}
        aria-label={label}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-action)]",
          "border border-[var(--hairline)] px-2.5 type-micro text-muted-foreground",
          "transition-colors hover:text-foreground",
          pending && "opacity-60",
        )}
      >
        <span aria-hidden className="type-caption-sm leading-none">{active.flag}</span>
        {active.short}
      </button>

      <div
        id={POPOVER_ID}
        popover="auto"
        className={cn(
          "w-[11rem] overflow-hidden p-0",
          "rounded-[var(--radius-surface)] border border-[var(--hairline)]",
          "bg-[var(--surface-raised)] text-[var(--card-foreground)] shadow-lg",
          "fixed top-0 right-auto bottom-auto left-0 m-0",
        )}
      >
        {LOCALES.map((locale) => (
          <button
            key={locale.id}
            type="button"
            onClick={() => choose(locale.id)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted)]",
              locale.id === current && "bg-[var(--muted)]",
            )}
          >
            <Check
              className={cn(
                "size-3.5 shrink-0",
                locale.id === current ? "text-[var(--primary-text)]" : "opacity-0",
              )}
              aria-hidden
            />
            <span aria-hidden className="type-body-md leading-none">{locale.flag}</span>
            {/* `lang` é a marcação correta: o nome de um idioma se escreve nele
                mesmo, e "Português" continua em português com a interface em
                inglês. Sem isto o leitor de tela pronuncia o nome com a fonética
                errada — e a verificação de vazamento o acusaria como defeito. */}
            <span lang={locale.id} className="type-caption-md">
              {locale.label}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
