import { Badge } from "@/components/ui/badge";
import { Toggle } from "./filter-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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

export type FilterState = {
  fit: number;
  cluster?: string;
  q?: string;
  source?: string;
  unblocked?: boolean;
  fresh?: boolean;
  paid?: boolean;
  named?: boolean;
  described?: boolean;
  sort?: string;
  status?: string;
};

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

export function href(base: string, state: FilterState, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  const merged: Record<string, unknown> = { ...state, ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || v === false) continue;
    if (k === "fit" && Number(v) === 0) continue;
    params.set(k, v === true ? "1" : String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

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

export function FilterBar({
  base,
  state,
  facets,
  t,
}: {
  base: string;
  state: FilterState;
  facets: Facets;
  /** Tradutor da requisição. Recebido por prop porque este é Server Component
      e o chamador já o resolveu — buscar de novo aqui repetiria o trabalho. */
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const CUTS = [0, 45, 55, 60, 70];

  return (
    <Card className="mb-5 gap-3 p-4">
      <form method="get" action={base} className="flex gap-2">
        {Object.entries(state).map(([k, v]) =>
          k === "q" || v === undefined || v === false ? null : (
            <input key={k} type="hidden" name={k} value={v === true ? "1" : String(v)} />
          ),
        )}
        <Input name="q" defaultValue={state.q ?? ""} placeholder={t("filters.search")} />
        <Button type="submit">{t("filters.submit")}</Button>
        {state.q && (
          <a href={href(base, state, { q: undefined })} className={chipClass(false)}>
            {t("filters.clear")}
          </a>
        )}
      </form>

      <Separator />

      <Group label={t("filters.cut")}>
        {CUTS.map((c) => (
          <a
            key={c}
            href={href(base, state, { fit: String(c) })}
            className={cn(chipClass(state.fit === c), "font-mono")}
          >
            {c === 0 ? t("filters.all") : `${c}+`}
          </a>
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
          <a href={href(base, state, { cluster: undefined })} className={cn(chipClass(!state.cluster), "font-mono")}>
            {t("filters.all")}
          </a>
          {facets.clusters.map((c) => (
            <a
              key={c}
              href={href(base, state, { cluster: c })}
              className={cn(chipClass(state.cluster === c), "font-mono")}
            >
              {c}
            </a>
          ))}
        </Group>
      )}

      {facets.sources.length > 1 && (
        <Group label={t("filters.source")}>
          <a href={href(base, state, { source: undefined })} className={cn(chipClass(!state.source), "font-mono")}>
            {t("filters.all")}
          </a>
          {facets.sources.map((s) => (
            <a
              key={s}
              href={href(base, state, { source: s })}
              className={cn(chipClass(state.source === s), "font-mono")}
            >
              {s}
            </a>
          ))}
        </Group>
      )}

      <Group label={t("filters.sort")}>
        <a href={href(base, state, { sort: undefined })} className={chipClass(!state.sort || state.sort === "fit")}>
          {t("filters.byFit")}
        </a>
        <a href={href(base, state, { sort: "recent" })} className={chipClass(state.sort === "recent")}>
          {t("filters.byRecent")}
        </a>
        <a href={href(base, state, { sort: "comp" })} className={chipClass(state.sort === "comp")}>
          {t("filters.byComp")}
        </a>
      </Group>
    </Card>
  );
}

export function readFilters(params: Record<string, string | string[] | undefined>): FilterState {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    fit: Number(one("fit") ?? 45),
    cluster: one("cluster"),
    q: one("q"),
    source: one("source"),
    status: one("status"),
    sort: one("sort"),
    unblocked: one("unblocked") === "1",
    fresh: one("fresh") === "1",
    paid: one("paid") === "1",
    named: one("named") === "1",
    described: one("described") === "1",
  };
}

export function toBoardFilters(state: FilterState) {
  return {
    minFit: state.fit,
    cluster: state.cluster,
    q: state.q,
    sourceKind: state.source,
    status: state.status as never,
    hideBlocked: state.unblocked,
    freshDays: state.fresh ? 3 : undefined,
    hasComp: state.paid,
    namedEmployer: state.named,
    hasDescription: state.described,
    sort: (state.sort ?? "fit") as "fit" | "recent" | "comp",
  };
}

export { Badge };
