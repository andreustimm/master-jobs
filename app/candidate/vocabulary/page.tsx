import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { syncCandidateFromProfile, currentDocument } from "../../../src/core/candidate.ts";
import { vocabularyGap } from "../../../src/contexts/skills/index.ts";
import type { GapItem } from "../../../src/contexts/skills/index.ts";
import { requirePage } from "../../auth";

export const dynamic = "force-dynamic";

const MIN_FIT = 60;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/**
 * A demand bar. Deliberately plain: the number is the message, and a chart
 * here would decorate rather than inform.
 */
function Demand({ value, tone }: { value: number; tone: "win" | "gap" | "ok" }) {
  const color =
    tone === "win"
      ? "bg-[var(--color-strong)]"
      : tone === "gap"
        ? "bg-[var(--color-mid)]"
        : "bg-[var(--color-steel)]";
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-fog)]">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
      <span className="type-mono-sm tabular-nums text-muted-foreground">{pct(value)}</span>
    </div>
  );
}

function QuickWin({ item }: { item: GapItem }) {
  return (
    <li className="border-b border-[var(--color-hairline)] py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="type-body-lg font-medium">{item.marketTerm}</span>
          <Badge variant="outline" className="type-micro uppercase tracking-wide">
            {item.skill.category}
          </Badge>
        </div>
        <Demand value={item.demand} tone="win" />
      </div>
      <p className="type-body-sm mt-1 text-muted-foreground">
        Seu CV escreve{" "}
        {item.cvTerms.map((t, i) => (
          <span key={t}>
            {i > 0 && ", "}
            <code className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">{t}</code>
          </span>
        ))}{" "}
        — {item.jobCount} vagas escrevem <strong className="text-foreground">{item.marketTerm}</strong>.
      </p>
    </li>
  );
}

export default async function VocabularyPage() {
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const session = await requirePage("candidate:read");
  void session;

  const candidateId = await syncCandidateFromProfile();
  const doc = await currentDocument(candidateId, "cv");

  if (!doc) {
    return (
      <main className="pt-10 pb-16">
        <h1 className="type-display-md chevron mb-2">Vocabulário</h1>
        <p className="type-body-md text-muted-foreground">
          Nenhum currículo salvo.{" "}
          <Link href="/candidate" className="text-primary hover:underline">
            Cole o seu currículo
          </Link>{" "}
          para comparar com a linguagem do mercado.
        </p>
      </main>
    );
  }

  const report = await vocabularyGap({ cvText: doc.content, minFit: MIN_FIT });

  return (
    <main className="pt-10 pb-16">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">Vocabulário</h1>
        <Link href="/candidate" className="text-sm text-primary hover:underline">
          ← currículo
        </Link>
        <Link href="/candidate/skills" className="text-sm text-primary hover:underline">
          skills →
        </Link>
      </div>

      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        Um filtro de ATS não infere sinônimo: quem recruta busca os termos
        literais do próprio anúncio. Esta página compara a sua linguagem com a
        de <strong className="text-foreground">{report.totalJobs} vagas</strong>{" "}
        acima de {MIN_FIT} de aderência, e separa o que é{" "}
        <strong className="text-foreground">falta de palavra</strong> do que é{" "}
        <strong className="text-foreground">falta de experiência</strong>.
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <div className="type-display-sm tabular-nums">{pct(report.coverage.weighted)}</div>
          <div className="type-body-sm text-muted-foreground">
            do vocabulário do mercado, ponderado por demanda
          </div>
        </div>
        <span className="type-body-sm text-muted-foreground">
          {report.coverage.covered} cobertas · {report.coverage.vocabulary} de vocabulário ·{" "}
          {report.coverage.missing} lacunas reais
        </span>
      </div>

      {report.quickWins.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">Ganho rápido</h2>
            <p className="type-body-sm mb-2 text-muted-foreground">
              Você tem a experiência e o currículo comprova — sob outra grafia.
              Trocar a palavra é a coisa mais barata desta lista.
            </p>
            <ul>
              {report.quickWins.map((item) => (
                <QuickWin key={item.skill.slug} item={item} />
              ))}
            </ul>
            <p className="type-body-sm mt-4 border-t border-[var(--color-hairline)] pt-4 text-muted-foreground">
              Trocar a palavra só vale se a evidência já estiver lá.{" "}
              <strong className="text-foreground">Não invente experiência</strong> para
              casar com um termo.
            </p>
          </CardContent>
        </Card>
      )}

      {report.realGaps.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">Lacuna real</h2>
            <p className="type-body-sm mb-4 text-muted-foreground">
              O mercado pede e o currículo não mostra, sob grafia nenhuma. Nem
              toda lacuna precisa ser fechada — algumas são de vagas que você não
              quer.
            </p>
            <ul>
              {report.realGaps.map((item) => (
                <li
                  key={item.skill.slug}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-hairline)] py-3 last:border-0"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="type-body-md">{item.marketTerm}</span>
                    <Badge variant="outline" className="type-micro uppercase tracking-wide">
                      {item.skill.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="type-body-sm tabular-nums text-muted-foreground">
                      {item.jobCount} vagas
                    </span>
                    <Demand value={item.demand} tone="gap" />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-0">
          <h2 className="type-display-xs mb-4">Já coberto</h2>
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {report.items
              .filter((i) => i.kind === "covered")
              .map((item) => (
                <li key={item.skill.slug} className="flex items-baseline justify-between gap-3">
                  <span className="type-body-sm text-muted-foreground">{item.marketTerm}</span>
                  <Demand value={item.demand} tone="ok" />
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
