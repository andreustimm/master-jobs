import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MutationFeedbackForm } from "../mutation-feedback";
import { createProfileAction } from "./actions";
import {
  CV_MIN,
  HEADLINE_MAX,
  LOCATION_MAX,
  NAME_MAX,
  type OwnProfileError,
} from "../../src/core/candidate-identity.ts";
import type { Translator } from "../../src/core/i18n/index.ts";

/**
 * Mensagem de cada recusa, já com o limite de verdade. `Record` sobre a união
 * inteira: código novo sem mensagem é erro de compilação, não toast genérico.
 */
function refusalMessages(t: Translator["t"]): Record<OwnProfileError | "unavailable", string> {
  return {
    nameRequired: t("onboarding.nameRequired"),
    nameTooLong: t("onboarding.nameTooLong", { max: NAME_MAX }),
    headlineTooLong: t("onboarding.headlineTooLong", { max: HEADLINE_MAX }),
    locationTooLong: t("onboarding.locationTooLong", { max: LOCATION_MAX }),
    cvTooShort: t("onboarding.cvTooShort", { min: CV_MIN }),
    unavailable: t("onboarding.unavailable"),
  };
}

/**
 * "Criar meu perfil" — o que a conta sem candidato vê em `/candidate`.
 *
 * Os campos ficam preenchidos depois de uma recusa (`keepFields`): perder o
 * currículo colado porque o nome veio vazio é o tipo de atrito que faz a pessoa
 * desistir do cadastro. Nada aqui recebe id de candidato — a conta é a da
 * sessão, e o candidato nasce novo.
 */
export function CreateProfile({ t, suggestedName }: { t: Translator["t"]; suggestedName: string }) {
  const messages = refusalMessages(t);

  return (
    <main className="pt-10 pb-16" data-testid="route-candidate-onboarding">
      <h1 className="type-display-md chevron mb-4">{t("onboarding.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">{t("onboarding.lead")}</p>

      <Card className="max-w-[62ch]">
        <CardContent>
          <MutationFeedbackForm
            action={createProfileAction}
            successMessage={t("onboarding.created")}
            errorMessage={t("feedback.error")}
            resultMessages={messages}
            dismissLabel={t("feedback.dismiss")}
            keepFields
            className="grid gap-4"
            data-testid="create-profile-form"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">{t("onboarding.name")}</Label>
              <Input
                id="profile-name"
                name="name"
                required
                maxLength={NAME_MAX}
                autoComplete="name"
                defaultValue={suggestedName}
                aria-describedby="profile-name-hint"
                data-testid="profile-name"
              />
              <p id="profile-name-hint" className="type-body-sm text-muted-foreground">
                {t("onboarding.nameHint")}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="profile-headline">{t("onboarding.headline")}</Label>
              <Input
                id="profile-headline"
                name="headline"
                maxLength={HEADLINE_MAX}
                aria-describedby="profile-headline-hint"
                data-testid="profile-headline"
              />
              <p id="profile-headline-hint" className="type-body-sm text-muted-foreground">
                {t("onboarding.headlineHint")}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="profile-location">{t("onboarding.location")}</Label>
              <Input
                id="profile-location"
                name="location"
                maxLength={LOCATION_MAX}
                autoComplete="address-level2"
                aria-describedby="profile-location-hint"
                data-testid="profile-location"
              />
              <p id="profile-location-hint" className="type-body-sm text-muted-foreground">
                {t("onboarding.locationHint")}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="profile-cv">{t("onboarding.cv")}</Label>
              <Textarea
                id="profile-cv"
                name="cv"
                rows={8}
                aria-describedby="profile-cv-hint"
                data-testid="profile-cv"
              />
              <p id="profile-cv-hint" className="type-body-sm text-muted-foreground">
                {t("onboarding.cvHint")}
              </p>
            </div>

            <p className="type-body-sm text-muted-foreground">{t("onboarding.privateNote")}</p>

            <div>
              <Button type="submit" data-testid="create-profile">
                {t("onboarding.submit")}
              </Button>
            </div>
          </MutationFeedbackForm>
        </CardContent>
      </Card>
    </main>
  );
}
