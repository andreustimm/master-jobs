import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { GapReport } from "../src/core/candidate.ts";
import type { Translator } from "../src/core/i18n/index.ts";

/**
 * O que as vagas pedem contra o que o CV diz — isolado em componente próprio
 * porque é puro (só `gap` e `t`, sem banco) e precisa ser testável sem
 * renderizar a página inteira (issue #387, achado 1 da revisão da PR #418).
 *
 * Sem vaga pontuada para comparar (`jobsAnalysed === 0`), "confirmado" e "raro
 * no mercado" são afirmações sobre um mercado que a análise não observou.
 * Mostrá-las é o mesmo defeito de trust damage do critério 2 da #387: dado
 * ausente não pode se disfarçar de diagnóstico. Por isso os dois blocos só
 * aparecem quando há pelo menos uma vaga no corpus.
 */
export function VocabularyGapSection({
  gap,
  t,
}: {
  gap: GapReport;
  t: Translator["t"];
}) {
  return (
    <>
      <Separator className="my-8" />
      <section data-testid="candidate-vocabulary-gap">
        <h2 className="type-display-sm mb-2">
          {t("copy.vocabularyGapTitle")}
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          {t("copy.vocabularyCompared", { jobs: gap.jobsAnalysed, cut: gap.minFit })}</p>

        {gap.jobsAnalysed === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground" data-testid="candidate-gap-no-jobs">
            {t("candidate.noJobsForGap")}
          </Card>
        ) : gap.missing.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">
            {t("candidate.noRelevantGap")}
          </Card>
        ) : (
          <div className="mb-8 grid gap-2">
            {gap.missing.slice(0, 18).map((term) => (
              <div
                key={term.term}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate sm:min-w-[190px] sm:flex-none font-mono text-sm">{term.term}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border">
                  <span
                    className="block h-full rounded-sm bg-[var(--color-mid)]"
                    style={{ width: `${Math.round(term.coverage * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {Math.round(term.coverage * 100)}%
                  <span className="hidden sm:inline"> {t("candidate.ofJobs")}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {gap.jobsAnalysed > 0 && (
          <>
            <details className="mb-6">
              <summary className="cursor-pointer text-sm font-medium">
                {t("copy.vocabularyWorking")} ({gap.confirmed.length})
              </summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {gap.confirmed.map((term) => (
                  <Badge key={term.term} variant="secondary" className="font-mono type-meta">
                    {term.term} · {Math.round(term.coverage * 100)}%
                  </Badge>
                ))}
              </div>
            </details>

            {gap.unused.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {t("copy.vocabularyRareTitle")} ({gap.unused.length})
                </summary>
                <p className="mt-2 mb-3 max-w-[62ch] text-xs text-muted-foreground">
                  {t("copy.vocabularyRareNote")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {gap.unused.map((term) => (
                    <Badge key={term.term} variant="outline" className="font-mono type-meta">
                      {term.term}
                    </Badge>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </>
  );
}
