import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { syncCandidateFromProfile } from "../../../src/core/candidate.ts";
import { candidateSkills, skillDemand } from "../../../src/core/skills.ts";
import { auditAction, detectAction } from "./actions";
import { requirePage } from "../../auth";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  language: "Linguagens",
  framework: "Frameworks",
  ai: "IA",
  cloud: "Cloud e infra",
  data: "Dados",
  practice: "Práticas",
  domain: "Domínios",
  tool: "Ferramentas",
  soft: "Interpessoais",
};

export default async function SkillsPage() {
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const session = await requirePage("candidate:read");
  void session;

  const candidateId = await syncCandidateFromProfile();
  const [mine, demand] = await Promise.all([
    candidateSkills(candidateId),
    skillDemand({ minFit: 60, candidateId }),
  ]);

  const pending = mine.filter((s) => s.status === "detected");
  const confirmed = mine.filter((s) => s.status === "confirmed");
  const rejected = mine.filter((s) => s.status === "rejected");

  // What the market asks for and the candidate does not have confirmed.
  const gaps = demand.filter((d) => d.demand >= 0.15 && d.candidateStatus !== "confirmed");

  const byCategory = pending.reduce<Record<string, typeof pending>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <main className="pt-10 pb-16">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">Skills</h1>
        <Link href="/candidate" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          ← currículo
        </Link>
        <Link href="/candidate/vocabulary" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          vocabulário →
        </Link>
      </div>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        Detectadas automaticamente no seu currículo, contra um catálogo global de
        100 tecnologias e práticas.{" "}
        <strong className="text-foreground">
          Detectada não é confirmada
        </strong>{" "}
        — o sistema afirma que <em>encontrou</em> uma skill, nunca que você a
        tem. Só as confirmadas podem ser citadas como experiência.
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <form action={detectAction}>
          <Button type="submit" variant="outline" size="sm">
            Redetectar do CV
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          {pending.length} a auditar · {confirmed.length} confirmadas ·{" "}
          {rejected.length} rejeitadas
        </span>
      </div>

      {gaps.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">Pedidas pelo mercado, não confirmadas</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Aparecem em pelo menos 15% das vagas acima de 60 de aderência.
            </p>
            <div className="grid gap-2">
              {gaps.slice(0, 12).map((g) => (
                <div key={g.slug} className="flex items-center gap-3">
                  <span className="min-w-[180px] font-mono text-sm">{g.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border">
                    <span
                      className="block h-full rounded-sm bg-[var(--color-mid)]"
                      style={{ width: `${Math.round(g.demand * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                    {Math.round(g.demand * 100)}%
                  </span>
                  <span className="w-24 text-right text-xs">
                    {g.candidateStatus === "detected" ? (
                      <Badge variant="secondary" className="type-micro">a auditar</Badge>
                    ) : g.candidateStatus === "rejected" ? (
                      <Badge variant="destructive" className="type-micro">rejeitada</Badge>
                    ) : (
                      <span className="text-muted-foreground">ausente</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="mb-10">
          <h2 className="type-display-sm mb-2">A auditar</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Cada uma traz a frase do currículo que a produziu, para você julgar.
          </p>

          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat} className="mb-6">
              <h3 className="mb-2 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
                {CATEGORY_LABEL[cat] ?? cat}
              </h3>
              <div className="divide-y overflow-hidden rounded-xl border">
                {items.map((s) => (
                  <div key={s.id} className="grid gap-2 bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <Badge variant="outline" className="font-mono type-micro">
                        {s.occurrences}× no CV
                      </Badge>
                      <span className="ml-auto flex gap-2">
                        <form action={auditAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="status" value="confirmed" />
                          <Button type="submit" size="sm" className="h-7">
                            confirmar
                          </Button>
                        </form>
                        <form action={auditAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <Button type="submit" size="sm" variant="outline" className="h-7">
                            rejeitar
                          </Button>
                        </form>
                      </span>
                    </div>
                    {s.evidence && (
                      <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground italic">
                        {s.evidence}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {confirmed.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-sm mb-3">Confirmadas</h2>
            <div className="flex flex-wrap gap-1.5">
              {confirmed.map((s) => (
                <Badge key={s.id} className="font-mono type-meta">
                  {s.name}
                  {s.level ? ` · ${s.level}` : ""}
                </Badge>
              ))}
            </div>
          </section>
        </>
      )}

      {rejected.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-2 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
            Rejeitadas ({rejected.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {rejected.map((s) => (
              <Badge key={s.id} variant="outline" className={cn("font-mono type-meta line-through opacity-60")}>
                {s.name}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {mine.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhuma skill detectada ainda. Salve um currículo em{" "}
          <Link href="/candidate" className="text-[var(--primary-text)] hover:underline">
            /candidate
          </Link>{" "}
          e clique em “Redetectar do CV”.
        </Card>
      )}
    </main>
  );
}
