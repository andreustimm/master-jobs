import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { companiesWithContacts, referralOpportunities } from "../../src/core/contacts.ts";
import { Fit, StatusBadge } from "../ui";

export const dynamic = "force-dynamic";

export default async function Referrals() {
  const [opps, network] = await Promise.all([
    referralOpportunities(40),
    companiesWithContacts(),
  ]);

  return (
    <main className="pt-10">
      <h1 className="type-display-md chevron mb-4">Referrals</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        Vagas abertas onde você já conhece alguém. Referrals são ~7% dos candidatos
        e ~40% das contratações — nenhuma outra alavanca do sistema chega perto.
      </p>

      {opps.length === 0 ? (
        <Card className="p-6 text-muted-foreground">
          {network.size === 0 ? (
            <>
              Nenhum contato registrado. Comece com{" "}
              <code className="font-mono text-foreground">pnpm jho contacts seed</code>, que
              carrega as empresas onde você já trabalhou.
            </>
          ) : (
            <>
              <strong className="text-foreground">{network.size} empresa(s)</strong> na sua rede,
              nenhuma com vaga aberta no acervo hoje. Isso é uma resposta, não um erro — quando
              abrir, aparece aqui.
            </>
          )}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {opps.map((o) => (
            <div
              key={o.jobId}
              className="grid grid-cols-[44px_1fr] items-center gap-3 bg-card px-4 py-3.5 sm:grid-cols-[52px_1fr_auto] sm:gap-4 sm:px-5"
            >
              <div className="text-center">
                <Fit value={o.fit} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <Link href={`/jobs/${o.jobId}`} className="font-semibold hover:underline">
                    {o.title}
                  </Link>
                  {o.status && <StatusBadge status={o.status} />}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{o.companyName}</div>
                <div className="mt-1 text-xs text-[var(--color-strong)]">
                  via {o.contacts.join(", ")}
                </div>
              </div>
              <a
                href={o.applyUrl ?? o.url}
                target="_blank"
                rel="noopener"
                className={cn(
                  buttonVariants({ size: "sm" }),
                  // Own row on a phone; right-hand column from `sm` up.
                  "col-span-2 justify-self-start font-mono text-xs sm:col-span-1 sm:justify-self-auto",
                )}
              >
                aplicar →
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
