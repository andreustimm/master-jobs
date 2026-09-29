import type { Metadata } from "next";
import { ChevronDownIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cvSections, type CvSectionKind } from "../../../src/core/cv-markdown.ts";
import { parseStorageConfig } from "../../../src/core/storage/config.ts";
import {
  groupPublicSkills,
  publicProfile,
  type PublicProfile,
  type PublicSkill,
  type PublicSkillGroup,
} from "../../../src/core/candidate-public.ts";
import {
  AVAILABILITY_LABEL,
  EXPERIENCE_LEVEL_LABEL,
  FACT_LABEL,
  START_TIMEFRAME_LABEL,
  WORK_MODEL_LABEL,
} from "../../candidate/public-facts-labels";
import { isSkillCategory, type SkillCategory } from "../../../src/contexts/skills/index.ts";
import type { Translator, TranslationKey } from "../../../src/core/i18n/index.ts";
import { MarkdownPreview } from "../../candidate/markdown-preview";
import { getTranslator } from "../../i18n";
import { CopyProfileLinkButton } from "./copy-link-button";

/**
 * Portfólio público, layout de referência Jobicy com o dado que já existe
 * (#326, fase 2/3 de #315). O que ela mostra vem de `publicProfile()`, que
 * monta o objeto por lista de permissão — esta página não tem acesso ao
 * registro do candidato e portanto não consegue vazar um campo por descuido.
 *
 * **404 e não 403** para perfil que não é público. 403 confirmaria que o slug
 * existe, e existência é informação: quem varre uma lista de nomes aprende
 * quais estão cadastrados. A instalação já se comporta assim onde importa.
 *
 * **`noindex` sempre.** `visibility = public` significa "alcançável sem
 * sessão", não "quero aparecer no Google" — são decisões diferentes, e mandar
 * o link para um recrutador não é publicar.
 *
 * **As seções (Resumo/Experiência/Formação) nascem AQUI**, de
 * `cvSections(profile.cv)` — a função pura de `cv-markdown.ts` que a fase 1
 * (#325) já expõe. `publicProfile()` não muda: o texto que chega já passou
 * pelos dois filtros de `publicCvMarkdown()`, e derivar seções dele nunca
 * devolve o que os filtros tiraram, porque `cvSections()` só lê o que sobrou.
 * Card sem a seção correspondente simplesmente não aparece — Jobicy mostra
 * "No data available" nesse caso; aqui a ausência de card é a informação.
 *
 * **Fatos opt-in (#327, fase 3)** chegam em `profile.facts` já filtrados: só
 * o que a pessoa marcou para mostrar. A página só escolhe o lugar — faixa do
 * topo ou "Em resumo" na lateral (`factItems`).
 *
 * **Foto e capa (#327)** chegam como versão opaca em `profile.images`, só com
 * opt-in. A página nunca vê a chave nem URL de provedor: aponta para a rota
 * `/p/<endereço>/image/<tipo>`, que reconfere a visibilidade a cada pedido.
 * `<img>` e não `next/image`: o otimizador guardaria cópia em cache, e a
 * cópia não obedece a quem desmarcar "mostrar" depois.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Quantas skills um grupo mostra antes do "+N" recolhido em `<details>`. */
const SKILLS_VISIBLE_PER_GROUP = 6;

const SECTION_LABEL_KEYS: Record<CvSectionKind, TranslationKey> = {
  summary: "publicProfile.summary",
  experience: "publicProfile.experience",
  education: "publicProfile.education",
};

