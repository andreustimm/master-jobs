import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { listBoard } from "../src/core/db/repo.ts";
import { formatMoney, money, parseCurrency, parsePeriod } from "../src/core/money.ts";
import { Fit, ScoreBar, StatusBadge } from "./ui";

type Row = Awaited<ReturnType<typeof listBoard>>[number];

function pay(r: Row): string | null {
  const amount = r.compMax ?? r.compMin;
  const currency = parseCurrency(r.compCurrency);
  const period = parsePeriod(r.compPeriod);
  if (!amount || amount <= 0 || !currency || !period) return null;
  return formatMoney(money(amount, currency, period), "pt-BR");
}

export function JobList({ rows, dense = false }: { rows: Row[]; dense?: boolean }) {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma vaga com esses filtros. Afrouxe o corte ou desligue algum critério.
      </Card>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {rows.map((r) => {
        const blockers = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
        const salary = pay(r);
        // Jobgether and other intermediaries publish under their own name, so
        // the employer is unknowable — worth saying, since you cannot research
        // the company or use your network on one of these.
        const anonymous =
          r.sourceLabel && r.companyName.toLowerCase() === r.sourceLabel.toLowerCase();

        return (
          <article
            key={r.jobId}
            className={cn(
              "grid grid-cols-[58px_1fr_auto] items-start gap-4 bg-card transition-colors hover:bg-muted/40",
              dense ? "px-4 py-2.5" : "px-5 py-4",
            )}
          >
            <div className="pt-0.5 text-center">
              <Fit value={r.fit} />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <Link
                  href={`/jobs/${r.jobId}`}
                  className="text-[15.5px] font-semibold hover:underline"
                >
                  {r.title}
                </Link>
                {r.status && <StatusBadge status={r.status} />}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span
                  className={cn("font-semibold", anonymous ? "text-muted-foreground" : "text-foreground")}
                >
                  {anonymous ? `${r.companyName} · empregador oculto` : r.companyName}
                </span>
                {r.cluster && (
                  <Badge variant="outline" className="font-mono text-[10px] text-primary">
                    {r.cluster}
                  </Badge>
                )}
                {salary && <span className="font-mono text-foreground">{salary}</span>}
                {r.locationRaw && <span className="truncate">{r.locationRaw.slice(0, 62)}</span>}
              </div>

              {!dense && (
                <div className="mt-2.5">
                  <ScoreBar parts={r as unknown as Record<string, number | null>} />
                </div>
              )}

              {r.descriptionLength < 200 && (
                <p className="mt-2 text-xs text-[var(--color-mid)]">
                  sem descrição — a nota está subestimada, não baixa
                </p>
              )}
              {blockers.length > 0 && (
                <p className="mt-2 text-xs text-destructive">⚠ {blockers.join("; ")}</p>
              )}
            </div>

            {/* Two links, because they are two different pages: on Lever the
                /apply suffix opens the form, while the bare URL is where the
                description lives. Sending someone to a form for a job they have
                not read is the wrong default. */}
            <div className="flex flex-col gap-1.5 pt-0.5">
              <a
                href={r.url}
                target="_blank"
                rel="noopener"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "font-mono text-xs")}
              >
                ver vaga
              </a>
              {r.applyUrl && r.applyUrl !== r.url && (
                <a
                  href={r.applyUrl}
                  target="_blank"
                  rel="noopener"
                  className={cn(buttonVariants({ size: "sm" }), "font-mono text-xs")}
                >
                  aplicar →
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
