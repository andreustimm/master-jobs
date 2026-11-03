import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { TransitionLink } from "../../transition-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { can } from "../../../src/contexts/auth/index.ts";
import {
  followedCandidateName,
  parseCandidateSelector,
  recruiterCandidateWorkspace,
  type RecruiterSuggestionView,
} from "../../../src/contexts/pursuit/index.ts";
import { jobLifecycleState } from "../../../src/core/ingest/lifecycle.ts";
import type { LocaleId, Translator } from "../../../src/core/i18n/index.ts";
import { StatusBadge } from "../../ui";
import { applicationStatusOptions } from "../../status.ts";
import { renderSession, requirePage, requireSession } from "../../auth";
import { getTranslator } from "../../i18n";
import { LocalDate } from "../../local-date";
import { CandidateName, DatedText, Pager, candidateTitle } from "../recruiter-ui";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * O nome do candidato no título da aba (US-013.AC-2). O título roda fora da
 * guarda da página, e por isso confere a mesma coisa antes de ler o nome:
 * concessão vigente da sessão e a política. Sem isso, o título genérico — o
 * mesmo para quem não existe e para quem não deu acesso.
 */
export async function generateMetadata({ params }: Pick<Params, "params">): Promise<Metadata> {
  const { t } = await getTranslator();
  const session = await renderSession();
  const id = parseCandidateSelector((await params).candidateId);
  const generic = { title: t("recruiter.title"), robots: { index: false, follow: false } };
  if (session === null || id === null || !session.linkedCandidateIds.includes(id)) return generic;
  if (!can(session, "candidate:read", { kind: "candidate", candidateId: id }).allowed) return generic;
  const person = await followedCandidateName(session, id);
  if (person === null) return generic;
  return { ...generic, title: t("recruiter.pageTitle", { name: candidateTitle(person.name, person.headline, t) }) };
}

/**
 * A página de UM candidato que o recrutador acompanha (US-014, US-019).
 *
 * O id vem da URL, e por isso ele é conferido contra o vínculo da SESSÃO antes
 * de qualquer leitura. Candidato inexistente e candidato que existe mas não é
 * acompanhado recebem a MESMA resposta — 404 —, porque distinguir os dois
 * contaria que aquela pessoa está cadastrada, e existência é informação.
 * É o mesmo raciocínio de `/p/[slug]`.
 *
 * O funil é só de leitura: nenhum controle de estágio, nota ou exclusão
 * (US-014.AC-2). As sugestões listadas são só as deste recrutador na
 * concessão vigente; as de outro recrutador nunca aparecem (US-019.EC-2).
 */
