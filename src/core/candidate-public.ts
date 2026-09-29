/**
 * O perfil público, montado por LISTA DE PERMISSÃO.
 *
 * A tentação é buscar o registro do candidato e esconder o que for sensível na
 * hora de renderizar. Isso inverte o default: um campo novo no schema nasce
 * visível, e o vazamento chega por uma migration que ninguém leu sob essa
 * ótica. Aqui os campos que saem estão escritos um a um, e tudo o que não
 * consta simplesmente não existe para esta função — mesma lógica do `private`
 * por padrão da coluna de visibilidade.
 *
 * **Nunca sai daqui, e a ausência é testada:** e-mail, telefone, funil,
 * candidaturas, contatos de rede e piso salarial. O piso é o pior deles — é a
 * posição de negociação do candidato, e publicá-la é mostrar a carta antes da
 * mesa: quem lê passa a saber o mínimo aceitável antes da primeira conversa.
 *
 * O texto do currículo exige um SEGUNDO consentimento (`publicCv`). Marcar o
 * perfil como público diz "alcançável sem sessão"; publicar o currículo inteiro
 * é outra decisão. E o consentimento publica o CURRÍCULO, não o que nunca sai:
 * o texto passa por `publicCvText()`, que retira e-mail, telefone e a frase do
 * piso salarial escritos nele — com os limites de detecção declarados lá.
 *
 * **A lista de permissão escolhe COLUNAS; o valor também é conferido.** Na
 * 1.22.0 a conta criada por `jho auth add-user` ganhava o próprio e-mail como
 * nome do candidato, e o nome é uma coluna permitida: `/p/<endereço>` publicava
 * o e-mail no título. A correção na origem não basta, porque a coluna aceita
 * qualquer texto — um nome digitado, um `profile.yaml`, uma migration futura.
 * Então todo campo de texto que sai passa por `containsContact()` e, se trouxer
 * e-mail ou telefone, sai VAZIO, independentemente de como o dado chegou lá.
 *
 * **Fatos opt-in (#327)** — modelo de trabalho, nível, disponibilidade, prazo,
 * aceita mudar, área, idiomas — entram numa chave só, `facts`, e cada um
 * depende do PRÓPRIO consentimento, desligado por padrão. O filtro mora em
 * `publicFactsFrom()` (puro): valor controlado desconhecido não sai, e texto
 * livre com contato ou pretensão salarial sai vazio.
 *
 * **Foto e capa (#327)** também dependem do próprio opt-in, e a CHAVE do
 * objeto nunca sai daqui: o perfil recebe só uma versão opaca (hash da
 * chave) para a URL `/p/<endereço>/image/<tipo>?v=…`, e a rota que serve os
 * bytes pergunta de novo, a cada requisição, por `publicImageKeyForSlug()` —
 * perfil que deixou de ser público responde 404 também pela URL antiga.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { authUser, candidate, candidateDocument, candidateSkill, skill } from "./db/schema.ts";
import { publicFactsFrom, type PublicFacts } from "./candidate-public-facts.ts";
import { publicImageKeyFrom, type PublicImageKind } from "./public-images.ts";
import { containsContact, publicCvMarkdown, type KnownContact } from "./public-cv.ts";

/**
 * Uma skill confirmada, como o perfil público mostra (#326).
 *
 * `category` e `level` entram na lista de permissão EXPLICITAMENTE: o schema
 * já os tinha antes desta função os expor, e a tentação seria "já que a linha
 * inteira é de uma skill confirmada, tanto faz mostrar tudo". `level` é
 * digitado por um humano (nunca inferido — mesmo comentário no schema) e por
 * isso passa pelo mesmo `containsContact()` do nome; `category` vem do
 * catálogo, mas nada aqui assume que só o catálogo escreve a coluna.
 */
export type PublicSkill = {
  name: string;
  category: string;
  /** Só quem confirma escreve; a maioria fica sem. */
  level: string | null;
  /** Vezes que a skill aparece no documento fonte — usada para ordenar, nunca mostrada como métrica. */
  occurrences: number;
};

