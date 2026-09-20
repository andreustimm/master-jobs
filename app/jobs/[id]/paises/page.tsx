import { notFound } from "next/navigation";
import { listBoard } from "../../../../src/contexts/matching/index.ts";
import { countryOf, groupByCountry } from "../../../../src/core/country.ts";
import { candidateScope, requirePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { JobList } from "../../../joblist";
import { TransitionLink } from "../../../transition-link";

export const dynamic = "force-dynamic";

/**
 * As publicações de uma vaga que saiu uma vez por país.
 *
 * Existe porque a linha agrupada representa N publicações e o clique entregava
 * uma: a de menor id, que é escolha de ordenação e não de produto. Quem clicava
 * em "Engineering Manager" com sete bandeiras abria a vaga na Holanda sem ter
 * pedido a Holanda.
 *
 * A âncora da URL é **qualquer publicação do grupo**, não um id de grupo: o
 * agrupamento é de apresentação e não existe registro para apontar. O link vale
 * enquanto aquela publicação estiver aberta, e devolve 404 quando ela fecha —
 * que é a resposta honesta, porque a regra 3 guarda o registro, não a vitrine.
 *
 * A lista é a mesma da tela de Vagas, sem agrupar: cada país traz a própria
 * nota, o próprio salário e o próprio estado no funil, que é justamente o que
 * pode divergir entre eles.
 */
export default async function JobCountries({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  const session = await requirePage("job:read");
  const candidateId = candidateScope(session);

  const { id } = await params;
  // Mesma guarda da página da vaga: id não numérico é endereço errado, não
  // incidente, e `NaN` na consulta estoura no PostgreSQL.
  const jobId = Number(id);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) notFound();

  const rows = await listBoard(candidateId, { sameGroupAs: jobId, status: "any" });
  if (rows.length === 0) notFound();

  const ancora = rows.find((row) => row.jobId === jobId) ?? rows[0]!;
  const paises = groupByCountry(
    rows.map((row) => ({ id: row.jobId, location: row.locationRaw })),
    locale,
  );
  const semPais = rows.filter((row) => countryOf(row.locationRaw) === null).length;

  return (
    <main className="pt-9 pb-16" data-testid="route-job-countries">
      <TransitionLink
        href="/jobs"
        data-testid="countries-back"
        className="inline-flex items-center py-1.5 type-body-md text-[var(--primary-text)] hover:underline"
      >
        {t("jobCountries.back")}
      </TransitionLink>

      <header className="mt-4 mb-6">
        <h1 data-user-content className="type-display-md min-w-0 break-words text-balance">
          {ancora.title}
        </h1>
        <p className="mt-2 text-muted-foreground" data-user-content>
          <strong className="text-foreground">{ancora.companyName}</strong>
        </p>
        <p className="mt-1.5 type-body-md text-muted-foreground" data-testid="countries-lead">
          {t("jobCountries.lead", { countries: paises.length, postings: rows.length })}
        </p>
        {semPais > 0 && (
          <p className="mt-1 type-caption-sm text-muted-foreground">
            {t("jobCountries.withoutCountry", { count: semPais })}
          </p>
        )}
      </header>

      {/* Denso: o título é o mesmo nas N linhas, e quem chega aqui já o leu no
          cabeçalho. O que ele procura é o país, o salário e o estado — e
          compactar aproxima isso do olho. */}
      <JobList
        rows={rows}
        dense
        locale={locale}
        t={t}
        context={{ triage: candidateId !== null, empty: t("jobCountries.empty") }}
      />
    </main>
  );
}
