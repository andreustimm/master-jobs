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
}: {
  base: string;
  state: FilterState;
  page: number;
  pageSize: number;
  total: number;
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
}: {
  base: string;
  state: FilterState;
  total: number;
  dense: boolean;
}) {
  const exportHref = `/api/export${new URL(href(base, state, {}), "http://x").search}`;
  const box = (active: boolean) =>
    cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "h-7 px-2.5 text-xs");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5">
      <span className="font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        densidade
      </span>
      <a href={href(base, state, { dense: undefined })} className={box(!dense)}>
        confortável
      </a>
      <a href={href(base, state, { dense: "1" })} className={box(dense)}>
        compacta
      </a>

      <span className="flex-1" />

      <a href={exportHref} className={box(false)} title={`Exporta as ${total} linhas filtradas`}>
        ↓ exportar CSV
      </a>
    </div>
  );
}

/** The saved views that actually get used, as one-click presets. */
export const PRESETS = [
  {
    label: "Aplicáveis hoje",
    hint: "acima de 60, sem bloqueio, empresa identificada",
    query: "fit=60&unblocked=1&named=1",
  },
  { label: "Recém-publicadas", hint: "últimos 3 dias, sem bloqueio", query: "fit=45&fresh=1&unblocked=1" },
  { label: "Com salário", hint: "remuneração divulgada, maior primeiro", query: "fit=45&paid=1&sort=comp" },
  { label: "Não triadas", hint: "ainda fora do funil", query: "fit=55&status=unfiled" },
] as const;

export function Presets({ base }: { base: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {PRESETS.map((p) => (
        <a
          key={p.label}
          href={`${base}?${p.query}`}
          title={p.hint}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto py-1.5 type-caption-sm font-normal")}
        >
          {p.label}
          {/* A explicação junta com o rótulo dá 459px numa linha que o
              buttonVariants marca como `whitespace-nowrap` — estourava a tela
              de 375px. Ela já está no `title`, então no celular fica só lá. */}
          <span className="ml-1 hidden type-meta text-muted-foreground sm:inline">
            {" "}
            · {p.hint}
          </span>
        </a>
      ))}
    </div>
  );
}