/** Uma categoria com as skills que sobraram nela, já na ordem de exibição. */
export type PublicSkillGroup = {
  category: string;
  skills: PublicSkill[];
};

export type PublicProfile = {
  slug: string;
  /** Vazio quando a pessoa ainda não escolheu um nome publicável. */
  name: string;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  /** Só as confirmadas. Detectada não é confirmada — regra 6 do CLAUDE.md. */
  skills: PublicSkill[];
  /**
   * Fatos opt-in (#327): cada um só vem preenchido quando a pessoa marcou
   * "mostrar" para ele; o resto vem `null`/vazio. Ver `publicFactsFrom()`.
   */
  facts: PublicFacts;
  /**
   * Foto e capa com opt-in (#327): versão opaca para a URL, ou `null`. Nunca
   * a chave do objeto nem URL de provedor.
   */
  images: Record<PublicImageKind, string | null>;
  /** Presente apenas quando o candidato deu o segundo consentimento. */
  cv: string | null;
};

/**
 * Agrupa por categoria, em ordem determinística — puro, sem banco nem
 * relógio, e testável sem `publicProfile()`.
 *
 * **Categoria em ordem alfabética da CHAVE**, não do rótulo traduzido: um
 * rótulo muda de idioma e mudaria a ordem junto, e a mesma pessoa vendo o
 * perfil em português e em inglês veria as categorias trocarem de lugar.
 *
 * **Dentro do grupo, ocorrências decrescente e depois nome crescente.** A
 * skill que mais aparece no currículo abre o grupo; empate se desfaz pelo
 * nome, nunca pela ordem de inserção do banco — que não é estável entre
 * execuções.
 */
export function groupPublicSkills(skills: readonly PublicSkill[]): PublicSkillGroup[] {
  const byCategory = new Map<string, PublicSkill[]>();
  for (const item of skills) {
    const group = byCategory.get(item.category);
    if (group) group.push(item);
    else byCategory.set(item.category, [item]);
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      skills: [...items].sort(
        (a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name),
      ),
    }));
}

/**
 * Devolve o perfil, ou `null` quando ele não é público.
 *
 * `null` e não um erro distinguível: 403 confirmaria que o slug existe, e
 * existência é informação. A instalação já se comporta assim onde importa —
 * `magicLink.complete()` devolve null tanto para token inválido quanto para
 * endereço desconhecido, e quem chama não distingue os dois.
 */
