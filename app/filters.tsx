/**
 * Filter bar, shared by the cockpit and the job list.
 *
 * State lives in the URL, not in React. Three reasons that matter here: a
 * filtered view is shareable and bookmarkable, the back button behaves, and
 * every page stays a Server Component with no client bundle at all.
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

/** Build a URL preserving current state, with one key changed or removed. */
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

const chip = (active: boolean) => ({
  padding: "3px 9px",
  borderRadius: 4,
  textDecoration: "none",
  fontSize: 12,
  background: active ? "var(--accent)" : "var(--sunk)",
  color: active ? "#fff" : "var(--text-2)",
  border: "1px solid var(--line)",
  whiteSpace: "nowrap" as const,
});

const groupLabel = {
  fontSize: 10.5,
  letterSpacing: ".1em",
  textTransform: "uppercase" as const,
  color: "var(--text-3)",
};

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
      <span className="mono" style={groupLabel}>
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
}: {
  base: string;
  state: FilterState;
  facets: Facets;
}) {
  const CUTS = [0, 45, 55, 60, 70];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 16px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        marginBottom: 20,
      }}
    >
      <form method="get" action={base} style={{ display: "flex", gap: 8 }}>
        {/* Preserve the other filters when searching. */}
        {Object.entries(state).map(([k, v]) =>
          k === "q" || v === undefined || v === false ? null : (
            <input key={k} type="hidden" name={k} value={v === true ? "1" : String(v)} />
          ),
        )}
        <input
          name="q"
          defaultValue={state.q ?? ""}
          placeholder="buscar por cargo ou empresa…"
          style={{
            flex: 1,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "7px 11px",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "7px 16px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Buscar
        </button>
        {state.q && (
          <a href={href(base, state, { q: undefined })} style={{ ...chip(false), lineHeight: "26px" }}>
            limpar
          </a>
        )}
      </form>

      <Group label="corte">
        {CUTS.map((c) => (
          <a key={c} href={href(base, state, { fit: String(c) })} className="mono" style={chip(state.fit === c)}>
            {c === 0 ? "todas" : `${c}+`}
          </a>
        ))}
      </Group>

      <Group label="qualidade">
        <a
          href={href(base, state, { unblocked: state.unblocked ? undefined : "1" })}
          style={chip(Boolean(state.unblocked))}
          title="Esconde vagas com exigência de autorização de trabalho, presencial ou W2"
        >
          sem bloqueio · {facets.unblocked}
        </a>
        <a
          href={href(base, state, { named: state.named ? undefined : "1" })}
          style={chip(Boolean(state.named))}
          title="Esconde agregadores que ocultam o empregador — não dá para pesquisar nem acionar rede"
        >
          empresa identificada · {facets.named}
        </a>
        <a
          href={href(base, state, { fresh: state.fresh ? undefined : "1" })}
          style={chip(Boolean(state.fresh))}
          title="Publicadas nos últimos 3 dias — taxa de resposta muito maior"
        >
          recentes · {facets.fresh}
        </a>
        <a
          href={href(base, state, { described: state.described ? undefined : "1" })}
          style={chip(Boolean(state.described))}
          title="Vaga sem descrição zera o componente de keywords (30 pontos) — a nota fica não-medida, não baixa"
        >
          com descrição · {facets.described}
        </a>
        <a
          href={href(base, state, { paid: state.paid ? undefined : "1" })}
          style={chip(Boolean(state.paid))}
          title="Apenas vagas que divulgam remuneração"
        >
          com salário · {facets.withComp}
        </a>
      </Group>

      {facets.clusters.length > 0 && (
        <Group label="cluster">
          <a href={href(base, state, { cluster: undefined })} className="mono" style={chip(!state.cluster)}>
            todos
          </a>
          {facets.clusters.map((c) => (
            <a
              key={c}
              href={href(base, state, { cluster: c })}
              className="mono"
              style={chip(state.cluster === c)}
            >
              {c}
            </a>
          ))}
        </Group>
      )}

      {facets.sources.length > 1 && (
        <Group label="fonte">
          <a href={href(base, state, { source: undefined })} className="mono" style={chip(!state.source)}>
            todas
          </a>
          {facets.sources.map((s) => (
            <a key={s} href={href(base, state, { source: s })} className="mono" style={chip(state.source === s)}>
              {s}
            </a>
          ))}
        </Group>
      )}

      <Group label="ordenar">
        <a href={href(base, state, { sort: undefined })} style={chip(!state.sort || state.sort === "fit")}>
          aderência
        </a>
        <a href={href(base, state, { sort: "recent" })} style={chip(state.sort === "recent")}>
          mais recentes
        </a>
        <a href={href(base, state, { sort: "comp" })} style={chip(state.sort === "comp")}>
          maior salário
        </a>
      </Group>
    </div>
  );
}

/** Parse searchParams into typed state. */
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

/** Translate UI state into repo filters. */
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
