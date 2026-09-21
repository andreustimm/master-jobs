import { countryRow } from "../src/core/country.ts";
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
 *
 * **O que mostrar e para onde ir é decidido em `src/core/country.ts`**, em
 * função pura. Três decisões erraram aqui uma vez — publicação sem localização
 * virava âncora vazia, e o transbordo levava à publicação canônica em vez do
 * hub —, e nenhuma delas era alcançável por teste enquanto morava no JSX.
 */
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

  const { marcas, restantes, maisHref } = countryRow(jobId, repeats, locale, {
    semLocal: t("jobs.countryUnknown"),
    comContagem: (name, count) => t("jobs.countryWithCount", { name, count }),
  });

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid={`job-countries-${jobId}`}
      // `role="group"` porque o role implícito de `<span>` é `generic`, e ARIA
      // proíbe nome acessível nesse role: o `aria-label` abaixo era simplesmente
      // descartado, e o resumo que o comentário seguinte raciocina sobre quando
      // mostrar nunca chegava a ninguém. A varredura de acessibilidade não pegou
      // porque `aria-prohibited-attr` devolve *incomplete*, e não violação,
      // quando o elemento tem texto dentro — e aqui tem, as bandeiras.
      role="group"
      // Com um país só, a frase do conjunto diria "publicada em 1 países" e não
      // acrescentaria nada: o rótulo do próprio link já diz onde a vaga está.
      aria-label={marcas.length > 1 ? t("jobs.countriesLabel", { count: marcas.length + restantes }) : undefined}
    >
      {marcas.map((marca) => (
        <TransitionLink
          key={marca.id}
          href={`/jobs/${marca.id}`}
          title={marca.rotulo}
          aria-label={marca.rotulo}
          className="rounded px-1 leading-none hover:bg-muted"
          data-testid={`job-country-${jobId}-${marca.id}`}
          data-user-content={marca.doUsuario ? "" : undefined}
        >
          {marca.marca}
        </TransitionLink>
      ))}
      {restantes > 0 && (
        <TransitionLink
          href={maisHref}
          className="rounded px-1 leading-none text-[var(--primary-text)] hover:underline"
          data-testid={`job-countries-more-${jobId}`}
        >
          {t("jobs.moreCountries", { count: restantes })}
        </TransitionLink>
      )}
    </span>
  );
}