/** Mesma chave por categoria de `app/candidate/skills/page.tsx`, sob o mesmo dicionário. */
const CATEGORY_LABEL_KEYS: Record<SkillCategory, TranslationKey> = {
  language: "skillCategories.language",
  framework: "skillCategories.framework",
  ai: "skillCategories.ai",
  cloud: "skillCategories.cloud",
  data: "skillCategories.data",
  practice: "skillCategories.practice",
  domain: "skillCategories.domain",
  tool: "skillCategories.tool",
  soft: "skillCategories.soft",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await publicProfile((await params).slug);
  const { t } = await getTranslator();
  return {
    // Sem perfil, o título é o mesmo 404 de qualquer endereço: "perfil sem
    // nome" diria que existe um perfil ali.
    title: !profile
      ? t("routeStatus.notFoundTitle")
      : profile.name
        ? t("publicName.pageTitle", { name: profile.name })
        : t("publicName.unnamed"),
    description: profile?.headline ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: Params) {
  // O limite por IP mora no `proxy.ts`, não aqui. Ver a nota lá: a página não
  // consegue devolver 429 com `Retry-After`, e limitar depois de renderizar
  // pagaria o custo que o limite existe para evitar.
  const profile = await publicProfile((await params).slug);
  if (!profile) notFound();
  const { t } = await getTranslator();

  const sections = profile.cv ? cvSections(profile.cv) : [];
  const sectionOf = (kind: CvSectionKind) => sections.find((section) => section.kind === kind);
  const skillGroups = groupPublicSkills(profile.skills);
  const { strip, glance } = factItems(profile, t);
  const imageUrl = (kind: "photo" | "cover", version: string) =>
    `/p/${encodeURIComponent(profile.slug)}/image/${kind}?v=${version}`;
  // Sem armazenamento configurado a rota da imagem não tem de onde ler: em vez
  // do ícone de imagem quebrada, a página omite foto e capa, como faz quando o
  // "mostrar" está desligado.
  const storageReady = parseStorageConfig(process.env).status === "configured";
  const cover = storageReady ? profile.images.cover : null;
  const photo = storageReady ? profile.images.photo : null;

  return (
    <main className="mx-auto w-full max-w-[74rem] pt-12 pb-16" data-testid="route-public-profile">
      {/* Capa (#327): faixa larga acima do nome, moldura de foto do DESIGN.md
          (`rounded-xl`). Decorativa — o nome logo abaixo já diz de quem é —,
          por isso `alt` vazio. Mais alta no celular (3:1) para não virar fita. */}
      {cover && (
        <img
          src={imageUrl("cover", cover)}
          alt=""
          width={1600}
          height={400}
          className="mb-6 aspect-[3/1] h-auto w-full rounded-xl object-cover sm:aspect-[4/1]"
          data-testid="public-profile-cover"
        />
      )}
      <header className="mb-8">
        <div className="flex min-w-0 items-start gap-4">
          {/* Foto (#327): quadrada, com o raio das ações — o DESIGN.md não usa
              avatar circular. Ao lado do nome, sem sobrepor a capa, para a
              ordem de leitura continuar nome → headline em 375px. */}
          {photo && (
            <img
              src={imageUrl("photo", photo)}
              alt={profile.name ? t("publicImages.photoAlt", { name: profile.name }) : t("publicImages.photoAltUnnamed")}
              width={512}
              height={512}
              className="size-20 shrink-0 rounded-[var(--radius-action)] object-cover sm:size-24 lg:size-32"
              data-testid="public-profile-photo"
            />
          )}
          <div className="min-w-0">
            {/* Nome vazio é perfil que ainda não escolheu um nome publicável —
                `publicProfile()` também esvazia o que parece e-mail ou telefone.
                O título neutro vem do dicionário, nunca de outro campo da pessoa. */}
            {profile.name ? (
              <h1 data-user-content className="type-display-md break-words">
                {profile.name}
              </h1>
            ) : (
              <h1 className="type-display-md">{t("publicName.unnamed")}</h1>
            )}
            {profile.headline && (
              <p data-user-content className="type-body-lg mt-1 text-muted-foreground">
                {profile.headline}
              </p>
            )}
          </div>
        </div>

        {/* Faixa de fatos: localização e, com opt-in (#327), modelo de
            trabalho, nível e disponibilidade. Some inteira sem nenhum. */}
        {strip.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-y py-3" data-testid="public-profile-facts">
            {strip.map((fact) => (
              <FactItem key={fact.key} fact={fact} />
            ))}
          </dl>
        )}

        {/* CTA acima da dobra em 375px: link real (regra 1), nunca envio nem
            formulário de contato. Compartilhar só copia a URL atual. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {profile.linkedinUrl && (
            <a
              href={profile.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              data-testid="public-profile-linkedin"
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "min-h-11 xl:h-7 xl:min-h-0")}
            >
              {t("publicProfile.linkedin")}
            </a>
          )}
          {profile.githubUrl && (
            <a
              href={profile.githubUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              data-testid="public-profile-github"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 xl:h-7 xl:min-h-0")}
            >
              {t("publicProfile.github")}
            </a>
          )}
          <CopyProfileLinkButton
            label={t("publicProfile.copyLink")}
            copiedLabel={t("publicProfile.linkCopied")}
            failedLabel={t("publicProfile.linkCopyFailed")}
          />
        </div>
      </header>

      {/* Duas colunas só a partir de 1024px (`lg:`); abaixo disso, uma coluna
          na ordem do documento — principal primeiro, skills depois. A ordem
          do grid segue a do DOM: não precisa de `order-*` para a principal
          cair à esquerda. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6" data-testid="public-profile-main">
          {(Object.keys(SECTION_LABEL_KEYS) as CvSectionKind[]).map((kind) => {
            const section = sectionOf(kind);
            if (!section) return null;
            return (
              <Card key={kind} data-testid={`public-section-${kind}`}>
                <CardContent className="pt-0">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="type-display-xs">{t(SECTION_LABEL_KEYS[kind])}</h2>
                    {/* Micro-rótulo com o título ORIGINAL da seção no currículo
                        da pessoa (ex.: "SUMMARY", "CORE EXPERTISE") — dado do
                        usuário, ao lado do rótulo fixo e traduzido. Padrão
                        novo, documentado em DESIGN.md. */}
                    <span data-user-content className="type-micro text-muted-foreground">
                      {section.title}
                    </span>
                  </div>
                  <div data-user-content>
                    <MarkdownPreview source={section.body} emptyLabel="" />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {profile.cv && (
            <details className="group rounded-xl border" data-testid="public-cv-full">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 type-body-emphasis [&::-webkit-details-marker]:hidden">
                {t("publicProfile.fullCv")}
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t px-4 py-4">
                <div data-user-content data-testid="public-cv">
                  <MarkdownPreview source={profile.cv} emptyLabel="" />
                </div>
              </div>
            </details>
          )}
        </div>

        {(glance.length > 0 || skillGroups.length > 0) && (
          <aside className="flex min-w-0 flex-col gap-6" data-testid="public-profile-aside">
            {/* "Em resumo" (#327): só os fatos com opt-in; sem nenhum, o
                cartão não existe — nada de "não informado" para o visitante. */}
            {glance.length > 0 && (
              <Card data-testid="public-profile-glance">
                <CardContent className="pt-0">
                  <h2 className="type-display-xs mb-3">{t("publicFacts.glance")}</h2>
                  <dl className="flex flex-col gap-3">
                    {glance.map((fact) => (
                      <FactItem key={fact.key} fact={fact} />
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )}
            {skillGroups.length > 0 && (
              <section className="min-w-0" data-testid="public-profile-skills">
                <h2 className="type-display-xs mb-3">{t("publicProfile.skillsTitle")}</h2>
                <div className="flex flex-col gap-4">
                  {skillGroups.map((group) => (
                    <SkillGroup key={group.category} group={group} t={t} />
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}

/**
 * Um fato já pronto para a tela. `userContent` marca o texto que a pessoa
 * ESCREVEU (localização, área, idiomas): fica no idioma dela, com
 * `data-user-content` (G30). Valor controlado vem traduzido do dicionário.
 */
type FactView = { key: string; label: string; value: string; userContent: boolean };

/**
 * Separa os fatos entre a faixa do topo e o "Em resumo" da lateral.
 *
 * Só entra o que `publicProfile()` devolveu preenchido — e ele só devolve o
 * que tem opt-in (`publicFactsFrom()`). Esta função não decide visibilidade;
 * decide LUGAR. Faixa: o que o recrutador pergunta primeiro (onde, como,
 * que nível, está procurando?). Resumo: o resto.
 */
function factItems(profile: PublicProfile, t: Translator["t"]): { strip: FactView[]; glance: FactView[] } {
  const { facts } = profile;
  const strip: FactView[] = [];
  const glance: FactView[] = [];

  if (profile.location) {
    strip.push({ key: "location", label: t("publicProfile.locationLabel"), value: profile.location, userContent: true });
  }
  if (facts.workModel.length > 0) {
    strip.push({
      key: "workModel",
      label: t(FACT_LABEL.workModel),
      value: facts.workModel.map((model) => t(WORK_MODEL_LABEL[model])).join(" · "),
      userContent: false,
    });
  }
  if (facts.experienceLevel) {
    strip.push({
      key: "experienceLevel",
      label: t(FACT_LABEL.experienceLevel),
      value: t(EXPERIENCE_LEVEL_LABEL[facts.experienceLevel]),
      userContent: false,
    });
  }
  if (facts.availability) {
    strip.push({
      key: "availability",
      label: t(FACT_LABEL.availability),
      value: t(AVAILABILITY_LABEL[facts.availability]),
      userContent: false,
    });
  }

  if (facts.area) glance.push({ key: "area", label: t(FACT_LABEL.area), value: facts.area, userContent: true });
  if (facts.languages) {
    glance.push({ key: "languages", label: t(FACT_LABEL.languages), value: facts.languages, userContent: true });
  }
  if (facts.startTimeframe) {
    glance.push({
      key: "startTimeframe",
      label: t(FACT_LABEL.startTimeframe),
      value: t(START_TIMEFRAME_LABEL[facts.startTimeframe]),
      userContent: false,
    });
  }
  if (facts.openToRelocation !== null) {
    glance.push({
      key: "openToRelocation",
      label: t(FACT_LABEL.openToRelocation),
      value: t(facts.openToRelocation ? "publicFacts.yes" : "publicFacts.no"),
      userContent: false,
    });
  }

  return { strip, glance };
}

/** Rótulo pequeno em cima, valor embaixo — o mesmo desenho da faixa de #326. */
function FactItem({ fact }: { fact: FactView }) {
  return (
    <div className="min-w-0" data-testid={`public-fact-${fact.key}`}>
      <dt className="type-micro text-muted-foreground">{fact.label}</dt>
      <dd className="type-body-sm break-words" {...(fact.userContent ? { "data-user-content": true } : {})}>
        {fact.value}
      </dd>
    </div>
  );
}

/**
 * Uma categoria de skills: top N visível + `<details>` recolhido para o resto.
 *
 * Categoria fora de `SkillCategory` (schema sem CHECK constraint — uma
 * migration futura ou um valor manual poderia gravar algo fora do enum) cai no
 * texto cru, marcado `data-user-content`: não é rótulo de interface, então não
 * finge ser um, e a varredura de inglês sem sessão não a barra por acidente.
 */
function SkillGroup({ group, t }: { group: PublicSkillGroup; t: Translator["t"] }) {
  const category = group.category;
  const label = isSkillCategory(category) ? t(CATEGORY_LABEL_KEYS[category]) : category;
  const known = isSkillCategory(category);
  const visible = group.skills.slice(0, SKILLS_VISIBLE_PER_GROUP);
  const rest = group.skills.slice(SKILLS_VISIBLE_PER_GROUP);

  return (
    <div data-testid="public-skill-group">
      <h3
        className="type-micro mb-2 text-muted-foreground"
        {...(known ? {} : { "data-user-content": true })}
      >
        {label}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((item) => (
          <SkillBadge key={`${group.category}-${item.name}`} skill={item} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="group mt-1.5">
          <summary
            className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 type-meta text-[var(--primary-text)] [&::-webkit-details-marker]:hidden"
            data-testid="public-skill-more"
            aria-label={t("publicProfile.showMoreSkillsAria", { count: rest.length, category: label })}
          >
            {t("publicProfile.showMoreSkills", { count: rest.length })}
            <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rest.map((item) => (
              <SkillBadge key={`${group.category}-${item.name}`} skill={item} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Nome (+ nível, quando alguém confirmou um) sem caixa alta forçada — a
 * `Badge` com `type-micro` deixava as ~20 skills em maiúsculas; `type-meta`
 * não tem `text-transform`. Só as confirmadas chegam aqui — regra 6.
 *
 * `level` é texto livre digitado por um humano (schema: "deliberately not
 * inferred") e pode ser mais longo que um rótulo comum — a `Badge` padrão é
 * `whitespace-nowrap` e `h-5`, o que estourava a largura em 375px. Aqui ela
 * quebra linha e cresce em altura em vez de vazar da tela.
 */
function SkillBadge({ skill }: { skill: PublicSkill }) {
  return (
    <Badge
      variant="outline"
      data-user-content
      className="h-auto max-w-full items-start py-1 break-words whitespace-normal type-meta"
    >
      {skill.name}
      {skill.level ? ` · ${skill.level}` : ""}
    </Badge>
  );
}
