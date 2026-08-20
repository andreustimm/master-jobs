import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  analyseGap,
  currentDocument,
  documentHistory,
  getCandidateById,
} from "../../src/core/candidate.ts";
import { MarkdownEditor } from "./editor";
import { VersionHistory } from "./versions";
import { importPdfAction, saveCvAction } from "./actions";
import { requireOwnCandidatePage } from "../auth";
import { getTranslator } from "../i18n";
import { formatNumber, type Translator } from "../../src/core/i18n/index.ts";

export const dynamic = "force-dynamic";

/**
 * Rótulos do histórico, já traduzidos.
 *
 * O modal é ilha de cliente e o tradutor tem métodos — método não atravessa a
 * fronteira do Server Component. Um mapa plano de strings atravessa, e mantém
 * o i18n do lado servidor como no resto da aplicação.
 */
const VERSION_KEYS = [
  "title", "open", "empty", "close", "cancel", "current", "chars", "view",
  "restore", "rename", "remove", "save", "newLabel", "restoredSuffix",
  "rendered", "raw", "sameAsCurrent", "deltaMore", "deltaLess",
  "confirmDelete", "confirmRestore", "errorNotFound", "errorEmptyLabel",
  "errorLabelTooLong", "errorIsCurrent", "errorReferenced", "referencedBy",
] as const;

function versionLabels(t: Translator["t"]): Record<string, string> {
  return Object.fromEntries(VERSION_KEYS.map((key) => [key, t(`versions.${key}`)]));
}

export default async function CandidateArea() {
  const { t, locale } = await getTranslator();
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const { candidateId } = await requireOwnCandidatePage("candidate:read");

  const person = await getCandidateById(candidateId);
  const doc = person ? await currentDocument(person.id, "cv") : null;
  const history = person ? await documentHistory(person.id, "cv") : [];
  const gap = await analyseGap({ candidateId, minFit: 60 });

  return (
    <main className="pt-10 pb-16">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">{t("candidate.title")}</h1>
        <Link href="/candidate/skills" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.toSkills")}
        </Link>
        <Link href="/candidate/vocabulary" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("candidate.toVocabulary")}
        </Link>
      </div>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        {t("copy.candidateLead")}{" "}
        <strong className="text-foreground">
          {t("copy.vocabularyLead")}
        </strong>
        .
      </p>

      {person && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{person.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            {/* Dado do usuário: `profile.yaml` está no idioma dele, e continua
                assim com a interface em inglês. Ver a nota em `tests/e2e`. */}
            {person.headline && (
              <p data-user-content className="text-foreground">
                {person.headline}
              </p>
            )}
            <p data-user-content className="mt-1">
              {[person.location, person.email].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 font-mono type-meta">
              {t("copy.identityFrom", { file: "profile/profile.yaml" })}
            </p>
          </CardContent>
        </Card>
      )}

      <form
        action={importPdfAction}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-cloud)] p-4"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="file">{t("candidate.importPdf")}</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            className="max-w-[320px]"
          />
        </div>
        <Button type="submit" variant="outline">
          {t("candidate.extractText")}
        </Button>
        <p className="type-body-sm w-full text-muted-foreground">
          {t("copy.pdfNewVersion")}{" "}
          <strong className="text-foreground">{t("copy.pdfReviewFirst")}</strong>.{" "}
          {t("copy.pdfCaveat")}
        </p>
      </form>

      <form action={saveCvAction} className="mb-8 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="label">{t("candidate.versionLabel")}</Label>
          <Input
            id="label"
            name="label"
            placeholder="ATS EN 2026-08"
            defaultValue={doc?.label ?? ""}
            className="max-w-[320px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="content">{t("candidate.cvMarkdown")}</Label>
          <MarkdownEditor
            name="content"
            defaultValue={doc?.content ?? ""}
            labels={{
              edit: t("candidate.edit"),
              split: t("candidate.split"),
              preview: t("candidate.preview"),
              viewMode: t("candidate.viewMode"),
              vimHint: t("candidate.vimHint"),
              nothingToShow: t("candidate.nothingToShow"),
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit">{t("candidate.save")}</Button>
          {doc && (
            <span className="text-xs text-muted-foreground">
              {t("candidate.current")}: {" "}
              <strong data-user-content className="text-foreground">{doc.label}</strong> ·{" "}
              {formatNumber(doc.content.length, locale)} {t("candidate.chars")} ·{" "}
              {t("candidate.savedOn")} {" "}
              {doc.createdAt.slice(0, 10)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("copy.pdfUploadTodo", { fields: "format, source_filename" })}
        </p>
      </form>

      {gap && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-sm mb-2">
              {t("copy.vocabularyGapTitle")}
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              {t("copy.vocabularyCompared", { jobs: gap.jobsAnalysed, cut: gap.minFit })}</p>

            {gap.missing.length === 0 ? (
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
          </section>
        </>
      )}

      {!gap && (
        <Card className="p-5 text-sm text-muted-foreground">
          {t("candidate.gapEmpty")}
        </Card>
      )}

      {history.length > 0 && (
        <>
          <Separator className="my-8" />
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="type-display-xs">{t("candidate.versions")}</h2>
              {/* A lista abaixo é leitura; as operações moram no modal. Ver e
                  restaurar são decisões que merecem foco e confirmação, não um
                  clique perdido no meio de uma página longa. */}
              <VersionHistory
                rows={history.map((h) => ({
                  id: h.id,
                  label: h.label,
                  isCurrent: h.isCurrent,
                  length: h.length,
                  createdAt: h.createdAt,
                }))}
                currentLength={doc?.content.length ?? 0}
                locale={locale}
                labels={versionLabels(t)}
              />
            </div>
            <div className="divide-y overflow-hidden rounded-xl border">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 bg-card px-4 py-2.5 text-sm">
                  {h.isCurrent ? (
                    <Badge className="type-micro">{t("candidate.current")}</Badge>
                  ) : (
                    <span className="w-[46px]" />
                  )}
                  <span data-user-content className="flex-1">{h.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatNumber(h.length, locale)} {t("candidate.chars")}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {h.createdAt.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
