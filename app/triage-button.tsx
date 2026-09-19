import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { allowedTransitions, type ApplicationStatus } from "../src/contexts/pursuit/domain/application.ts";
import type { Translator } from "../src/core/i18n/index.ts";
import { dismissJobAction, restoreJobAction } from "./actions";

/**
 * "Não me interessa", ou "restaurar" na vaga arquivada — o que o estágio
 * permitir, lido da mesma regra do seletor (`allowedTransitions`). Um
 * formulário com Server Action e nenhum JS de cliente: o clique arquiva, a
 * página revalida e a vaga sai da lista.
 */
export function TriageButton({
  jobId,
  status,
  appliedAt,
  place,
  t,
  className,
}: {
  jobId: number;
  status: string | null;
  appliedAt: string | null;
  /** `row` na lista, com os rótulos curtos dela; `page` no detalhe da vaga. */
  place: "row" | "page";
  t: Translator["t"];
  className?: string;
}) {
  // Status fora do funil degrada para "nenhum botão": `allowedTransitions`
  // devolve só o próprio status, e nenhum dos dois destinos aparece.
  const allowed = allowedTransitions(status as ApplicationStatus | null, appliedAt);
  const restore = status === "archived";
  if (!allowed.includes(restore ? "backlog" : "archived")) return null;

  const label = restore
    ? t(place === "row" ? "jobs.restore" : "jobDetail.restore")
    : t(place === "row" ? "jobs.notInterested" : "jobDetail.notInterested");
  return (
    <form action={restore ? restoreJobAction : dismissJobAction} className="contents">
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        title={t(restore ? "jobs.restoreHint" : "jobs.notInterestedHint")}
        data-testid={`job-${restore ? "restore" : "dismiss"}-${jobId}`}
        className={cn(buttonVariants(place === "row" ? { variant: "ghost", size: "sm" } : { variant: "outline" }), className)}
      >
        {label}
      </button>
    </form>
  );
}
