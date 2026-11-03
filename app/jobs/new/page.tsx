import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { followedCandidateName, parseCandidateSelector } from "../../../src/contexts/pursuit/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { CandidateName } from "../../recruiter/recruiter-ui";
import { createRecruiterJobAction } from "./actions";
import { MutationFeedbackForm } from "../../mutation-feedback";

export const dynamic = "force-dynamic";

/**
 * Cadastro de vaga oferecida por um recrutador.
 *
 * `job:write` é permissão sobre o acervo GLOBAL, e os três papéis a têm — o
 * acervo é compartilhado, não é de ninguém. O que distingue esta vaga das
 * outras não é quem pode criá-la, é a fonte que ela cria: `recruiter:<host>`,
 * de onde o rótulo deriva na leitura.
 *
 * A URL é opcional de propósito. Um recrutador frequentemente oferece uma vaga
 * que ainda não está publicada em lugar nenhum, e exigir link a transformaria
 * em anúncio — que é justamente o que ela não é.
 *
 * Com `?suggestFor=<id>` de um candidato acompanhado, a vaga também é sugerida
 * a ele, com nota opcional (#465, ADR-015). Id fora do vínculo da sessão dá o
 * mesmo 404 de um candidato que não existe.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslator();
  const session = await requirePage("job:write");
  const raw = (await searchParams).suggestFor;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  let target: { id: number; name: string; headline: string | null } | null = null;
  if (requested !== undefined && requested !== "") {
    const id = parseCandidateSelector(requested);
    if (id === null || !session.linkedCandidateIds.includes(id)) notFound();
    const person = await followedCandidateName(session, id);
    if (person === null) notFound();
    target = { id, ...person };
  }
  const [noticeBefore, noticeAfter] = t("recruiter.suggestForNotice", { name: "\u0000" }).split("\u0000");

  return (
    <main className="mx-auto w-full max-w-[62ch] pt-10 pb-16" data-testid="route-jobs-new">
      <h1 className="type-display-md chevron mb-2">{t("jobs.newJob")}</h1>
      <p className="type-body-md mb-xxl text-muted-foreground">{t("jobs.newJobLead")}</p>
      {target && (
        <p className="type-body-sm mb-4 break-words" data-testid="jobs-new-suggest-for">
          {noticeBefore}
          <CandidateName name={target.name} headline={target.headline} t={t} />
          {noticeAfter}
        </p>
      )}

      <Card>
        <CardContent className="pt-0">
          <MutationFeedbackForm
            action={createRecruiterJobAction}
            successMessage={t("feedback.success")}
            errorMessage={t("feedback.error")}
            resultMessages={{ note_too_long: t("suggestionError.note_too_long") }}
            dismissLabel={t("feedback.dismiss")}
            // Uma recusa (nota longa, campo faltando) não apaga o que foi digitado.
            keepFields
            className="grid gap-4"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="title">{t("jobs.jobTitle")}</Label>
              <Input id="title" name="title" required autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="companyName">{t("jobs.company")}</Label>
              <Input id="companyName" name="companyName" required autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="location">{t("jobs.location")}</Label>
              <Input id="location" name="location" autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="url">{t("jobs.publicUrl")}</Label>
              <Input id="url" name="url" type="url" inputMode="url" autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="description">{t("jobs.description")}</Label>
              {/* A descrição é o que alimenta o score: keywords, senioridade,
                  elegibilidade e benefícios saem daqui. Um cadastro curto
                  pontua com o que tem — o que falta vale neutro, e não
                  bloqueador, senão a nota mediria a digitação e não o emprego. */}
              <Textarea id="description" name="description" required rows={12} />
            </div>
            {target && (
              <div className="grid gap-1.5">
                <input type="hidden" name="suggestFor" value={target.id} />
                <Label htmlFor="note">{t("recruiter.noteLabel")}</Label>
                <Textarea id="note" name="note" rows={4} aria-describedby="note-hint" data-testid="jobs-new-note" />
                <p id="note-hint" className="type-meta text-muted-foreground">
                  {t("recruiter.noteHint")}
                </p>
              </div>
            )}
            <div>
              {/* `data-testid` porque buscar botão por texto quebra quando alguém
                  traduz — regra que este projeto já pagou para aprender. */}
              <Button type="submit" data-testid="post-job">
                {t("jobs.publish")}
              </Button>
            </div>
          </MutationFeedbackForm>
        </CardContent>
      </Card>
    </main>
  );
}
