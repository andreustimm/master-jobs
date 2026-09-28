import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MutationFeedbackForm } from "../mutation-feedback";
import { setPublicFactsAction } from "./actions";
import {
  AVAILABILITY_LABEL,
  EXPERIENCE_LEVEL_LABEL,
  FACT_LABEL,
  START_TIMEFRAME_LABEL,
  WORK_MODEL_LABEL,
} from "./public-facts-labels";
import {
  AREA_MAX,
  AVAILABILITY_STATUSES,
  EXPERIENCE_LEVELS,
  LANGUAGES_MAX,
  OPT_IN_COLUMN,
  START_TIMEFRAMES,
  WORK_MODELS,
  type PublicFactKey,
  type PublicFactsError,
  type StoredFacts,
} from "../../src/core/candidate-public-facts.ts";
import type { TranslationKey, Translator } from "../../src/core/i18n/index.ts";

/** Recusas por código. `Record` sobre a união: código novo sem mensagem não compila. */
function factsMessages(t: Translator["t"]): Record<PublicFactsError, string> {
  return {
    invalidChoice: t("publicFacts.errorInvalidChoice"),
    areaTooLong: t("publicFacts.errorAreaTooLong", { max: AREA_MAX }),
    areaContact: t("publicFacts.errorAreaContact"),
    areaPay: t("publicFacts.errorAreaPay"),
    areaNumber: t("publicFacts.errorAreaNumber"),
    languagesTooLong: t("publicFacts.errorLanguagesTooLong", { max: LANGUAGES_MAX }),
    languagesContact: t("publicFacts.errorLanguagesContact"),
    languagesPay: t("publicFacts.errorLanguagesPay"),
    languagesNumber: t("publicFacts.errorLanguagesNumber"),
  };
}

const SELECT_CLASS = cn(
  "h-9 w-full min-w-0 max-w-[320px] rounded-lg border border-input bg-background px-3 text-sm",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
);

const labelId = (field: PublicFactKey) => `public-fact-${field}-label`;

/**
 * Um fato: o controle e, logo abaixo, o "Mostrar no perfil público" dele.
 * A caixa fica junto do campo, e não num bloco de consentimentos no fim:
 * separar os dois é como alguém marca "mostrar" achando que é outro campo.
 */
function Fact({
  field,
  shown,
  t,
  children,
}: {
  field: PublicFactKey;
  shown: boolean;
  t: Translator["t"];
  children: ReactNode;
}) {
  return (
    // O grupo leva o nome do fato: as sete caixas "Mostrar" têm o mesmo
    // texto, e o leitor de tela precisa saber de qual campo cada uma é.
    <div
      role="group"
      aria-labelledby={labelId(field)}
      className="grid min-w-0 gap-1.5 rounded-[var(--radius-action)] border border-[var(--hairline)] p-3"
      data-testid={`public-fact-field-${field}`}
    >
      {children}
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 type-body-sm xl:min-h-0">
        <input
          type="checkbox"
          name={`show-${field}`}
          defaultChecked={shown}
          className="cursor-pointer"
          data-testid={`public-fact-show-${field}`}
        />
        {t("publicFacts.show")}
      </label>
    </div>
  );
}

