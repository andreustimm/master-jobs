import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { parseCandidateSelector, recruiterCandidateCv } from "../../../../src/contexts/pursuit/index.ts";
import { requirePage, requireSession } from "../../../auth";
import { MarkdownPreview } from "../../../candidate/markdown-preview";
import { getTranslator } from "../../../i18n";
import { TransitionLink } from "../../../transition-link";
import { CandidateName } from "../../recruiter-ui";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("recruiter.cvTitle"), robots: { index: false, follow: false } };
}

/**
 * O currículo atual do candidato acompanhado (US-015): só a versão corrente,
 * como a pessoa enviou, e o download dela. Nenhuma lista de versões, e nenhum
 * parâmetro escolhe outra — `?version=` é ignorado (US-015.EC-2).
 *
 * Mesma porta da página do candidato: id fora do vínculo da sessão é o mesmo
 * 404 de quem não existe, e a política decide a leitura. Abrir grava o último
 * acesso que o candidato vê.
 */
export default async function RecruiterCandidateCv({ params }: { params: Promise<{ candidateId: string }> }) {
  const { t } = await getTranslator();
  const session = await requireSession();
  const candidateId = parseCandidateSelector((await params).candidateId);
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) {
    notFound();
  }
  await requirePage("candidate:read", { kind: "candidate", candidateId });

  const view = await recruiterCandidateCv(session, candidateId);
  if (view === null) notFound();
  const downloadHref = `/recruiter/${candidateId}/cv/download`;

  return (
    <main className="pt-10 pb-16" data-testid="route-recruiter-cv">
      <TransitionLink
        href={`/recruiter/${candidateId}`}
        data-testid="recruiter-cv-back"
        className="inline-flex min-h-11 items-center type-body-sm text-[var(--primary-text)] hover:underline xl:min-h-0"
      >
        {t("recruiter.backToCandidate")}
      </TransitionLink>
      <h1 className="type-display-md chevron mt-2 mb-1 break-words">
        <CandidateName name={view.name} headline={view.headline} t={t} />
      </h1>
      <p className="type-body-md mb-1">{t("recruiter.cvTitle")}</p>
      <p className="type-meta mb-6 max-w-[62ch] text-muted-foreground">{t("recruiter.cvLead")}</p>

      {view.cv.state === "none" ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-cv-none">
          {t("recruiter.cvNone")}
        </Card>
      ) : view.cv.state === "unavailable" ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="recruiter-cv-unavailable">
          {t("recruiter.cvUnavailable")}
        </Card>
      ) : (
        <>
          <div className="mb-4">
            {/* Download do próprio servidor, com nome de arquivo: navegação nativa. */}
            <a
              href={downloadHref}
              download={view.cv.fileName}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 xl:h-7 xl:min-h-0")}
              data-testid="recruiter-cv-download"
            >
              {t("recruiter.cvDownload")}
            </a>
          </div>
          <Card className="min-w-0 overflow-x-auto p-4 sm:p-6" data-testid="recruiter-cv-content" data-user-content>
            <MarkdownPreview source={view.cv.content} emptyLabel={t("recruiter.cvUnavailable")} />
          </Card>
        </>
      )}
    </main>
  );
}
