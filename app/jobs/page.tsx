import { boardFacets, countBoard, listBoard } from "../../src/core/db/repo.ts";
import { FilterBar, readFilters, toBoardFilters } from "../filters";
import { GridToolbar, Pagination, Presets } from "../grid";
import { JobList } from "../joblist";
import { Legend } from "../ui";
import { requirePage } from "../auth";
import { getTranslator } from "../i18n";

export const dynamic = "force-dynamic";

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslator();
  await requirePage("job:read");

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
      <header className="pt-10 pb-4">
        <h1 className="type-display-md chevron mb-4">{t("jobs.title")}</h1>
        <p className="type-body-md text-muted-foreground">
          {total.toLocaleString(locale)} {t("jobs.matching")}
          {state.q ? ` para “${state.q}”` : ""}.
        </p>
      </header>

      <Presets base="/jobs" t={t} />
      <FilterBar base="/jobs" state={state} facets={facets} t={t} />
      <GridToolbar base="/jobs" state={state} total={total} dense={dense} t={t} />

      <div className="mb-3.5">
        <Legend t={t} />
      </div>

      <JobList rows={rows} dense={dense} t={t} locale={locale} />

      <Pagination base="/jobs" state={state} page={page} pageSize={pageSize} total={total} t={t} />
    </main>
  );
}
