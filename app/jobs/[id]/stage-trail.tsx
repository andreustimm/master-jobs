import { cn } from "@/lib/utils";
import {
  FUNNEL_STATUSES,
  type ApplicationStatus,
} from "../../../src/contexts/pursuit/domain/application.ts";
import type { Translator } from "../../../src/core/i18n/index.ts";
import { applicationStatusLabel } from "../../status.ts";

/** Os estágios de progresso; o encerramento aparece só quando é o atual. */
const PROGRESS = FUNNEL_STATUSES.slice(0, FUNNEL_STATUSES.indexOf("offer") + 1);

/**
 * Onde a candidatura está no funil, lido da esquerda para a direita (#316).
 *
 * O seletor diz para onde dá para ir; a trilha diz de onde se está vindo — sem
 * ela, "Voltar" é uma lista de nomes sem posição. Quebra linha em vez de rolar:
 * sete estágios não cabem em 375 px numa linha só.
 */
export function StageTrail({
  current,
  label,
  t,
}: {
  current: ApplicationStatus | null;
  label: string;
  t: Translator["t"];
}) {
  const position = current === null ? -1 : PROGRESS.indexOf(current as (typeof PROGRESS)[number]);
  const closing = current !== null && current !== "untracked" && position === -1 ? current : null;
  return (
    <ol aria-label={label} data-testid="stage-trail" className="mb-3 flex flex-wrap items-center gap-1.5">
      {PROGRESS.map((stage, index) => (
        <li
          key={stage}
          data-testid={`stage-trail-${stage}`}
          aria-current={index === position ? "step" : undefined}
          className={cn(
            "rounded-full border px-2.5 py-0.5 type-caption-sm",
            index === position
              ? "border-[var(--primary-text)] text-[var(--primary-text)]"
              : index < position
                ? "border-border text-foreground"
                : "border-transparent text-muted-foreground",
          )}
        >
          {applicationStatusLabel(stage, t)}
        </li>
      ))}
      {closing && (
        <li
          data-testid={`stage-trail-${closing}`}
          aria-current="step"
          className="rounded-full border border-[var(--primary-text)] px-2.5 py-0.5 type-caption-sm text-[var(--primary-text)]"
        >
          {applicationStatusLabel(closing, t)}
        </li>
      )}
    </ol>
  );
}
