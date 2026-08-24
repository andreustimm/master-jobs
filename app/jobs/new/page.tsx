import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { createRecruiterJobAction } from "./actions";

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
 */
export default async function NewJobPage() {
  const { t } = await getTranslator();
  await requirePage("job:write");

  return (
    <main className="mx-auto w-full max-w-[62ch] pt-10 pb-16" data-testid="route-jobs-new">
      <h1 className="type-display-md chevron mb-2">{t("jobs.newJob")}</h1>
      <p className="type-body-md mb-xxl text-muted-foreground">{t("jobs.newJobLead")}</p>

      <Card>
        <CardContent className="pt-0">
          <form action={createRecruiterJobAction} className="grid gap-4">
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
            <div>
              {/* `data-testid` porque buscar botão por texto quebra quando alguém
                  traduz — regra que este projeto já pagou para aprender. */}
              <Button type="submit" data-testid="post-job">
                {t("jobs.publish")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
