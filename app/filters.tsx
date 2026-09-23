import { Badge } from "@/components/ui/badge";
import { Toggle } from "./filter-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { Translator } from "../src/core/i18n/index.ts";
import { WORK_MODES, type SavedTermSummary, type Track } from "../src/contexts/matching/index.ts";
import { href, toParams, type BoardRoute, type FilterState } from "./filter-state";
import { PayRange } from "./pay-range";
import { RangeSlider } from "./range-slider";
import { FIT_MAX, FIT_SLIDER_STEP } from "./filter-scales.ts";
import { TransitionGetForm } from "./transition-get-form";
import { AutoApplyInput } from "./auto-submit";
import { TransitionLink } from "./transition-link";

export { href, readFilters, toBoardFilters, toParams, type BoardRoute, type FilterState } from "./filter-state";

/**
 * Filter bar, shared by the cockpit and the job list.
 *
 * State lives in the URL, not in React: a filtered view is shareable and
 * bookmarkable, the back button behaves, and every page stays a Server
 * Component. The client islands inside it (fields, ranges) only edit inputs
 * and submit the GET form around them.
 *
 * Filters apply themselves when a gesture ends (#218): text after a pause of
 * typing, a range when the thumb is released or the focus leaves it, a select
 * when chosen. Enter and Apply still submit at once, which is also the path
 * without JavaScript. The source list keeps its explicit Apply: every submit
 * rebuilds the picker from the URL and would close it mid-selection.
 *
 * Each toggle shows what it yields, because a filter that silently returns
 * nothing is indistinguishable from a broken page.
 *
 * The rows share one grid, label column and controls column, so every chip in
 * the bar starts at the same x. Nine rows of inline labels gave each filter the
 * same weight and the same ragged left edge, which is what made a bar with
 * everything in it read as a bar with nothing in it.
 */

export type Facets = {
  total: number;
  unblocked: number;
  fresh: number;
  withComp: number;
  named: number;
  described: number;
  notApplied: number;
  clusters: string[];
  sources: string[];
};

const chipClass = (active: boolean) =>
  cn(
    buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
    "h-7 px-2.5 type-micro font-normal",
    active && "font-medium",
  );

/** Chip cujo texto vem do usuário — nome de trilha, termo salvo — e pode não caber numa linha. */
const userChipClass = (active: boolean) =>
  cn(chipClass(active), "h-auto min-h-7 max-w-full shrink py-1 text-left whitespace-normal wrap-anywhere");

/**
 * One filter: its name in the label column, its controls in the wide one.
 *
 * `hint` is for the three rows that read as the same question and are not:
 * the track decides which target scores the list, the saved term says which
 * search brought the job in, and the cluster is the kind of role. All three
 * offer chips with the same words — PHP, Laravel — so the name alone cannot
 * tell them apart, and the sentence does.
 */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="self-start pt-1.5 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={label}>
        {children}
        {hint && <p className="w-full type-caption-sm text-muted-foreground">{hint}</p>}
      </div>
    </>
  );
}

/** Hidden inputs that carry the rest of the state through a GET form. */
function Carry({ state, except }: { state: FilterState; except: string[] }) {
  return (
    <>
      {toParams(state)
        .filter(([key]) => !except.includes(key))
        .map(([key, value]) => (
          <input key={`${key}=${value}`} type="hidden" name={key} value={value} />
        ))}
    </>
  );
}

/**
 * Sources as a closed multi-select, not a row of chips.
 *
 * Every adapter adds a chip, and the row already wrapped over three lines
 * before the next board landed; the list only grows. A native `<details>` is
 * the whole disclosure: no portal, so the checkboxes stay inside the GET form
 * and one Apply carries the lot — choosing three sources with chips meant three
 * round trips.
 *
 * The open list sits IN FLOW and pushes the rows below it. A floating panel is
 * the usual shape, and it was cut off at every width: `Card` clips its content,
 * and letting this one card not clip only moves the problem to the next
 * ancestor with a scroll area. In flow, nothing can clip it, at any width.
 *
 * Apply lives inside the panel, next to the choosing. Below a 288px list it
 * would be off screen exactly when it is needed.
 */
