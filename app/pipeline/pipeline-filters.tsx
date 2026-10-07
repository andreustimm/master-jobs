import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Translator } from "../../src/core/i18n/index.ts";
import { AutoApplyInput } from "../auto-submit";
import { CheckboxPicker } from "../checkbox-picker";
import { FIT_MAX, FIT_SLIDER_STEP } from "../filter-scales.ts";
import { Toggle } from "../filter-toggle";
import { chipClass, Row } from "../filters";
import { RangeSlider } from "../range-slider";
import { TransitionGetForm } from "../transition-get-form";
import { TransitionLink } from "../transition-link";
import { pipelineHref, toPipelineParams, type PipelineState } from "./filter-state";

/** O resto do estado, como campos ocultos de um formulário GET. */
function Carry({ state, except }: { state: PipelineState; except: string[] }) {
  return (
    <>
      {toPipelineParams(state)
        .filter(([key]) => !except.includes(key))
        .map(([key, value]) => (
          <input key={`${key}=${value}`} type="hidden" name={key} value={value} />
        ))}
    </>
  );
}

/**
 * A barra de filtros do Funil (#478): as mesmas peças da de Vagas, com o
 * estado em `app/pipeline/filter-state.ts`. Empresas e canais vêm das
 * candidaturas da pessoa (`pipelineFacets`).
 */
export function PipelineFilterBar({
  state,
  facets,
  t,
}: {
  state: PipelineState;
  facets: { companies: string[]; channels: string[] };
  t: Translator["t"];
}) {
  const chosenCompanies = new Set(state.companies);
  const chosenChannels = new Set(state.channels);
  const grid = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]";

  return (
    <Card className="mb-6 gap-4 p-4" data-testid="pipeline-filters">
      <TransitionGetForm action="/pipeline" className="flex flex-wrap gap-2" data-testid="pipeline-query-form">
        <Carry state={state} except={["q"]} />
        <AutoApplyInput
          name="q"
          applied={state.query?.raw ?? ""}
          placeholder={t("filters.search")}
          aria-describedby="pipeline-query-hint"
          className="min-w-0 flex-1"
          data-testid="pipeline-query"
        />
        <Button type="submit" data-testid="pipeline-query-submit">{t("filters.submit")}</Button>
        {state.query && (
          <TransitionLink
            href={pipelineHref(state, { q: undefined })}
            className={chipClass(false)}
            data-testid="pipeline-query-clear"
          >
            {t("filters.clear")}
          </TransitionLink>
        )}
        <p id="pipeline-query-hint" className="w-full type-caption-sm text-muted-foreground">
          {t("filters.searchHint")}
        </p>
        <Toggle
          href={pipelineHref(state, { semantic: state.semantic ? undefined : "1" })}
          active={state.semantic}
          hint={t("pipeline.broadenHint")}
          testId="pipeline-broaden"
        >
          {t("pipeline.broaden")}
        </Toggle>
      </TransitionGetForm>

      <Separator />

      <div className={grid}>
        {facets.companies.length > 0 && (
          <Row label={t("filters.company")}>
            <CheckboxPicker
              action="/pipeline"
              carry={toPipelineParams(state).filter(([key]) => key !== "company")}
              name="company"
              options={facets.companies}
              chosen={chosenCompanies}
              summary={
                chosenCompanies.size === 0
                  ? t("pipeline.companyAll")
                  : t("filters.sourceCount", { count: chosenCompanies.size, total: facets.companies.length })
              }
              clearHref={pipelineHref(state, { company: undefined })}
              applyLabel={t("filters.apply")}
              clearLabel={t("filters.clear")}
              testId="pipeline-company"
              optionTestId={(company) => `pipeline-company-option-${company}`}
              userContent
            />
          </Row>
        )}

        {facets.channels.length > 0 && (
          <Row label={t("pipeline.channel")}>
            <CheckboxPicker
              action="/pipeline"
              carry={toPipelineParams(state).filter(([key]) => key !== "channel")}
              name="channel"
              options={facets.channels}
              chosen={chosenChannels}
              summary={
                chosenChannels.size === 0
                  ? t("pipeline.channelAll")
                  : t("filters.sourceCount", { count: chosenChannels.size, total: facets.channels.length })
              }
              clearHref={pipelineHref(state, { channel: undefined })}
              applyLabel={t("filters.apply")}
              clearLabel={t("filters.clear")}
              testId="pipeline-channel"
              optionTestId={(channel) => `pipeline-channel-option-${channel}`}
              userContent
            />
          </Row>
        )}

        <Row label={t("filters.score")}>
          <TransitionGetForm
            action="/pipeline"
            className="flex w-full flex-wrap items-end gap-x-3 gap-y-2"
            data-testid="pipeline-score-form"
          >
            <Carry state={state} except={["fit", "fitMax"]} />
            <RangeSlider
              minName="fit"
              maxName="fitMax"
              min={state.fit}
              max={state.fitMax}
              limit={FIT_MAX}
              ceiling={FIT_MAX}
              step={FIT_SLIDER_STEP}
              labels={{
                min: t("filters.scoreMin"),
                max: t("filters.scoreMax"),
                minThumb: t("filters.scoreMinThumb"),
                maxThumb: t("filters.scoreMaxThumb"),
                minPlaceholder: t("filters.scoreNoFloor"),
                maxPlaceholder: t("filters.scoreNoCap"),
              }}
              testId="pipeline-score"
            >
              <Button type="submit" variant="outline" size="sm" data-testid="pipeline-score-submit">
                {t("filters.apply")}
              </Button>
            </RangeSlider>
          </TransitionGetForm>
        </Row>
      </div>
    </Card>
  );
}
