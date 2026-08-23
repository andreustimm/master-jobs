import { boardFacets, countBoard, listBoard } from "../../src/contexts/matching/index.ts";
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
  // `job:read`, não `candidate:read`.
  //
  // O acervo é GLOBAL e a política concede leitura aos três papéis. A página
  // pedia escopo de candidato, e o efeito era um recrutador entrar com a senha
  // certa e receber 403 aqui — cada metade correta sozinha, a composição
  // contradizendo a política. Nenhum teste puro vê isso; só um browser entrando
  // como recrutador.
  //
  // `candidateId` pode ser null. Nota de aderência e estado de candidatura são
  // colunas de UMA pessoa: para quem não é candidato elas simplesmente não
  // existem, e voltam nulas.
  const session = await requirePage("job:read");
  const candidateId = session.candidateId;

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
    listBoard(candidateId, { ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
    countBoard(candidateId, filters),
    boardFacets(candidateId, { minFit: state.fit, cluster: state.cluster, q: state.q, sourceKind: state.source }),
  ]);

  return (
    <main className="page-content-top">
      <header className="pb-4">
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