export async function publicProfile(slug: string): Promise<PublicProfile | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: candidate.id,
      name: candidate.name,
      headline: candidate.headline,
      location: candidate.location,
      linkedinUrl: candidate.linkedinUrl,
      githubUrl: candidate.githubUrl,
      visibility: candidate.visibility,
      publicCv: candidate.publicCv,
      // #327: valor e opt-in de cada fato, coluna a coluna. Lidos aqui, mas
      // só saem pelo filtro de `publicFactsFrom()`.
      workModel: candidate.workModel,
      experienceLevel: candidate.experienceLevel,
      availability: candidate.availability,
      startTimeframe: candidate.startTimeframe,
      openToRelocation: candidate.openToRelocation,
      area: candidate.area,
      languages: candidate.languages,
      publicWorkModel: candidate.publicWorkModel,
      publicExperienceLevel: candidate.publicExperienceLevel,
      publicAvailability: candidate.publicAvailability,
      publicStartTimeframe: candidate.publicStartTimeframe,
      publicRelocation: candidate.publicRelocation,
      publicArea: candidate.publicArea,
      publicLanguages: candidate.publicLanguages,
      // #327: chave e opt-in de cada imagem. A chave vira só uma versão opaca.
      photoKey: candidate.photoKey,
      coverKey: candidate.coverKey,
      publicPhoto: candidate.publicPhoto,
      publicCover: candidate.publicCover,
      // Lidos para serem RETIRADOS do que sai, nunca devolvidos. O da conta
      // importa porque o candidato criado pela CLI não tem `email` próprio.
      email: candidate.email,
      accountEmail: authUser.email,
    })
    .from(candidate)
    .leftJoin(authUser, eq(authUser.candidateId, candidate.id))
    // O endereço público, nunca o identificador interno: quem trocou de
    // endereço não pode continuar alcançável pelo antigo nem pelo `slug`.
    .where(eq(candidate.publicSlug, slug))
    .limit(1);

  // A checagem acontece AQUI, e não na página. Uma função que devolvesse o
  // perfil e deixasse a decisão para quem renderiza seria usada errado no
  // segundo lugar que a chamasse.
  if (!row || row.visibility !== "public") return null;
  const known: KnownContact = { emails: [row.email, row.accountEmail] };
  const text = (value: string | null): string | null =>
    value === null || containsContact(value, known) ? null : value;

  const skillRows = await db
    .select({
      name: skill.canonicalName,
      category: skill.category,
      level: candidateSkill.level,
      occurrences: candidateSkill.occurrences,
    })
    .from(candidateSkill)
    .innerJoin(skill, eq(skill.id, candidateSkill.skillId))
    .where(and(eq(candidateSkill.candidateId, row.id), eq(candidateSkill.status, "confirmed")));

  // `level` é escrito por um humano (comentário no schema), então passa pelo
  // mesmo filtro do nome — não pela lista de permissão de COLUNA, que já
  // decidiu que a coluna existe, mas pelo mesmo `containsContact()` que
  // esvazia nome, headline e localização. Uma skill com contato no nome ou no
  // nível some inteira: não há forma curta de "esvaziar só o pedaço".
  const skills: PublicSkill[] = skillRows
    .filter(
      (s) =>
        !containsContact(s.name, known)
        && !containsContact(s.category, known)
        && (s.level === null || !containsContact(s.level, known)),
    )
    .map((s) => ({ name: s.name, category: s.category, level: s.level, occurrences: s.occurrences }));

  let cv: string | null = null;
  if (row.publicCv) {
    const [doc] = await db
      .select({ content: candidateDocument.content })
      .from(candidateDocument)
      .where(
        and(
          eq(candidateDocument.candidateId, row.id),
          eq(candidateDocument.kind, "cv"),
          eq(candidateDocument.isCurrent, true),
        ),
      )
      .limit(1);
    cv = doc ? publicCvMarkdown(doc.content, known) : null;
  }

  return {
    slug,
    name: text(row.name.trim()) ?? "",
    headline: text(row.headline),
    location: text(row.location),
    linkedinUrl: text(row.linkedinUrl),
    githubUrl: text(row.githubUrl),
    skills,
    facts: publicFactsFrom(row, known),
    images: {
      photo: imageVersion(publicImageKeyFrom(row, "photo")),
      cover: imageVersion(publicImageKeyFrom(row, "cover")),
    },
    cv,
  };
}

/**
 * Versão da imagem para a URL: muda quando a chave muda (cada envio tem chave
 * nova), então o navegador não mostra a foto antiga depois da troca. Hash,
 * para a chave — que carrega o id interno do candidato — não sair.
 */
export function imageVersion(key: string | null): string | null {
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : null;
}

/**
 * A chave que a rota pública pode servir, ou `null` — perfil inexistente,
 * não público, com endereço trocado, sem opt-in ou sem imagem. Uma resposta
 * só para todos os casos: a rota devolve o mesmo 404 (G22).
 *
 * Consulta própria e mínima, e não `publicProfile()`: a rota da imagem não
 * precisa montar skills e currículo para decidir, e a decisão é a mesma —
 * `public_slug` (nunca o `slug` interno), `visibility = public`, opt-in.
 */
export async function publicImageKeyForSlug(slug: string, kind: PublicImageKind): Promise<string | null> {
  const [row] = await getDb()
    .select({
      visibility: candidate.visibility,
      photoKey: candidate.photoKey,
      coverKey: candidate.coverKey,
      publicPhoto: candidate.publicPhoto,
      publicCover: candidate.publicCover,
    })
    .from(candidate)
    .where(eq(candidate.publicSlug, slug))
    .limit(1);
  if (!row || row.visibility !== "public") return null;
  return publicImageKeyFrom(row, kind);
}
