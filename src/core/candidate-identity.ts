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

export const NAME_MAX = 120;
export const HEADLINE_MAX = 200;
export const LOCATION_MAX = 120;
/** O mesmo mínimo de `saveCvAction`: abaixo disso não é um currículo. */
export const CV_MIN = 100;

export type OwnProfileError =
  | "nameRequired"
  | "nameTooLong"
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
  const name = optional(raw.name);
  if (name === null) return { ok: false, code: "nameRequired" };
  if (name.length > NAME_MAX) return { ok: false, code: "nameTooLong" };

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
  "vocabulary",
]);

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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Deixa espaço para o sufixo de colisão sem estourar o teto.
  const cut = ascii.slice(0, SLUG_MAX - 4).replace(/-+$/g, "");
  if (cut.length < SLUG_MIN) return FALLBACK_BASE;
  if (RESERVED_SLUGS.has(cut)) return `${cut}-${FALLBACK_BASE}`;
  return cut;
}

/** A n-ésima tentativa: `base`, `base-2`, `base-3`… */
export function slugAttempt(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
