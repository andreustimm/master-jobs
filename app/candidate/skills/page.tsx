import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  SKILL_CATEGORIES,
  candidateSkills,
  skillDemand,
  type SkillCategory,
} from "../../../src/contexts/skills/index.ts";
import type { TranslationKey } from "../../../src/core/i18n/index.ts";
import { auditAction, detectAction } from "./actions";
import { requireOwnCandidatePage } from "../../auth";
import { getTranslator } from "../../i18n";

export const dynamic = "force-dynamic";

/**
 * Categorias, por CHAVE.
 *
 * Guardava o texto pronto, e é a mesma classe de defeito da legenda do score:
 * rótulo dentro de constante não aparece em busca por string no JSX, então
 * sobrevive a uma revisão de tradução inteira. Constante guarda chave.
 */
const CATEGORY_LABEL_KEYS = {
  language: "skillCategories.language",
  framework: "skillCategories.framework",
  ai: "skillCategories.ai",
  cloud: "skillCategories.cloud",
  data: "skillCategories.data",
  practice: "skillCategories.practice",
  domain: "skillCategories.domain",
  tool: "skillCategories.tool",
  soft: "skillCategories.soft",
} satisfies Record<SkillCategory, TranslationKey>;

export default async function SkillsPage() {
  const { t, locale } = await getTranslator();
  void locale;
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const [mine, demand] = await Promise.all([
    candidateSkills(candidateId),
    skillDemand({ minFit: 60, candidateId }),
  ]);

  const pending = mine.filter((s) => s.status === "detected");
  const confirmed = mine.filter((s) => s.status === "confirmed");
  const rejected = mine.filter((s) => s.status === "rejected");

  // What the market asks for and the candidate does not have confirmed.
  const gaps = demand.filter((d) => d.demand >= 0.15 && d.candidateStatus !== "confirmed");

  const byCategory = pending.reduce<Partial<Record<SkillCategory, typeof pending>>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <main className="pt-10 pb-16">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">{t("skills.title")}</h1>
        <Link href="/candidate" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.backToCv")}
        </Link>
        <Link href="/candidate/vocabulary" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.toVocabulary")}
        </Link>
      </div>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.skillsLead")}{" "}
        <strong className="text-foreground">{t("copy.skillsDetectedNotConfirmed")}</strong>{" "}
        {t("copy.skillsLeadTail")}
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <form action={detectAction}>
          <Button type="submit" variant="outline" size="sm">
            {t("skills.redetect")}
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          {pending.length} {t("skills.toAuditCount")} · {confirmed.length} {t("skills.confirmed")} ·{" "}
          {rejected.length} {t("skills.rejected")}
        </span>
      </div>

      {gaps.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-0">
            <h2 className="type-display-xs mb-1">{t("skills.marketWants")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t("skills.marketThreshold")}
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
                      <Badge variant="secondary" className="type-micro">{t("skills.toAuditCount")}</Badge>
                    ) : g.candidateStatus === "rejected" ? (
                      <Badge variant="destructive" className="type-micro">rejeitada</Badge>
                    ) : (
                      <span className="text-muted-foreground">{t("skills.absent")}</span>
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
          <h2 className="type-display-sm mb-2">{t("skills.toAudit")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("copy.auditNote")}
          </p>

          {SKILL_CATEGORIES.map((category) => {
            const items = byCategory[category];
            if (!items?.length) return null;
            return (
              <div key={category} className="mb-6">
                <h3 className="mb-2 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
                  {t(CATEGORY_LABEL_KEYS[category])}
                </h3>
                <div className="divide-y overflow-hidden rounded-xl border">
                  {items.map((s) => (
                    <div key={s.id} className="grid gap-2 bg-card px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span data-user-content className="font-semibold">{s.name}</span>
                        <Badge variant="outline" className="font-mono type-micro">
                          {s.occurrences}× no CV
                        </Badge>
                        <span className="ml-auto flex gap-2">
                          <form action={auditAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="status" value="confirmed" />
                            <Button type="submit" size="sm" className="h-7">
                              {t("skills.confirm")}
                            </Button>
                          </form>
                          <form action={auditAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              {t("skills.reject")}
                            </Button>
                          </form>
                        </span>
                      </div>
                      {s.evidence && (
                        <p
                          data-user-content
                          className="border-l-2 border-border pl-3 text-xs text-muted-foreground italic"
                        >
                          {s.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {confirmed.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-sm mb-3">{t("skills.confirmedTitle")}</h2>
            <div className="flex flex-wrap gap-1.5">
              {confirmed.map((s) => (
                <Badge
                  key={s.id}
                  data-user-content
                  className="font-mono type-meta"
                  // Quem confirmou, no título. "Confirmada" é afirmação de
                  // experiência — a regra 6 existe para que o sistema nunca a
                  // faça sozinho —, e afirmação sem autor não tem a quem
                  // perguntar. A coluna sempre foi escrita e nunca lida.
                  title={
                    s.auditedBy
                      ? `${t("skills.confirmedBy")}: ${s.auditedBy}`
                      : undefined
                  }
                >
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
            {t("skills.rejectedTitle")} ({rejected.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {rejected.map((s) => (
              <Badge
                key={s.id}
                data-user-content
                variant="outline"
                className={cn("font-mono type-meta line-through opacity-60")}
              >
                {s.name}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {mine.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          {t("skills.emptyBefore")} {" "}
          <Link href="/candidate" className="text-[var(--primary-text)] hover:underline">
            /candidate
          </Link>{" "}
          {t("skills.emptyAfter")}
        </Card>
      )}
    </main>
  );
}
