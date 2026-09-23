/**
 * Identidade de um candidato criado pela própria conta — regras puras.
 *
 * O candidato do dono nasce do `profile/profile.yaml` (`syncCandidateFromProfile`).
 * Todo outro candidato nasce do que a própria pessoa escreveu na tela, e nada
 * aqui lê o `profile.yaml`: herdar a identidade do dono foi exatamente a forma
 * do incidente de 22/09/2026, quando uma conta de seed enxergava o currículo
 * dele.
 *
 * Sem banco, sem rede, sem relógio. Quem grava é `createOwnCandidate`.
 */
import { containsContact } from "./public-cv.ts";

export const NAME_MAX = 120;
export const HEADLINE_MAX = 200;
export const LOCATION_MAX = 120;
/** O mesmo mínimo de `saveCvAction`: abaixo disso não é um currículo. */
export const CV_MIN = 100;

export type OwnProfileError =
  | NameError
  | "headlineTooLong"
  | "locationTooLong"
  | "cvTooShort";

export type OwnProfile = {
  name: string;
  headline: string | null;
  location: string | null;
  /** Opcional. `null` quando a pessoa deixou o campo vazio. */
  cv: string | null;
};

/** Espaço em volta some; vazio vira `null` — a mesma regra de `normalizarNome`. */
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export type NameError = "nameRequired" | "nameTooLong" | "nameContact";

/**
 * O nome do candidato, que é o título de `/p/<endereço>`.
 *
 * Recusa e-mail e telefone: o nome é campo publicável, e um endereço digitado
 * ali sairia na página aberta. `publicProfile()` confere de novo na saída —
 * esta recusa é a que explica à pessoa o que mudar; aquela é a que vale para
 * dado gravado por qualquer outro caminho.
 */
export function parsePublicName(
  raw: string | null | undefined,
): { ok: true; name: string } | { ok: false; code: NameError } {
  const name = optional(raw);
  if (name === null) return { ok: false, code: "nameRequired" };
  if (name.length > NAME_MAX) return { ok: false, code: "nameTooLong" };
  if (containsContact(name)) return { ok: false, code: "nameContact" };
  return { ok: true, name };
}

/**
 * O nome com que o candidato de uma conta NASCE, quando a conta não passou por
 * formulário nenhum (`jho auth add-user`).
 *
 * O nome de exibição da conta, se existir e for publicável; senão, vazio — e
 * `/candidate` pede o nome. Nunca o e-mail: foi o que a 1.22.0 fazia, e o
 * e-mail saía como título do perfil público.
 */
export function initialCandidateName(fullName: string | null | undefined): string {
  const parsed = parsePublicName(fullName);
  return parsed.ok ? parsed.name : "";
}

/**
 * Valida o formulário de "Criar meu perfil".
 *
 * Teto em todo campo livre: texto sem limite é o jeito mais fácil de encher a
 * tabela. Recusa em vez de truncar, porque truncar um nome grava algo que a
 * pessoa não escreveu.
 */
export function parseOwnProfile(raw: {
  name?: string | null;
  headline?: string | null;
  location?: string | null;
  cv?: string | null;
}): { ok: true; value: OwnProfile } | { ok: false; code: OwnProfileError } {
  const parsedName = parsePublicName(raw.name);
  if (!parsedName.ok) return parsedName;
  const name = parsedName.name;

  const headline = optional(raw.headline);
  if (headline !== null && headline.length > HEADLINE_MAX) return { ok: false, code: "headlineTooLong" };

  const location = optional(raw.location);
  if (location !== null && location.length > LOCATION_MAX) return { ok: false, code: "locationTooLong" };

  const cv = optional(raw.cv);
  if (cv !== null && cv.length < CV_MIN) return { ok: false, code: "cvTooShort" };

  return { ok: true, value: { name, headline, location, cv } };
}

