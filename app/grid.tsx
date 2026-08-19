/**
 * Grid affordances: pagination, page size, density, bulk actions and export.
 *
 * All of it lives in the URL and in plain forms, so every page stays a Server
 * Component with no client bundle. Bulk selection uses ordinary checkboxes
 * inside a form — the browser already knows how to do this, and reaching for
 * client state here would buy nothing.
 */
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { href, type FilterState } from "./filters";

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export function Pagination({
  base,
  state,
  page,
  pageSize,
  total,
  t,
}: {
  base: string;
  state: FilterState;
  page: number;
  pageSize: number;
  total: number;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  // A window around the current page, always including first and last.
  const window: number[] = [];
  for (let p = Math.max(1, current - 2); p <= Math.min(pages, current + 2); p++) window.push(p);
  if (!window.includes(1)) window.unshift(1);
  if (!window.includes(pages)) window.push(pages);

  const link = (p: number) => href(base, state, { page: p === 1 ? undefined : String(p) });

  const box = (active: boolean) =>
    cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "h-8 px-3 text-xs");

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
      <span className="font-mono text-xs text-muted-foreground">
        {from.toLocaleString("pt-BR")}–{to.toLocaleString("pt-BR")} de{" "}
        {total.toLocaleString("pt-BR")}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {current > 1 && (
          <a href={link(current - 1)} className={box(false)}>
            ← anterior
          </a>
        )}
        {window.map((p, i) => (
          <span key={p} className="flex items-center gap-1.5">
            {i > 0 && window[i - 1] !== undefined && p - window[i - 1]! > 1 && (
              <span className="text-xs text-muted-foreground">…</span>
            )}
            <a href={link(p)} className={cn("font-mono", box(p === current))}>
              {p}
            </a>
          </span>
        ))}
        {current < pages && (
          <a href={link(current + 1)} className={box(false)}>
            próxima →
          </a>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
          por página
        </span>
        {PAGE_SIZES.map((n) => (
          <a
            key={n}
            href={href(base, state, { size: n === 50 ? undefined : String(n), page: undefined })}
            className={cn("font-mono", box(pageSize === n))}
          >
            {n}
          </a>
        ))}
      </div>
    </div>
  );
}

export function GridToolbar({
  base,
  state,
  total,
  dense,
  t,
}: {
  base: string;
  state: FilterState;
  total: number;
  dense: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const exportHref = `/api/export${new URL(href(base, state, {}), "http://x").search}`;
  const box = (active: boolean) =>
    cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "h-7 px-2.5 text-xs");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5">
      <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        {t("grid.density")}
      </span>
      <a href={href(base, state, { dense: undefined })} className={box(!dense)}>
        {t("grid.comfortable")}
      </a>
      <a href={href(base, state, { dense: "1" })} className={box(dense)}>
        {t("grid.compact")}
      </a>

      <span className="flex-1" />

      <a href={exportHref} className={box(false)} title={t("grid.exportHint", { count: total })}>
        ↓ {t("grid.exportCsv")}
      </a>
    </div>
  );
}

/** The saved views that actually get used, as one-click presets. */
export const PRESETS = [
  {
    key: "applicableToday",
    query: "fit=60&unblocked=1&named=1",
  },
  { key: "recent", query: "fit=45&fresh=1&unblocked=1" },
  { key: "withSalary", query: "fit=45&paid=1&sort=comp" },
  { key: "untriaged", query: "fit=55&status=unfiled" },
] as const;

export function Presets({
  base,
  t,
}: {
  base: string;
  /** Tradutor da requisição, por prop: estes são Server Components e o
      chamador já o resolveu. */
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {PRESETS.map((p) => (
        <a
          key={p.key}
          href={`${base}?${p.query}`}
          title={t(`presets.${p.key}Hint`)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto py-1.5 type-caption-sm font-normal")}
        >
          {t(`presets.${p.key}`)}
          {/* A explicação junta com o rótulo dá 459px numa linha que o
              buttonVariants marca como `whitespace-nowrap` — estourava a tela
              de 375px. Ela já está no `title`, então no celular fica só lá. */}
          <span className="ml-1 hidden type-meta text-muted-foreground sm:inline">
            {" "}
            · {t(`presets.${p.key}Hint`)}
          </span>
        </a>
      ))}
    </div>
  );
}
