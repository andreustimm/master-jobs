import type { Route } from "next";
import type { ReactNode } from "react";
import { candidateLabel } from "../../src/contexts/pursuit/index.ts";
import type { LocaleId, TranslationKey, Translator } from "../../src/core/i18n/index.ts";
import { LocalDate } from "../local-date";
import { TransitionLink } from "../transition-link";

/**
 * Peças comuns das telas do recrutador e das sugestões (#465, task_04): o nome
 * do candidato como dado de usuário, a data no fuso de quem lê dentro de uma
 * frase do dicionário e a paginação.
 */

type T = Translator["t"];

/**
 * O nome que o candidato escolheu, como texto literal; sem nome, o rótulo
 * neutro com a headline (US-013.EC-2). O e-mail nunca chega aqui.
 */
export function CandidateName({ name, headline, t }: { name: string; headline: string | null; t: T }) {
  const label = candidateLabel(name, headline);
  if (label.named) return <span data-user-content>{label.name}</span>;
  if (label.headline === null) return <span>{t("recruiter.unnamed")}</span>;
  const [before, after] = t("recruiter.unnamedWithHeadline", { headline: "\u0000" }).split("\u0000");
  return (
    <span>
      {before}
      <span data-user-content>{label.headline}</span>
      {after}
    </span>
  );
}

/** O mesmo rótulo como texto, para o título da aba. */
export function candidateTitle(name: string, headline: string | null, t: T): string {
  const label = candidateLabel(name, headline);
  if (label.named) return label.name;
  return label.headline === null ? t("recruiter.unnamed") : t("recruiter.unnamedWithHeadline", { headline: label.headline });
}

/**
 * Uma frase do dicionário com uma data no fuso de quem lê: o texto fica no
 * dicionário, e a data é uma ilha que a hidratação troca pelo dia local.
 */
export function DatedText({
  t,
  keyName,
  iso,
  locale,
  testId,
}: {
  t: T;
  keyName: TranslationKey;
  iso: string;
  locale: LocaleId;
  testId?: string;
}) {
  const [before, after] = t(keyName, { date: "\u0000" }).split("\u0000");
  return (
    <span data-testid={testId}>
      {before}
      <LocalDate iso={iso} locale={locale} />
      {after}
    </span>
  );
}

/** Anterior e próxima, com "página X de Y"; nada quando há uma página só. */
export function Pager({
  page,
  pages,
  href,
  testId,
  t,
}: {
  page: number;
  pages: number;
  href: (page: number) => Route;
  testId: string;
  t: T;
}): ReactNode {
  if (pages <= 1) return null;
  return (
    <nav className="mt-6 flex flex-wrap items-center gap-3 text-sm" data-testid={testId}>
      {page > 1 ? (
        <TransitionLink
          href={href(page - 1)}
          data-testid={`${testId}-previous`}
          className="inline-flex min-h-11 items-center text-[var(--primary-text)] hover:underline"
        >
          {`← ${t("directory.previous")}`}
        </TransitionLink>
      ) : null}
      <span className="text-muted-foreground">{t("directory.pageOf", { page: String(page), pages: String(pages) })}</span>
      {page < pages ? (
        <TransitionLink
          href={href(page + 1)}
          data-testid={`${testId}-next`}
          className="inline-flex min-h-11 items-center text-[var(--primary-text)] hover:underline"
        >
          {`${t("directory.next")} →`}
        </TransitionLink>
      ) : null}
    </nav>
  );
}
