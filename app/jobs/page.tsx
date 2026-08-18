import { boardFacets, countBoard, listBoard } from "../../src/core/db/repo.ts";
import { FilterBar, readFilters, toBoardFilters } from "../filters";
import { GridToolbar, Pagination, Presets } from "../grid";
import { JobList } from "../page";
import { Legend } from "../ui";

export const dynamic = "force-dynamic";

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = readFilters(params);
  const filters = toBoardFilters(state);

  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Math.max(1, Number(one("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(one("size") ?? 50)));
  const dense = one("dense") === "1";

  const [rows, total, facets] = await Promise.all([
    listBoard({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
    countBoard(filters),
    boardFacets({ minFit: state.fit, cluster: state.cluster, q: state.q, sourceKind: state.source }),
  ]);

  return (
    <main>
      <header style={{ padding: "40px 0 16px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 8px" }}>
          Vagas
        </h1>
        <p style={{ color: "var(--text-2)", margin: 0 }}>
          {total.toLocaleString("pt-BR")} correspondem aos filtros
          {state.q ? ` para “${state.q}”` : ""}.
        </p>
      </header>

      <Presets base="/jobs" />
      <FilterBar base="/jobs" state={state} facets={facets} />
      <GridToolbar base="/jobs" state={state} total={total} dense={dense} />

      <div style={{ marginBottom: 14 }}>
        <Legend />
      </div>

      <JobList rows={rows} dense={dense} />

      <Pagination base="/jobs" state={state} page={page} pageSize={pageSize} total={total} />
    </main>
  );
}
