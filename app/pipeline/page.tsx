import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { pipelineCounts, pipelineRows } from "../../src/core/db/repo.ts";
import { APPLICATION_STATUSES } from "../../src/core/db/schema.ts";
import { Fit, StatusBadge } from "../ui";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const { t, locale } = await getTranslator();
  void locale;
  await requirePage("job:read");

  const [counts, rows] = await Promise.all([pipelineCounts(), pipelineRows()]);

  return (
    <main className="pt-10">
      <h1 className="type-display-md chevron mb-4">{t("pipeline.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.pipelineLead")}
      </p>

      <div className="mb-8 flex flex-wrap gap-2.5">
        {APPLICATION_STATUSES.filter((s) => counts[s]).map((s) => (
          <Card key={s} className="min-w-[96px] gap-0 px-4 py-2.5">
            <div className="font-mono text-2xl font-bold tabular-nums">{counts[s]}</div>
            <div className="mt-0.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
              {s}
            </div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nada no funil ainda. Comece pela{" "}
          <Link href="/jobs" className="text-[var(--primary-text)] hover:underline">
            lista de vagas
          </Link>
          .
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {rows.map((r) => (
            <div
              key={r.jobId}
              className="grid grid-cols-[44px_1fr] items-center gap-3 bg-card px-4 py-3.5 sm:grid-cols-[52px_1fr_auto] sm:gap-4 sm:px-5"
            >
              <div className="text-center">
                <Fit value={r.fit} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <Link href={`/jobs/${r.jobId}`} className="font-semibold hover:underline">
                    {r.title}
                  </Link>
                  <StatusBadge status={r.status} />
                  {r.channel && (
                    <Badge variant="outline" className="font-mono type-micro">
                      {r.channel}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.companyName}
                  {r.appliedAt ? ` · aplicado em ${r.appliedAt.slice(0, 10)}` : ""}
                </div>
                {r.nextAction && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    próximo: {r.nextAction}
                  </div>
                )}
              </div>
              <a
                href={r.url}
                target="_blank"
                rel="noopener"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  // Own row on a phone; right-hand column from `sm` up.
                  "col-span-2 justify-self-start font-mono text-xs sm:col-span-1 sm:justify-self-auto",
                )}
              >
                abrir →
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
