import { Badge } from "@/components/ui/badge";
import { Toggle } from "./filter-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Translator } from "../src/core/i18n/index.ts";
import { WORK_MODES, type SavedTermSummary, type Track } from "../src/contexts/matching/index.ts";
import { href, toParams, type BoardRoute, type FilterState } from "./filter-state";
import { TransitionGetForm } from "./transition-get-form";
import { TransitionLink } from "./transition-link";

export { href, readFilters, toBoardFilters, toParams, type BoardRoute, type FilterState } from "./filter-state";

/**
 * Filter bar, shared by the cockpit and the job list.
 *
 * State lives in the URL, not in React: a filtered view is shareable and
 * bookmarkable, the back button behaves, and every page stays a Server
 * Component with no client bundle.
 *
 * Each toggle shows what it yields, because a filter that silently returns
 * nothing is indistinguishable from a broken page.
 */

export type Facets = {
  total: number;
  unblocked: number;
  fresh: number;
  withComp: number;
  named: number;
  described: number;
  clusters: string[];
  sources: string[];
};

/** Native select dressed as the design system's input: no client JS needed. */
const SELECT = "h-9 rounded-md border border-input bg-background px-2 type-body-md text-foreground";

const chipClass = (active: boolean) =>
  cn(
    buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
    "h-7 px-2.5 text-xs font-normal",
    active && "font-medium",
  );

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Hidden inputs that carry the rest of the state through a GET form. */
function Carry({ state, except }: { state: FilterState; except: string[] }) {
  return (
    <>
      {Object.entries(toParams(state))
        .filter(([key]) => !except.includes(key))
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
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
  const CUTS = [0, 45, 55, 60, 70];
  const accepted = extras?.tracks.filter((track) => !track.isPrimary) ?? [];

  return (
    <Card className="mb-5 gap-3 p-4">
      <TransitionGetForm action={base} className="flex flex-wrap gap-2" data-testid="filters-get-form">
        <Carry state={state} except={["q", "page"]} />
        <Input
          key={state.term?.term ?? ""}
          name="q"
          defaultValue={state.term?.term ?? ""}
          placeholder={t("filters.search")}
          aria-describedby="filters-query-hint"
          className="min-w-0 flex-1"
          data-testid="filters-query"
        />
        <Button type="submit" data-testid="filters-submit">{t("filters.submit")}</Button>
        {state.term && (
          <TransitionLink href={href(base, state, { q: undefined })} className={chipClass(false)}>
            {t("filters.clear")}
          </TransitionLink>
        )}
        <p id="filters-query-hint" className="w-full type-caption-sm text-muted-foreground" data-testid="filters-query-hint">
          {t("filters.searchHint")}
        </p>
      </TransitionGetForm>

      <Separator />

      {extras && extras.tracks.length > 0 && (
        <Group label={t("filters.track")}>
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
              className={chipClass(state.track === track.id)}
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
        </Group>
      )}

      {extras && extras.savedTerms.length > 0 && (
        <Group label={t("filters.broughtBy")}>
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
              className={chipClass(state.by === term.id)}
              aria-current={state.by === term.id ? "true" : undefined}
              data-testid={`filter-by-${term.id}`}
              data-user-content
            >
              {term.term}
            </TransitionLink>
          ))}
        </Group>
      )}

      {extras && (
        <TransitionGetForm action={base} className="flex flex-wrap items-end gap-2" data-testid="filters-pay-form">
          <Carry state={state} except={["pay", "cur", "per", "page"]} />
          <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
            {t("filters.payAmount")}
            <Input
              // Sem chave, o campo não controlado guardava o valor depois de
              // "limpar", e o próximo Aplicar devolvia o mínimo sem ninguém pedir.
              key={state.pay?.min ?? ""}
              type="number"
              name="pay"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={state.pay?.min ?? ""}
              className="w-32"
              data-testid="filters-pay"
            />
          </label>
          <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
            {t("filters.payCurrency")}
            <select name="cur" defaultValue={extras.pay.currency} className={SELECT} data-testid="filters-pay-currency">
              {extras.currencies.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
            {t("filters.payPeriod")}
            <select name="per" defaultValue={extras.pay.period} className={SELECT} data-testid="filters-pay-period">
              <option value="month">{t("filters.perMonth")}</option>
              <option value="year">{t("filters.perYear")}</option>
            </select>
          </label>
          <Button type="submit" variant="outline" data-testid="filters-pay-submit">{t("filters.payApply")}</Button>
          <Toggle
            href={href(base, state, { disclosed: state.pay?.disclosedOnly ? undefined : "1" })}
            active={Boolean(state.pay?.disclosedOnly)}
            hint={t("filters.disclosedOnly")}
          >
            {t("filters.disclosedOnly")}
          </Toggle>
          {state.pay && (
            <TransitionLink
              href={href(base, state, { pay: undefined, cur: undefined, per: undefined, disclosed: undefined })}
              className={chipClass(false)}
              data-testid="filters-pay-clear"
            >
              {t("filters.clear")}
            </TransitionLink>
          )}
        </TransitionGetForm>
      )}

      <Group label={t("filters.workMode")}>
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
      </Group>

      <Group label={t("filters.cut")}>
        {CUTS.map((c) => (
          <TransitionLink
            key={c}
            data-testid={`filter-cut-${c}`}
            href={href(base, state, { fit: String(c) })}
            className={cn(chipClass(state.fit === c), "font-mono")}
          >
            {c === 0 ? t("filters.all") : `${c}+`}
          </TransitionLink>
        ))}
      </Group>

      <Group label={t("filters.quality")}>
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
      </Group>

      {facets.clusters.length > 0 && (
        <Group label={t("filters.cluster")}>
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
        </Group>
      )}

      {facets.sources.length > 1 && (
        <Group label={t("filters.source")}>
          <TransitionLink href={href(base, state, { source: undefined })} className={cn(chipClass(!state.source), "font-mono")}>
            {t("filters.all")}
          </TransitionLink>
          {facets.sources.map((s) => (
            <TransitionLink
              key={s}
              href={href(base, state, { source: s })}
              className={cn(chipClass(state.source === s), "font-mono")}
            >
              {s}
            </TransitionLink>
          ))}
        </Group>
      )}

      <Group label={t("filters.sort")}>
        <TransitionLink href={href(base, state, { sort: undefined })} className={chipClass(!state.sort || state.sort === "fit")}>
          {t("filters.byFit")}
        </TransitionLink>
        <TransitionLink href={href(base, state, { sort: "recent" })} className={chipClass(state.sort === "recent")}>
          {t("filters.byRecent")}
        </TransitionLink>
        <TransitionLink href={href(base, state, { sort: "comp" })} className={chipClass(state.sort === "comp")}>
          {t("filters.byComp")}
        </TransitionLink>
      </Group>
    </Card>
  );
}

export { Badge };