function SourcePicker({
  base,
  state,
  sources,
  t,
}: {
  base: BoardRoute;
  state: FilterState;
  sources: string[];
  t: Translator["t"];
}) {
  const chosen = new Set(state.sources);
  const summary =
    chosen.size === 0
      ? t("filters.sourceAll")
      : t("filters.sourceCount", { count: chosen.size, total: sources.length });

  return (
    <TransitionGetForm
      action={base}
      className="flex flex-wrap items-start gap-2"
      data-testid="filters-source-form"
    >
      <Carry state={state} except={["source", "page"]} />
      <details className="group w-56" data-testid="filters-source-combo">
        <summary
          className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-input px-2.5 type-body-md text-foreground select-none [&::-webkit-details-marker]:hidden"
          data-testid="filters-source-summary"
        >
          {summary}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-1 rounded-lg bg-card ring-1 ring-foreground/10">
          <div className="max-h-64 overflow-y-auto p-1">
            {sources.map((kind) => (
              <label
                key={kind}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 font-mono type-body-md hover:bg-muted"
              >
                <input
                  type="checkbox"
                  name="source"
                  value={kind}
                  defaultChecked={chosen.has(kind)}
                  className="size-4 accent-primary"
                  data-testid={`filter-source-${kind}`}
                />
                {kind}
              </label>
            ))}
          </div>
          <div className="border-t border-hairline p-2">
            <Button type="submit" variant="outline" size="sm" data-testid="filters-source-submit">
              {t("filters.apply")}
            </Button>
          </div>
        </div>
      </details>
      {chosen.size > 0 && (
        <TransitionLink
          href={href(base, state, { source: undefined })}
          className={chipClass(false)}
          data-testid="filters-source-clear"
        >
          {t("filters.clear")}
        </TransitionLink>
      )}
    </TransitionGetForm>
  );
}

/** What the Jobs screen adds to the shared bar: tracks, saved terms and pay. */
export type BoardExtras = {
  tracks: Track[];
  savedTerms: SavedTermSummary[];
  currencies: string[];
  pay: { currency: string; period: "month" | "year" };
};

