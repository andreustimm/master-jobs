import { getTranslator } from "../../i18n";
import { LoadingRegion, SkeletonBar } from "../../skeleton";

/**
 * Fronteira de carregamento de `/jobs`.
 *
 * Mora no grupo `(lista)` e não em `app/jobs/`: ali ela envolveria também
 * `/jobs/<id>`, `/jobs/<id>/paises` e `/jobs/new`, e o primeiro chunk do fallback
 * compromete o status HTTP em 200 — `/jobs/999999999` deixaria de responder
 * 404, e isso é contrato testado. Nem em `app/`: a ausência de
 * `app/loading.tsx` também é contrato (`navigation-adapters`).
 *
 * Numa rota dinâmica, é esta fronteira que o roteador pré-carrega: o clique em
 * "Vagas", vindo de outra tela, troca a tela na hora por este esqueleto, e a
 * lista chega por streaming. Filtro, ordem e página NÃO passam por aqui: a
 * chave de estado do segmento exclui a query, a fronteira já revelada continua
 * montada, e a transição suave (#220) mantém a lista anterior à vista. O título
 * é o real; o resto só reserva o espaço, para a lista não empurrar a página
 * quando entra.
 */
export default async function JobsLoading() {
  const { t } = await getTranslator();
  return (
    <main className="page-content-top" data-testid="route-jobs-loading">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("jobs.title")}</h1>
      </header>
      <LoadingRegion label={t("jobs.loading")} testId="jobs-loading">
        <SkeletonBar className="mb-4 h-5 w-1/3" />
        <div className="mb-4 grid gap-3 rounded-xl border bg-card p-4">
          <SkeletonBar className="h-9 w-full" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SkeletonBar className="h-9 w-full" />
            <SkeletonBar className="h-9 w-full" />
            <SkeletonBar className="h-9 w-full" />
          </div>
        </div>
        <div className="divide-y overflow-hidden rounded-xl border">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid gap-2 p-4">
              <SkeletonBar className="h-5 w-3/4" />
              <SkeletonBar className="h-4 w-1/2" />
              <SkeletonBar className="h-2 w-full" />
            </div>
          ))}
        </div>
      </LoadingRegion>
    </main>
  );
}