function ChoiceSelect<T extends string>({
  field,
  options,
  labels,
  current,
  t,
}: {
  field: PublicFactKey;
  options: readonly T[];
  labels: Record<T, TranslationKey>;
  current: string | null;
  t: Translator["t"];
}) {
  const id = `public-fact-${field}`;
  return (
    <>
      <Label id={labelId(field)} htmlFor={id}>
        {t(FACT_LABEL[field])}
      </Label>
      <select id={id} name={field} defaultValue={current ?? ""} className={SELECT_CLASS} data-testid={id}>
        <option value="">{t("publicFacts.notInformed")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {t(labels[option])}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * "Dados do perfil público" (#327): sete fatos, cada um com o próprio opt-in,
 * desmarcado por padrão. Desmarcado, o dado fica guardado e não sai em `/p/`.
 *
 * Pretensão salarial não é campo aqui, e a dica diz isso com todas as letras:
 * quem procura onde pôr o piso precisa ler que ele nunca sai.
 */
export function PublicFactsCard({ current, t }: { current: StoredFacts; t: Translator["t"] }) {
  // Nulo (linha importada) é desligado, como na saída.
  const shown = (field: PublicFactKey) => current[OPT_IN_COLUMN[field]] === true;
  const models = new Set(current.workModel ?? []);
  const relocation = current.openToRelocation === null ? "" : current.openToRelocation ? "yes" : "no";

  return (
    <Card className="mb-6" data-testid="public-facts-card">
      <CardHeader>
        <CardTitle className="text-lg">{t("publicFacts.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="type-body-sm mb-1 text-muted-foreground">{t("publicFacts.hint")}</p>
        <p className="type-body-sm mb-3 text-muted-foreground">{t("publicFacts.neverPay")}</p>
        <MutationFeedbackForm
          action={setPublicFactsAction}
          successMessage={t("publicFacts.saved")}
          errorMessage={t("feedback.error")}
          resultMessages={factsMessages(t)}
          dismissLabel={t("feedback.dismiss")}
          keepFields
          className="grid gap-3"
        >
          <Fact field="workModel" shown={shown("workModel")} t={t}>
            <fieldset className="min-w-0">
              <legend id={labelId("workModel")} className="mb-1.5 text-sm leading-none font-medium">{t(FACT_LABEL.workModel)}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {WORK_MODELS.map((model) => (
                  <label key={model} className="flex min-h-11 cursor-pointer items-center gap-2 type-body-sm xl:min-h-0">
                    <input
                      type="checkbox"
                      name="workModel"
                      value={model}
                      defaultChecked={models.has(model)}
                      className="cursor-pointer"
                      data-testid={`public-fact-workModel-${model}`}
                    />
                    {t(WORK_MODEL_LABEL[model])}
                  </label>
                ))}
              </div>
            </fieldset>
          </Fact>

          <Fact field="experienceLevel" shown={shown("experienceLevel")} t={t}>
            <ChoiceSelect
              field="experienceLevel"
              options={EXPERIENCE_LEVELS}
              labels={EXPERIENCE_LEVEL_LABEL}
              current={current.experienceLevel}
              t={t}
            />
          </Fact>

          <Fact field="availability" shown={shown("availability")} t={t}>
            <ChoiceSelect
              field="availability"
              options={AVAILABILITY_STATUSES}
              labels={AVAILABILITY_LABEL}
              current={current.availability}
              t={t}
            />
          </Fact>

          <Fact field="startTimeframe" shown={shown("startTimeframe")} t={t}>
            <ChoiceSelect
              field="startTimeframe"
              options={START_TIMEFRAMES}
              labels={START_TIMEFRAME_LABEL}
              current={current.startTimeframe}
              t={t}
            />
          </Fact>

          <Fact field="openToRelocation" shown={shown("openToRelocation")} t={t}>
            <Label id={labelId("openToRelocation")} htmlFor="public-fact-openToRelocation">{t(FACT_LABEL.openToRelocation)}</Label>
            <select
              id="public-fact-openToRelocation"
              name="openToRelocation"
              defaultValue={relocation}
              className={SELECT_CLASS}
              data-testid="public-fact-openToRelocation"
            >
              <option value="">{t("publicFacts.notInformed")}</option>
              <option value="yes">{t("publicFacts.yes")}</option>
              <option value="no">{t("publicFacts.no")}</option>
            </select>
          </Fact>

          {/* Sem `maxLength`: o navegador cortaria em silêncio, e a recusa de
              tamanho é do domínio (`parsePublicFactsForm`), que diz qual é. */}
          <Fact field="area" shown={shown("area")} t={t}>
            <Label id={labelId("area")} htmlFor="public-fact-area">{t(FACT_LABEL.area)}</Label>
            <Input
              id="public-fact-area"
              name="area"
              defaultValue={current.area ?? ""}
              aria-describedby="public-fact-area-hint"
              className="min-w-0 max-w-[320px]"
              data-testid="public-fact-area"
            />
            <p id="public-fact-area-hint" className="type-meta text-muted-foreground">
              {t("publicFacts.areaHint", { max: AREA_MAX })}
            </p>
          </Fact>

          <Fact field="languages" shown={shown("languages")} t={t}>
            <Label id={labelId("languages")} htmlFor="public-fact-languages">{t(FACT_LABEL.languages)}</Label>
            <Input
              id="public-fact-languages"
              name="languages"
              defaultValue={current.languages ?? ""}
              aria-describedby="public-fact-languages-hint"
              className="min-w-0 max-w-[480px]"
              data-testid="public-fact-languages"
            />
            <p id="public-fact-languages-hint" className="type-meta text-muted-foreground">
              {t("publicFacts.languagesHint", { max: LANGUAGES_MAX })}
            </p>
          </Fact>

          <div>
            <Button type="submit" size="sm" variant="outline" data-testid="save-public-facts">
              {t("publicFacts.save")}
            </Button>
          </div>
        </MutationFeedbackForm>
      </CardContent>
    </Card>
  );
}
