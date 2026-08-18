/**
 * Grid affordances: pagination, page size, density, bulk actions and export.
 *
 * All of it lives in the URL and in plain forms, so every page stays a Server
 * Component with no client bundle. Bulk selection uses ordinary checkboxes
 * inside a form — the browser already knows how to do this, and reaching for
 * client state here would buy nothing.
 */
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

  const box = (active: boolean) => ({
    padding: "4px 10px",
    borderRadius: 4,
    fontSize: 13,
    textDecoration: "none",
    background: active ? "var(--accent)" : "var(--surface)",
    color: active ? "#fff" : "var(--text-2)",
    border: "1px solid var(--line)",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginTop: 18,
      }}
    >
      <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
        {from.toLocaleString("pt-BR")}–{to.toLocaleString("pt-BR")} de{" "}
        {total.toLocaleString("pt-BR")}
      </span>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {current > 1 && (
          <a href={link(current - 1)} style={box(false)}>
            ← anterior
          </a>
        )}
        {window.map((p, i) => (
          <span key={p} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {i > 0 && window[i - 1] !== undefined && p - window[i - 1]! > 1 && (
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>…</span>
            )}
            <a href={link(p)} className="mono" style={box(p === current)}>
              {p}
            </a>
          </span>
        ))}
        {current < pages && (
          <a href={link(current + 1)} style={box(false)}>
            próxima →
          </a>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          className="mono"
          style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}
        >
          por página
        </span>
        {PAGE_SIZES.map((n) => (
          <a
            key={n}
            href={href(base, state, { size: n === 50 ? undefined : String(n), page: undefined })}
            className="mono"
            style={box(pageSize === n)}
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
  const box = (active: boolean) => ({
    padding: "4px 10px",
    borderRadius: 4,
    fontSize: 12,
    textDecoration: "none",
    background: active ? "var(--accent)" : "var(--sunk)",
    color: active ? "#fff" : "var(--text-2)",
    border: "1px solid var(--line)",
  });

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <span
        className="mono"
        style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}
      >
        densidade
      </span>
      <a href={href(base, state, { dense: undefined })} style={box(!dense)}>
        confortável
      </a>
      <a href={href(base, state, { dense: "1" })} style={box(dense)}>
        compacta
      </a>

      <span style={{ flex: 1 }} />

      <a href={exportHref} style={box(false)} title={`Exporta as ${total} linhas filtradas`}>
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
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      {PRESETS.map((p) => (
        <a
          key={p.label}
          href={`${base}?${p.query}`}
          title={p.hint}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--text)",
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          {p.label}
          <span style={{ color: "var(--text-3)", fontSize: 11.5 }}> · {p.hint}</span>
        </a>
      ))}
    </div>
  );
}
