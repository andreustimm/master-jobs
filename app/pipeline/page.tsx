import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { pipelineCounts, pipelineRows } from "../../src/core/db/repo.ts";
import { APPLICATION_STATUSES } from "../../src/core/db/schema.ts";
import { Fit, StatusBadge } from "../ui";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const [counts, rows] = await Promise.all([pipelineCounts(), pipelineRows()]);

  return (
    <main className="pt-10">
      <h1 className="type-display-md chevron mb-4">Funil</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        A única coisa que o sistema não consegue recriar. Nenhuma ingestão escreve
        aqui — só você.
      </p>

      <div className="mb-8 flex flex-wrap gap-2.5">
        {APPLICATION_STATUSES.filter((s) => counts[s]).map((s) => (
          <Card key={s} className="min-w-[96px] gap-0 px-4 py-2.5">
            <div className="font-mono text-2xl font-bold tabular-nums">{counts[s]}</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-[.1em] text-muted-foreground uppercase">
              {s}
            </div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nada no funil ainda. Comece pela{" "}
          <Link href="/jobs" className="text-primary hover:underline">
            lista de vagas
          </Link>
          .
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {rows.map((r) => (
            <div
              key={r.jobId}
              className="grid grid-cols-[52px_1fr_auto] items-center gap-4 bg-card px-5 py-3.5"
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
                    <Badge variant="outline" className="font-mono text-[10px]">
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
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "font-mono text-xs")}
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