/* -------------------------------------------------------------------------- */
/* Slug                                                                        */
/* -------------------------------------------------------------------------- */

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/**
 * Slugs que nenhum candidato criado pela tela recebe.
 *
 * `default` é o do dono: um candidato novo com esse slug seria lido por
 * `getCandidate()` como se fosse ele. Os demais são nomes de rota e palavras
 * que, num endereço `/p/<slug>`, se passariam pelo sistema.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "default",
  "account",
  "admin",
  "api",
  "app",
  "candidate",
  "compare",
  "jobs",
  "login",
  "logout",
  "me",
  "new",
  "p",
  "pipeline",
  "recruiter",
  "referrals",
  "root",
  "searches",
  "settings",
  "skills",
  "support",
  "system",
  "transition-test",
  "vocabulary",
]);

/**
 * Prefixos de slug que outros caminhos criam e REAPROVEITAM pelo slug.
 *
 * `createUserAction` e o setup do e2e montam `user-<e-mail>` / `e2e-<e-mail>` e
 * chamam `ensureCandidate`, que devolve a linha existente com aquele slug. Se
 * alguém chamado "User Maria X Com" ocupasse `user-maria-x-com` antes, a conta
 * que o admin criasse depois para `maria@x.com` seria ligada ao candidato
 * dele — leitura de CV alheio por procuração.
 */
export const RESERVED_PREFIXES: readonly string[] = ["user-", "e2e-"];

/** Espaço deixado no teto para o sufixo de colisão (`-50`, ou um aleatório curto). */
const SUFFIX_ROOM = 8;

/** Quando o nome não rende letra nenhuma aproveitável (só símbolos, escrita não latina). */
const FALLBACK_BASE = "perfil";

/**
 * O endereço derivado do nome: minúsculas, dígitos e hífen.
 *
 * Acento sai pela decomposição (`São` → `sao`), e o resto vira hífen. Não é
 * identidade nem prova de nada — a unicidade é do banco, e colisão ganha
 * sufixo em `slugAttempt`.
 */
export function slugBaseFromName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = ascii.slice(0, SLUG_MAX - SUFFIX_ROOM).replace(/-+$/g, "");
  if (cut.length < SLUG_MIN) return FALLBACK_BASE;
  if (RESERVED_SLUGS.has(cut) || RESERVED_PREFIXES.some((prefix) => cut.startsWith(prefix))) {
    return `${FALLBACK_BASE}-${cut}`.slice(0, SLUG_MAX - SUFFIX_ROOM).replace(/-+$/g, "");
  }
  return cut;
}

/** A n-ésima tentativa: `base`, `base-2`, `base-3`… */
export function slugAttempt(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

/* -------------------------------------------------------------------------- */
/* Endereço público escolhido (#235)                                           */
/* -------------------------------------------------------------------------- */

export type PublicSlugError = "slugInvalid" | "slugTooShort" | "slugTooLong" | "slugReserved";

const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Valida o endereço público que a própria pessoa digitou.
 *
 * Minúsculas, dígitos e hífen entre eles — nada de acento, espaço, ponto ou
 * barra, que numa URL viram codificação ou caminho. Maiúsculas são aceitas e
 * rebaixadas: `Maria-Souza` e `maria-souza` são o mesmo endereço, e recusar
 * seria atrito sem ganho. Reservado recusa em vez de ganhar prefixo: aqui a
 * pessoa escolheu, e trocar a escolha dela em silêncio seria pior.
 */
export function validatePublicSlug(raw: string): { ok: true; slug: string } | { ok: false; code: PublicSlugError } {
  const slug = raw.trim().toLowerCase();
  if (slug.length < SLUG_MIN) return { ok: false, code: "slugTooShort" };
  if (slug.length > SLUG_MAX) return { ok: false, code: "slugTooLong" };
  if (!PUBLIC_SLUG.test(slug)) return { ok: false, code: "slugInvalid" };
  if (RESERVED_SLUGS.has(slug) || RESERVED_PREFIXES.some((prefix) => slug.startsWith(prefix))) {
    return { ok: false, code: "slugReserved" };
  }
  return { ok: true, slug };
}