export function FilterBar({
  base,
  state,
  facets,
  extras,
  t,
}: {
  base: BoardRoute;
  state: FilterState;
  facets: Facets;
  extras?: BoardExtras;
  /** Tradutor da requisição. Recebido por prop porque este é Server Component
      e o chamador já o resolveu — buscar de novo aqui repetiria o trabalho. */
  t: Translator["t"];
}) {
  const accepted = extras?.tracks.filter((track) => !track.isPrimary) ?? [];
  const grid = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]";

  return (
    <Card className="mb-5 gap-4 p-4">
      <TransitionGetForm action={base} className="flex flex-wrap gap-2" data-testid="filters-get-form">
        <Carry state={state} except={["q", "page"]} />
        <AutoApplyInput
          name="q"
          applied={state.term?.term ?? ""}
          placeholder={t("filters.search")}
          aria-describedby="filters-query-hint"
          className="min-w-0 flex-1"
          data-testid="filters-query"
        />
        <Button type="submit" data-testid="filters-submit">{t("filters.submit")}</Button>
        {state.term && (
          <TransitionLink href={href(base, state, { q: undefined })} className={chipClass(false)} data-testid="filters-query-clear">
            {t("filters.clear")}
          </TransitionLink>
        )}
        <p id="filters-query-hint" className="w-full type-caption-sm text-muted-foreground" data-testid="filters-query-hint">
          {t("filters.searchHint")}
        </p>
      </TransitionGetForm>

      <Separator />

      <div className={grid}>
        <Row label={t("filters.company")}>
          <TransitionGetForm
            action={base}
            className="flex w-full flex-wrap items-center gap-2"
            data-testid="filters-company-form"
          >
            <Carry state={state} except={["company", "page"]} />
            <AutoApplyInput
              name="company"
              applied={state.company ?? ""}
              placeholder={t("filters.companyPlaceholder")}
              className="w-56"
              data-testid="filters-company"
            />
            <Button type="submit" variant="outline" size="sm" data-testid="filters-company-submit">
              {t("filters.apply")}
            </Button>
            {state.company && (
              <TransitionLink
                href={href(base, state, { company: undefined })}
                className={chipClass(false)}
                data-testid="filters-company-clear"
              >
                {t("filters.clear")}
              </TransitionLink>
            )}
          </TransitionGetForm>
        </Row>

        {extras && extras.tracks.length > 0 && (
          <Row label={t("filters.track")} hint={t("hints.track")}>
            <TransitionLink
              href={href(base, state, { track: undefined, cluster: undefined })}
              className={chipClass(state.track === undefined)}
              aria-current={state.track === undefined ? "true" : undefined}
              data-testid="filter-track-primary"
            >
              {t("filters.trackPrimary")}
            </TransitionLink>
            {accepted.map((track) => (
              <TransitionLink
                key={track.id}
                href={href(base, state, { track: String(track.id), cluster: undefined })}
                className={userChipClass(state.track === track.id)}
                aria-current={state.track === track.id ? "true" : undefined}
                data-testid={`filter-track-${track.id}`}
                data-user-content
              >
                {track.name}
              </TransitionLink>
            ))}
            {accepted.length > 0 && (
              <TransitionLink
                href={href(base, state, { track: "all", cluster: undefined })}
                className={chipClass(state.track === "all")}
                aria-current={state.track === "all" ? "true" : undefined}
                data-testid="filter-track-all"
              >
                {t("filters.trackAll")}
              </TransitionLink>
            )}
          </Row>
        )}

        {extras && extras.savedTerms.length > 0 && (
          <Row label={t("filters.broughtBy")} hint={t("hints.broughtBy")}>
            <TransitionLink
              href={href(base, state, { by: undefined })}
              className={chipClass(state.by === undefined)}
              aria-current={state.by === undefined ? "true" : undefined}
              data-testid="filter-by-any"
            >
              {t("filters.broughtByAny")}
            </TransitionLink>
            {extras.savedTerms.map((term) => (
              <TransitionLink
                key={term.id}
                href={href(base, state, { by: String(term.id) })}
                className={userChipClass(state.by === term.id)}
                aria-current={state.by === term.id ? "true" : undefined}
                data-testid={`filter-by-${term.id}`}
                data-user-content
              >
                {term.term}
              </TransitionLink>
            ))}
          </Row>
        )}

        {extras && (
          <Row label={t("filters.pay")}>
            <TransitionGetForm
              action={base}
              className="flex w-full flex-wrap items-end gap-x-3 gap-y-2"
              data-testid="filters-pay-form"
            >
              <Carry state={state} except={["pay", "payMax", "cur", "per", "page"]} />
              <PayRange
                // Sem chave. Toda navegação da barra é suave: ir de `/jobs?a`
                // para `/jobs?b` reconcilia a mesma posição da árvore e a ilha
                // não remonta, e `useState` só lê o inicializador. Faixa
                // invertida trocada no servidor, o "limpar" e os presets de
                // corte deixavam o campo com o valor velho, e o Aplicar
                // seguinte o reenviava. A chave pelo estado resolvia, mas
                // remontava a faixa no meio da digitação quando o filtro passou
                // a se aplicar sozinho (#218). Agora valores, período e moeda
                // seguem a URL por dentro (`useAppliedValue`, `useFollowed`).
                min={state.pay?.min}
                max={state.pay?.max}
                period={extras.pay.period}
                currency={extras.pay.currency}
                currencies={extras.currencies}
                labels={{
                  min: t("filters.payAmount"),
                  max: t("filters.payMax"),
                  currency: t("filters.payCurrency"),
                  period: t("filters.payPeriod"),
                  perMonth: t("filters.perMonth"),
                  perYear: t("filters.perYear"),
                  minThumb: t("filters.payMinThumb"),
                  maxThumb: t("filters.payMaxThumb"),
                  minPlaceholder: t("filters.payNoFloor"),
                  maxPlaceholder: t("filters.payNoCap"),
                }}
              >
                <Button type="submit" variant="outline" size="sm" data-testid="filters-pay-submit">
                  {t("filters.apply")}
                </Button>
              </PayRange>
              <div className="flex flex-wrap items-center gap-1.5">
                <Toggle
                  href={href(base, state, { disclosed: state.pay?.disclosedOnly ? undefined : "1" })}
                  active={Boolean(state.pay?.disclosedOnly)}
                  hint={t("filters.disclosedOnly")}
                >
                  {t("filters.disclosedOnly")}
                </Toggle>
                {state.pay && (
                  <TransitionLink
                    href={href(base, state, {
                      pay: undefined,
                      payMax: undefined,
                      cur: undefined,
                      per: undefined,
                      disclosed: undefined,
                    })}
                    className={chipClass(false)}
                    data-testid="filters-pay-clear"
                  >
                    {t("filters.clear")}
                  </TransitionLink>
                )}
              </div>
            </TransitionGetForm>
          </Row>
        )}

        <Row label={t("filters.workMode")}>
          <TransitionLink
            href={href(base, state, { workMode: undefined })}
            className={chipClass(!state.workMode)}
            aria-current={!state.workMode ? "true" : undefined}
            data-testid="filter-work-mode-all"
          >
            {t("filters.all")}
          </TransitionLink>
          {WORK_MODES.map((mode) => (
            <TransitionLink
              key={mode}
              href={href(base, state, { workMode: mode })}
              className={chipClass(state.workMode === mode)}
              aria-current={state.workMode === mode ? "true" : undefined}
              data-testid={`filter-work-mode-${mode}`}
            >
              {t(`filters.${mode}`)}
            </TransitionLink>
          ))}
        </Row>

        <Row label={t("filters.score")}>
          <TransitionGetForm
            action={base}
            className="flex w-full flex-wrap items-end gap-x-3 gap-y-2"
            data-testid="filters-score-form"
          >
            <Carry state={state} except={["fit", "fitMax", "page"]} />
            <RangeSlider
              // Sem chave: ver o `PayRange` acima. Aqui o caminho mais visível
              // são os presets de corte — depois de "Aplicável hoje" o campo
              // precisa mostrar 60, e `useAppliedValue` o leva até lá.
              minName="fit"
              maxName="fitMax"
              // Zero is "every score": the empty field says that, and a typed
              // zero would say the same thing while looking like a filter.
              min={state.fit === 0 ? undefined : state.fit}
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
              testId="filters-score"
            >
              <Button type="submit" variant="outline" size="sm" data-testid="filters-score-submit">
                {t("filters.apply")}
              </Button>
            </RangeSlider>
          </TransitionGetForm>
        </Row>

        <Row label={t("filters.quality")}>
          <Toggle
            href={href(base, state, { unblocked: state.unblocked ? undefined : "1" })}
            active={Boolean(state.unblocked)}
            hint={t("hints.unblocked")}
          >
            {t("filters.unblocked")} · {facets.unblocked}
          </Toggle>
          <Toggle
            href={href(base, state, { named: state.named ? undefined : "1" })}
            active={Boolean(state.named)}
            hint={t("hints.named")}
          >
            {t("filters.named")} · {facets.named}
          </Toggle>
          <Toggle
            href={href(base, state, { fresh: state.fresh ? undefined : "1" })}
            active={Boolean(state.fresh)}
            hint={t("hints.fresh")}
          >
            {t("filters.fresh")} · {facets.fresh}
          </Toggle>
          <Toggle
            href={href(base, state, { described: state.described ? undefined : "1" })}
            active={Boolean(state.described)}
            hint={t("hints.described")}
          >
            {t("filters.described")} · {facets.described}
          </Toggle>
          <Toggle
            href={href(base, state, { paid: state.paid ? undefined : "1" })}
            active={Boolean(state.paid)}
            hint={t("hints.paid")}
          >
            {t("filters.paid")} · {facets.withComp}
          </Toggle>
        </Row>

        <Row label={t("filters.pipeline")}>
          {/*
            "ainda não enviadas" depende de escopo de candidato, como trilha,
            "trazida por" e pagamento — e era a única das quatro fora do portão.
            Sem escopo (recrutador, ou admin puro) ela era um chip que não
            filtrava nada e anunciava o acervo inteiro: `repo.ts` ignora
            `hideApplied` sem candidato, de propósito, e o contador somava
            `appliedAt is null` sobre um join que nunca casa, então TODA linha
            entrava. Clicar escrevia `notApplied=1` em todo link seguinte e a
            lista nunca mudava.

            "agrupar repetidas" fica, porque agrupar não depende de candidato.
          */}
          {extras && (
            <Toggle
              href={href(base, state, { notApplied: state.notApplied ? undefined : "1" })}
              active={Boolean(state.notApplied)}
              hint={t("hints.notApplied")}
            >
              {t("filters.notApplied")} · {facets.notApplied}
            </Toggle>
          )}
          <Toggle
            href={href(base, state, { ungrouped: state.grouped ? "1" : undefined })}
            active={state.grouped}
            hint={t("hints.grouped")}
          >
            {t("filters.grouped")}
          </Toggle>
        </Row>

        {facets.clusters.length > 0 && (
          <Row label={t("filters.cluster")} hint={t("hints.cluster")}>
            <TransitionLink href={href(base, state, { cluster: undefined })} className={cn(chipClass(!state.cluster), "font-mono")}>
              {t("filters.all")}
            </TransitionLink>
            {facets.clusters.map((c) => (
              <TransitionLink
                key={c}
                href={href(base, state, { cluster: c })}
                className={cn(chipClass(state.cluster === c), "font-mono")}
              >
                {c}
              </TransitionLink>
            ))}
          </Row>
        )}

        {facets.sources.length > 1 && (
          <Row label={t("filters.source")}>
            {/*
              Chave pelo estado do servidor: `defaultChecked` é DOM não
              controlado, e sofre o mesmo que os campos da faixa. Depois de
              "limpar fontes" por navegação suave, as marcas continuavam onde
              estavam e o Aplicar seguinte ressuscitava a seleção.
            */}
            <SourcePicker
              key={[...state.sources].sort().join(",")}
              base={base}
              state={state}
              sources={facets.sources}
              t={t}
            />
          </Row>
        )}
      </div>

      <Separator />

      <div className={grid}>
        <Row label={t("filters.sort")}>
          <TransitionLink href={href(base, state, { sort: undefined })} className={chipClass(!state.sort || state.sort === "fit")}>
            {t("filters.byFit")}
          </TransitionLink>
          <TransitionLink href={href(base, state, { sort: "recent" })} className={chipClass(state.sort === "recent")}>
            {t("filters.byRecent")}
          </TransitionLink>
          <TransitionLink href={href(base, state, { sort: "comp" })} className={chipClass(state.sort === "comp")}>
            {t("filters.byComp")}
          </TransitionLink>
        </Row>
      </div>
    </Card>
  );
}

export { Badge };
