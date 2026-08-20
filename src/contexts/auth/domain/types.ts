/**
 * Authentication and authorisation — domain types.
 *
 * Nothing here touches a database, a cookie or a clock. That is the point: the
 * permission decision is the part where a bug is a breach, and it is the part
 * that can be tested exhaustively for free.
 */

/**
 * Os três papéis.
 *
 * `owner` virou `candidate` — o nome antigo descrevia a relação com a
 * instalação ("o dono disto"), e não o que a pessoa é no domínio. Com três
 * papéis e várias contas, "dono" deixa de significar alguma coisa.
 */
export const ROLES = ["admin", "candidate", "recruiter"] as const;
export type Role = (typeof ROLES)[number];

export type Session = {
  userId: number;
  /** The candidate this session may act for. Null for an admin-only account. */
  candidateId: number | null;
  roles: Role[];
  email: string;
  expiresAt: string;
  /**
   * Candidatos que este recrutador acompanha, resolvidos do banco na carga da
   * sessão.
   *
   * Vive na sessão, e não num argumento, pelo mesmo motivo de `candidateId`: a
   * regra do arquivo ao lado é que posse se deriva da sessão e nunca do que o
   * chamador afirma. Um recrutador que passasse `candidateId` na requisição
   * estaria declarando o que quer, não provando que pode.
   */
  linkedCandidateIds: number[];
  /**
   * O admin que assumiu esta identidade, quando é o caso.
   *
   * Presente = a sessão é emprestada. É o que permite negar poder de admin
   * dentro dela sem depender dos papéis do alvo — ver o caso admin-assume-admin
   * em `policy.ts`.
   */
  impersonatedBy: number | null;
};

/**
 * Every action the system can gate.
 *
 * An explicit union rather than free strings: a typo in `"canditate:read"`
 * would silently deny — or worse, a permissive default would silently allow.
 */
export const ACTIONS = [
  "job:read",
  "job:write",
  "application:write",
  "candidate:read",
  "candidate:write",
  "skill:audit",
  "provider:manage",
  "admin:access",
  "user:manage",
  "user:impersonate",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Ações que só existem para administrar a instalação.
 *
 * Listadas separadamente porque a sessão emprestada as nega **em bloco**, sem
 * consultar papel: o alvo da impersonação pode ser outro admin.
 */
export const ADMIN_ACTIONS: readonly Action[] = [
  "admin:access",
  "user:manage",
  "user:impersonate",
  "provider:manage",
  "skill:audit",
];

/**
 * Quem alcança um perfil de candidato.
 *
 * `private` é o padrão em todo lugar — schema, tipo e este comentário — porque
 * `public` significa currículo legível pela internet sem sessão nenhuma.
 */
export const VISIBILITIES = ["private", "recruiters", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

/** What the action is being performed on. */
export type Resource =
  | { kind: "global" }
  | {
      kind: "candidate";
      candidateId: number;
      /**
       * Visibilidade do perfil, **carregada do banco** pelo chamador.
       *
       * Opcional e com padrão `private` de propósito: quem esquecer de carregar
       * recebe negativa, não permissão. O contrário — padrão `public` ou campo
       * obrigatório que alguém preenche com um literal — transforma esquecimento
       * em vazamento.
       *
       * Note que isto não fere a regra de "posse vem da sessão": visibilidade é
       * propriedade do RECURSO, não afirmação sobre quem o chamador é.
       */
      visibility?: Visibility;
    };

export type Decision = { allowed: true } | { allowed: false; reason: string };

export const ALLOW: Decision = { allowed: true };
export function deny(reason: string): Decision {
  return { allowed: false, reason };
}
