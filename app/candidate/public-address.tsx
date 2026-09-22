import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MutationFeedbackForm } from "../mutation-feedback";
import { setPublicSlugAction } from "./actions";
import { SLUG_MAX, SLUG_MIN, type PublicSlugError } from "../../src/core/candidate-identity.ts";
import type { Translator } from "../../src/core/i18n/index.ts";

/**
 * Recusas do endereço público, já com os limites reais. `Record` sobre a união
 * inteira: código novo sem mensagem é erro de compilação.
 */
export function publicSlugMessages(t: Translator["t"]): Record<PublicSlugError | "slugTaken", string> {
  return {
    slugInvalid: t("publicAddress.slugInvalid"),
    slugTooShort: t("publicAddress.slugTooShort", { min: SLUG_MIN }),
    slugTooLong: t("publicAddress.slugTooLong", { max: SLUG_MAX }),
    slugReserved: t("publicAddress.slugReserved"),
    slugTaken: t("publicAddress.slugTaken"),
  };
}

/**
 * O endereço `/p/<slug>` do próprio perfil, editável.
 *
 * Aparece mesmo com o perfil privado: escolher o endereço antes de publicar é
 * o caminho natural, e a dica diz que ele só responde quando o perfil é Público.
 * O aviso de troca fica sempre visível — é quem já compartilhou o link que
 * precisa lê-lo.
 */
export function PublicAddressCard({ current, t }: { current: string; t: Translator["t"] }) {
  return (
    <Card className="mb-6" data-testid="public-address-card">
      <CardHeader>
        <CardTitle className="text-lg">{t("publicAddress.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <MutationFeedbackForm
          action={setPublicSlugAction}
          successMessage={t("publicAddress.saved")}
          errorMessage={t("feedback.error")}
          resultMessages={publicSlugMessages(t)}
          dismissLabel={t("feedback.dismiss")}
          keepFields
          className="grid gap-2"
        >
          <Label htmlFor="public-slug">{t("publicAddress.label")}</Label>
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="font-mono type-body-sm text-muted-foreground">
              /p/
            </span>
            <Input
              id="public-slug"
              name="publicSlug"
              required
              minLength={SLUG_MIN}
              maxLength={SLUG_MAX}
              defaultValue={current}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="public-slug-hint public-slug-warning"
              className="min-w-0 max-w-[320px] font-mono"
              data-testid="public-slug"
            />
          </div>
          <p id="public-slug-hint" className="type-body-sm text-muted-foreground">
            {t("publicAddress.hint", { min: SLUG_MIN, max: SLUG_MAX })}
          </p>
          <p id="public-slug-warning" className="type-body-sm text-muted-foreground">
            {t("publicAddress.changeWarning")}
          </p>
          <div>
            <Button type="submit" size="sm" variant="outline" data-testid="save-public-slug">
              {t("publicAddress.save")}
            </Button>
          </div>
        </MutationFeedbackForm>
      </CardContent>
    </Card>
  );
}
