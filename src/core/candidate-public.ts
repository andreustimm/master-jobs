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
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { authUser, candidate, candidateDocument, candidateSkill, skill } from "./db/schema.ts";
import { containsContact, publicCvText, type KnownContact } from "./public-cv.ts";

export type PublicProfile = {
  slug: string;
  /** Vazio quando a pessoa ainda não escolheu um nome publicável. */
  name: string;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  /** Só as confirmadas. Detectada não é confirmada — regra 6 do CLAUDE.md. */
  skills: string[];
  /** Presente apenas quando o candidato deu o segundo consentimento. */
  cv: string | null;
};

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

  const skills = await db
    .select({ name: skill.canonicalName })
    .from(candidateSkill)
    .innerJoin(skill, eq(skill.id, candidateSkill.skillId))
    .where(and(eq(candidateSkill.candidateId, row.id), eq(candidateSkill.status, "confirmed")));

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
    cv = doc ? publicCvText(doc.content, known) : null;
  }

  return {
    slug,
    name: text(row.name.trim()) ?? "",
    headline: text(row.headline),
    location: text(row.location),
    linkedinUrl: text(row.linkedinUrl),
    githubUrl: text(row.githubUrl),
    skills: skills.map((s) => s.name),
    cv,
  };
}
