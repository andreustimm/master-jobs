import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MutationFeedbackForm } from "../mutation-feedback";
import { setPublicNameAction } from "./actions";
import { NAME_MAX, type NameError } from "../../src/core/candidate-identity.ts";
import type { Translator } from "../../src/core/i18n/index.ts";

/** Recusas do nome. `Record` sobre a união: código novo sem mensagem não compila. */
function nameMessages(t: Translator["t"]): Record<NameError, string> {
  return {
    nameRequired: t("onboarding.nameRequired"),
    nameTooLong: t("onboarding.nameTooLong", { max: NAME_MAX }),
    nameContact: t("onboarding.nameContact"),
  };
}

/**
 * O nome que `/p/<endereço>` mostra como título, editável pela própria pessoa.
 *
 * Existe porque o nome do candidato não tinha tela: a conta criada pela CLI
 * nascia com o e-mail no lugar do nome, e trocar o nome em Minha conta não
 * mudava o do perfil. Sem nome, o cartão pede um — antes de a pessoa publicar.
 *
 * Sem `maxLength` no campo: o navegador cortaria o nome em silêncio, e a
 * recusa de tamanho é do domínio (`parsePublicName`).
 */
export function PublicNameCard({ current, t }: { current: string; t: Translator["t"] }) {
  const missing = current.trim() === "";
  return (
    <Card className="mb-6" data-testid="public-name-card">
      <CardHeader>
        <CardTitle className="text-lg">{t("publicName.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {missing && (
          <p className="type-body-sm mb-3 text-foreground" data-testid="public-name-missing">
            {t("publicName.missing")}
          </p>
        )}
        <MutationFeedbackForm
          action={setPublicNameAction}
          successMessage={t("publicName.saved")}
          errorMessage={t("feedback.error")}
          resultMessages={nameMessages(t)}
          dismissLabel={t("feedback.dismiss")}
          keepFields
          className="grid gap-2"
        >
          <Label htmlFor="public-name">{t("publicName.label")}</Label>
          <Input
            id="public-name"
            name="name"
            required
            autoComplete="name"
            defaultValue={current}
            aria-describedby="public-name-hint"
            className="min-w-0 max-w-[320px]"
            data-testid="public-name"
          />
          <p id="public-name-hint" className="type-body-sm text-muted-foreground">
            {t("publicName.hint")}
          </p>
          <div>
            <Button type="submit" size="sm" variant="outline" data-testid="save-public-name">
              {t("publicName.save")}
            </Button>
          </div>
        </MutationFeedbackForm>
      </CardContent>
    </Card>
  );
}
