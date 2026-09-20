import { flagOf, groupByCountry } from "../src/core/country.ts";
import type { GroupPosting } from "../src/contexts/matching/index.ts";
import type { Translator } from "../src/core/i18n/index.ts";
import { TransitionLink } from "./transition-link";

/**
 * Os países de uma vaga que foi publicada uma vez por país.
 *
 * A mesma vaga chega repetida: o acervo tem uma em 42 países, e sete linhas
 * iguais roubam a atenção de sete vagas diferentes. A lista mostra uma linha, e
 * aqui ficam os países dela — cada bandeira é o link para aquela publicação.
 *
 * A bandeira é o par de indicadores regionais. Windows não os desenha e mostra
 * as duas letras, que continuam dizendo o país: por isso o nome nunca depende
 * do desenho e vai no `title` e no `aria-label`, que é também o que faz o
 * rótulo aparecer ao passar o mouse sem uma linha de JavaScript.
 *
 * Localização que não nomeia um país — "Remote", "Bogota" — aparece como texto.
 * Inventar uma bandeira para ela seria pior que não ter nenhuma.
 */

/** Quantas cabem numa linha antes de a fileira virar um muro. */
const VISIVEIS = 8;

export function JobCountries({
  jobId,
  repeats,
  locale,
  t,
}: {
  jobId: number;
  repeats: GroupPosting[];
  locale: string;
  t: Translator["t"];
}) {
  if (repeats.length < 2) return null;

  const marcas = groupByCountry(repeats, locale).map((pais) => ({
    id: pais.id,
    // Sem país, a própria localização é a marca — encurtada, porque a linha é
    // estreita e "Bogota,D.C., Capital District" não cabe.
    marca: pais.code ? flagOf(pais.code) : pais.name.slice(0, 18),
    rotulo:
      pais.postings > 1
        ? t("jobs.countryWithCount", { name: pais.name, count: pais.postings })
        : pais.name,
  }));

  const mostradas = marcas.slice(0, VISIVEIS);
  const restantes = marcas.length - mostradas.length;

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid={`job-countries-${jobId}`}
      // Com um país só, a frase do conjunto diria "publicada em 1 países" e não
      // acrescentaria nada: o rótulo do próprio link já diz onde a vaga está.
      aria-label={marcas.length > 1 ? t("jobs.countriesLabel", { count: marcas.length }) : undefined}
    >
      {mostradas.map((marca) => (
        <TransitionLink
          key={marca.id}
          href={`/jobs/${marca.id}`}
          title={marca.rotulo}
          aria-label={marca.rotulo}
          className="rounded px-1 leading-none hover:bg-muted"
          data-testid={`job-country-${jobId}-${marca.id}`}
          data-user-content
        >
          {marca.marca}
        </TransitionLink>
      ))}
      {restantes > 0 && (
        <TransitionLink
          href={`/jobs/${jobId}`}
          className="rounded px-1 leading-none text-[var(--primary-text)] hover:underline"
          data-testid={`job-countries-more-${jobId}`}
        >
          {t("jobs.moreCountries", { count: restantes })}
        </TransitionLink>
      )}
    </span>
  );
}