export default async function RecruiterCandidateHistory({ params, searchParams }: Params) {
  const { t, locale } = await getTranslator();
  // "aplicado em {date}" com a data numa ilha que conhece o fuso de quem lê,
  // como em `/pipeline`: o dia em UTC adiantava quem aplicou à noite.
  const [appliedBefore, appliedAfter] = t("pipeline.appliedOn", { date: "\u0000" }).split("\u0000");
  const session = await requireSession();
  const { candidateId: raw } = await params;

  // Id malformado (`abc`, `-1`, `1.5`) cai no mesmo 404 de quem não existe.
  const candidateId = parseCandidateSelector(raw);
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) {
    notFound();
  }
  // O vínculo decide o 404; a POLÍTICA decide a leitura. Sem esta chamada a
  // tela autorizava por conta própria, fora de `can()` — e uma regra nova da
  // política (sessão emprestada, papel retirado) não chegaria aqui. Regra 15.
  await requirePage("candidate:read", { kind: "candidate", candidateId });

  const query = await searchParams;
  const workspace = await recruiterCandidateWorkspace(session, candidateId, {
    page: query.page,
    suggestionsPage: query.spage,
  });
  if (workspace === null) notFound();
  const { funnel, suggestions } = workspace;
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 xl:h-7 xl:min-h-0");
  const hrefWith = (next: { page?: number; spage?: number }): Route => {
    const page = next.page ?? funnel.page;
    const spage = next.spage ?? suggestions.page;
    const search = new URLSearchParams();
    if (page > 1) search.set("page", String(page));
    if (spage > 1) search.set("spage", String(spage));
    const text = search.toString();
    return (text === "" ? `/recruiter/${candidateId}` : `/recruiter/${candidateId}?${text}`) as Route;
  };

  return (
    <main className="pt-10" data-testid="route-recruiter-candidate">
      <TransitionLink
        href="/recruiter"
        data-testid="recruiter-back"
        className="inline-flex min-h-11 items-center type-body-sm text-[var(--primary-text)] hover:underline xl:min-h-0"
      >
        ← {t("recruiter.title")}
      </TransitionLink>
      <h1 className="type-display-md chevron mt-2 mb-1 break-words" data-testid="recruiter-name">
        <CandidateName name={workspace.name} headline={workspace.headline} t={t} />
      </h1>
      <p className="type-body-md mb-1 text-muted-foreground" data-testid="recruiter-funnel-total">
        {t("recruiter.candidateHistory", { count: String(workspace.total) })}
      </p>
      <p className="type-meta mb-4 text-muted-foreground">{t("recruiter.readOnly")}</p>

      <div className="mb-8 flex flex-wrap gap-2">
        <TransitionLink href={`/recruiter/${candidateId}/cv`} className={link} data-testid="recruiter-view-cv">
          {t("recruiter.viewCv")}
        </TransitionLink>
        <TransitionLink href={`/recruiter/${candidateId}/suggest`} className={link} data-testid="recruiter-suggest-link">
          {t("recruiter.suggestJob")}
        </TransitionLink>
        <TransitionLink
          href={`/jobs/new?suggestFor=${candidateId}` as Route}
          className={link}
          data-testid="recruiter-register-job"
        >
          {t("recruiter.registerJob")}
        </TransitionLink>
      </div>

      <div className="mb-8 flex flex-wrap gap-2.5" data-testid="recruiter-funnel-counts">
        {applicationStatusOptions(t)
          .filter(({ value }) => workspace.counts[value])
          .map(({ value, label }) => (
            <Card key={value} className="min-w-[96px] gap-0 px-4 py-2.5">
              <div className="font-mono text-2xl font-bold tabular-nums">{workspace.counts[value]}</div>
              <div className="mt-0.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
                {label}
              </div>
            </Card>
          ))}
      </div>

      {funnel.rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-candidate-empty">
          {t("recruiter.noApplications")}
        </Card>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border" data-testid="recruiter-funnel">
          {funnel.rows.map((row) => (
            <div key={row.jobId} className="bg-card px-4 py-3.5 sm:px-5" data-testid="recruiter-funnel-row">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <TransitionLink
                  href={`/jobs/${row.jobId}`}
                  data-testid={`recruiter-job-${row.jobId}`}
                  className="font-semibold break-words hover:underline"
                >
                  <span data-user-content>{row.title}</span>
                </TransitionLink>
                <StatusBadge status={row.status} t={t} />
                {jobLifecycleState({
                  closedAt: row.jobClosedAt,
                  archivedAt: row.jobArchivedAt,
                }) !== "active" && (
                  <Badge
                    variant="outline"
                    className="font-mono type-micro text-muted-foreground"
                    data-testid={`recruiter-job-state-${row.jobId}`}
                  >
                    {t(row.jobArchivedAt ? "pipeline.jobArchived" : "pipeline.jobClosed")}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <span data-user-content>{row.companyName}</span>
                {row.appliedAt ? (
                  <>
                    {" · "}
                    {appliedBefore}
                    <LocalDate iso={row.appliedAt} locale={locale} testId={`recruiter-applied-${row.jobId}`} />
                    {appliedAfter}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pager
        page={funnel.page}
        pages={funnel.pages}
        href={(page) => hrefWith({ page })}
        testId="recruiter-pagination"
        t={t}
      />

      <MySuggestions view={suggestions} t={t} locale={locale} href={(spage) => hrefWith({ spage })} />
    </main>
  );
}

/** As sugestões deste recrutador a esta pessoa: vaga, data e o que ela decidiu (US-019). */
function MySuggestions({
  view,
  t,
  locale,
  href,
}: {
  view: RecruiterSuggestionView;
  t: Translator["t"];
  locale: LocaleId;
  href: (page: number) => Route;
}) {
  return (
    <section className="mt-10" aria-labelledby="recruiter-suggestions-title" data-testid="recruiter-suggestions">
      <h2 id="recruiter-suggestions-title" className="type-display-xs mb-3">
        {t("recruiter.mySuggestions")}
      </h2>
      {view.rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-suggestions-empty">
          {t("recruiter.mySuggestionsEmpty")}
        </Card>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {view.rows.map((row) => (
            <li
              key={row.byId}
              className="bg-card px-4 py-3.5 sm:px-5"
              data-testid="recruiter-suggestion"
              data-status={row.status}
              data-job-id={row.jobId}
            >
              <div className="flex flex-wrap items-baseline gap-2.5">
                <TransitionLink href={`/jobs/${row.jobId}`} className="font-semibold break-words hover:underline">
                  <span data-user-content>{row.title}</span>
                </TransitionLink>
                <Badge variant="outline" className="font-mono type-micro" data-testid="recruiter-suggestion-status">
                  {row.status === "pending" || row.decidedAt === null ? (
                    t("recruiter.statusPending")
                  ) : (
                    <DatedText
                      t={t}
                      keyName={row.status === "accepted" ? "recruiter.acceptedOn" : "recruiter.declinedOn"}
                      iso={row.decidedAt}
                      locale={locale}
                    />
                  )}
                </Badge>
                {row.jobClosed && (
                  <Badge
                    variant="outline"
                    className="font-mono type-micro text-muted-foreground"
                    data-testid="recruiter-suggestion-closed"
                  >
                    {t("pipeline.jobClosed")}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <span data-user-content>{row.company}</span>
                {" · "}
                <DatedText t={t} keyName="recruiter.suggestedOn" iso={row.suggestedAt} locale={locale} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={view.page} pages={view.pages} href={href} testId="recruiter-suggestions-pagination" t={t} />
    </section>
  );
}
