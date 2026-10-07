import type { Metadata, Route } from "next";
import { XIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  parseDirectoryQuery,
  recordDirectorySearch,
  searchDirectory,
  type DirectoryCard,
  type DirectoryQuery,
  type DirectoryResult,
} from "../../../src/core/candidate-directory.ts";
import {
  EXPERIENCE_LEVELS,
  WORK_MODELS,
} from "../../../src/core/candidate-public-facts.ts";
import type { Translator } from "../../../src/core/i18n/index.ts";
import { requirePage } from "../../auth";
import { EXPERIENCE_LEVEL_LABEL, FACT_LABEL, WORK_MODEL_LABEL } from "../../candidate/public-facts-labels";
import { getTranslator } from "../../i18n";
import { SkillBadge } from "../../p/[slug]/profile-view";
import { TransitionGetForm } from "../../transition-get-form";
import { TransitionLink } from "../../transition-link";

/**
 * O diretório de perfis para recrutadores (#465, ADR-010, ADR-013).
 *
 * A guarda vem antes de qualquer leitura: `candidate:discover` só passa para
 * sessão de recrutador (emprestada inclusive — o admin que assume um
 * recrutador vê o que ele vê). Candidato e admin sem o papel recebem 403; sem
 * sessão, o proxy manda ao login com `next`.
 *
 * A busca grava uma linha em `recruiter_directory_query` e conta a janela
 * antes de consultar perfis (ADR-017): a 61ª em dez minutos mostra "Tente de
 * novo em instantes" e nenhum cartão. Paginar conta como buscar.
 *
 * O formulário mostra a busca JÁ ANALISADA (`parseDirectoryQuery`), nunca o
 * parâmetro cru: valor fora da lista some, e o que a pessoa vê é o que filtrou.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("directory.title"), robots: { index: false, follow: false } };
}

export default async function RecruiterDirectoryPage({ searchParams }: Props) {
  const session = await requirePage("candidate:discover");
  const { t } = await getTranslator();
  const query = parseDirectoryQuery(await searchParams);
  const allowed = await recordDirectorySearch(session.userId, new Date().toISOString());
  const result = allowed.ok ? await searchDirectory(query) : null;
  return <DirectoryView query={query} result={result} t={t} />;
}

/** O endereço da busca, montado do estado já analisado e de uma troca. */
function directoryHref(query: DirectoryQuery, patch: Partial<Record<"q" | "location" | "workModel" | "level" | "page", string | null>>): Route {
  const params = new URLSearchParams();
  const values: Record<string, string | null> = {
    q: query.text || null,
    location: query.location,
    workModel: query.workModel,
    level: query.level,
    page: null,
    ...patch,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const search = params.toString();
  return (search ? `/recruiter/directory?${search}` : "/recruiter/directory") as Route;
}

const SELECT_CLASS = cn(
  "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
);

const chipClass = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "h-auto min-h-11 max-w-full gap-1.5 py-1 text-left font-normal whitespace-normal wrap-anywhere type-micro xl:min-h-7",
);

/** Cada filtro ativo, com o endereço que o retira. */
function activeFilters(query: DirectoryQuery, t: Translator["t"]): { key: string; label: string; userContent: boolean; href: Route }[] {
  const out: { key: string; label: string; userContent: boolean; href: Route }[] = [];
  if (query.text) {
    out.push({ key: "q", label: t("directory.textFilter", { text: query.text }), userContent: true, href: directoryHref(query, { q: null }) });
  }
  if (query.location) {
    out.push({
      key: "location",
      label: t("directory.locationFilter", { location: query.location }),
      userContent: true,
      href: directoryHref(query, { location: null }),
    });
  }
  if (query.workModel) {
    out.push({
      key: "workModel",
      label: `${t(FACT_LABEL.workModel)}: ${t(WORK_MODEL_LABEL[query.workModel])}`,
      userContent: false,
      href: directoryHref(query, { workModel: null }),
    });
  }
  if (query.level) {
    out.push({
      key: "level",
      label: `${t(FACT_LABEL.experienceLevel)}: ${t(EXPERIENCE_LEVEL_LABEL[query.level])}`,
      userContent: false,
      href: directoryHref(query, { level: null }),
    });
  }
  return out;
}

/**
 * A tela, sem I/O: recebe a busca analisada e o resultado (ou `null` quando o
 * limite recusou) e só desenha.
 */
function DirectoryView({
  query,
  result,
  t,
}: {
  query: DirectoryQuery;
  result: DirectoryResult | null;
  t: Translator["t"];
}) {
  const filters = activeFilters(query, t);
  const criteria = filters.length > 0;

  return (
    <main className="pt-10 pb-16" data-testid="route-recruiter-directory">
      <h1 className="type-display-md chevron mb-4">{t("directory.title")}</h1>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">{t("directory.lead")}</p>

      <Card className="mb-6 gap-4 p-4">
        {/* Chave pela busca: os campos são não controlados, e sem remontar o
            valor de antes ficaria na caixa depois de "remover filtro" (#492). */}
        <TransitionGetForm
          key={directoryHref(query, {})}
          action="/recruiter/directory"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end"
          data-testid="directory-form"
        >
          <label className="grid min-w-0 gap-1.5 type-body-sm">
            {t("directory.searchLabel")}
            <Input
              name="q"
              type="search"
              defaultValue={query.text}
              maxLength={200}
              placeholder={t("directory.searchPlaceholder")}
              data-testid="directory-q"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 type-body-sm">
            {t("directory.locationLabel")}
            <Input name="location" defaultValue={query.location ?? ""} maxLength={100} data-testid="directory-location" />
          </label>
          <label className="grid min-w-0 gap-1.5 type-body-sm">
            {t(FACT_LABEL.workModel)}
            <select name="workModel" defaultValue={query.workModel ?? ""} className={SELECT_CLASS} data-testid="directory-work-model">
              <option value="">{t("directory.any")}</option>
              {WORK_MODELS.map((model) => (
                <option key={model} value={model}>
                  {t(WORK_MODEL_LABEL[model])}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 type-body-sm">
            {t(FACT_LABEL.experienceLevel)}
            <select name="level" defaultValue={query.level ?? ""} className={SELECT_CLASS} data-testid="directory-level">
              <option value="">{t("directory.any")}</option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(EXPERIENCE_LEVEL_LABEL[level])}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" className="min-h-11 xl:min-h-9" data-testid="directory-submit">
            {t("directory.submit")}
          </Button>
        </TransitionGetForm>

        {criteria && (
          <div className="flex flex-wrap items-center gap-2" data-testid="directory-filters">
            <span className="type-micro text-muted-foreground">{t("directory.activeFilters")}</span>
            {filters.map((filter) => (
              <TransitionLink
                key={filter.key}
                href={filter.href}
                className={chipClass}
                aria-label={t("directory.removeFilter", { label: filter.label })}
                data-testid={`directory-chip-${filter.key}`}
              >
                <span {...(filter.userContent ? { "data-user-content": true } : {})}>{filter.label}</span>
                <XIcon className="size-3.5 shrink-0" aria-hidden />
              </TransitionLink>
            ))}
            <TransitionLink
              href="/recruiter/directory"
              className="inline-flex min-h-11 items-center type-meta text-[var(--primary-text)] hover:underline xl:min-h-0"
              data-testid="directory-clear"
            >
              {t("directory.clearAll")}
            </TransitionLink>
          </div>
        )}
      </Card>

      {result === null ? (
        <Card className="p-6 text-sm" role="status" data-testid="directory-rate-limited">
          {t("directory.rateLimited")}
        </Card>
      ) : result.cards.length === 0 ? (
        // Sem contagem e sem pista de quem não aparece: o vazio é o mesmo com
        // ou sem perfis privados na instalação.
        <Card className="p-6 text-sm text-muted-foreground" data-testid="directory-empty">
          {criteria ? t("directory.noMatch") : t("directory.empty")}
        </Card>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border" aria-label={t("directory.results")} data-testid="directory-results">
            {result.cards.map((card) => (
              <DirectoryCardItem key={card.id} card={card} t={t} />
            ))}
          </ul>
          <Pagination query={query} result={result} t={t} />
        </>
      )}
    </main>
  );
}

/** Quantas skills o cartão mostra; o perfil mostra todas. */
const CARD_SKILLS = 6;

function DirectoryCardItem({ card, t }: { card: DirectoryCard; t: Translator["t"] }) {
  const facts = [
    ...card.facts.workModel.map((model) => t(WORK_MODEL_LABEL[model])),
    ...(card.facts.experienceLevel ? [t(EXPERIENCE_LEVEL_LABEL[card.facts.experienceLevel])] : []),
  ];
  const skills = [...card.skills].sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name)).slice(0, CARD_SKILLS);
  return (
    <li className="bg-card px-4 py-3.5 sm:px-5" data-testid={`directory-card-${card.id}`}>
      <TransitionLink
        href={`/recruiter/directory/${card.id}`}
        className="inline-flex min-h-11 items-center font-semibold hover:underline xl:min-h-0"
        data-testid={`directory-open-${card.id}`}
      >
        {/* Perfil sem nome escolhido: o link não pode ficar vazio. */}
        {card.name ? <span data-user-content>{card.name}</span> : <span>{t("publicName.unnamed")}</span>}
      </TransitionLink>
      {card.headline && (
        <p data-user-content className="type-body-sm mt-0.5 break-words text-muted-foreground">
          {card.headline}
        </p>
      )}
      {(card.location || facts.length > 0) && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 type-meta text-muted-foreground">
          {card.location && <span data-user-content>{card.location}</span>}
          {facts.length > 0 && <span>{facts.join(" · ")}</span>}
        </p>
      )}
      {skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <SkillBadge key={`${skill.category}-${skill.name}`} skill={skill} />
          ))}
        </div>
      )}
    </li>
  );
}

function Pagination({ query, result, t }: { query: DirectoryQuery; result: DirectoryResult; t: Translator["t"] }) {
  if (result.pageCount <= 1) return null;
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 xl:min-h-7");
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label={t("directory.results")} data-testid="directory-pagination">
      {result.page > 1 ? (
        <TransitionLink href={directoryHref(query, { page: String(result.page - 1) })} className={link} data-testid="directory-previous">
          {t("directory.previous")}
        </TransitionLink>
      ) : (
        <span />
      )}
      <span className="type-meta text-muted-foreground" data-testid="directory-page">
        {t("directory.pageOf", { page: result.page, pages: result.pageCount })}
      </span>
      {result.page < result.pageCount ? (
        <TransitionLink href={directoryHref(query, { page: String(result.page + 1) })} className={link} data-testid="directory-next">
          {t("directory.next")}
        </TransitionLink>
      ) : (
        <span />
      )}
    </nav>
  );
}
