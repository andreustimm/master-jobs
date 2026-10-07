/**
 * Ports for the auth context.
 *
 * Two, because two absorb variation that is real:
 *
 *  - `SessionStore` — a table today. It becomes Redis the moment there is more
 *    than one process, which is the same reasoning as ADR 0009.
 *  - `IdentityProvider` — magic link today; OAuth or SSO later. The domain must
 *    not learn which.
 *
 * There is deliberately no port for hashing or for the clock: hashing has one
 * correct implementation and the clock already has `src/core/clock.ts`.
 */
import type { Role, Session } from "./domain/types.ts";
import type { OidcProviderId } from "./domain/oidc-config.ts";

export type { OidcProviderId };

/**
 * O que o fluxo OIDC precisa lembrar entre o início e o retorno (#464).
 *
 * Vive só no cookie cifrado do fluxo (`infra/flow-cookie.ts`), por 10 minutos.
 * `codeVerifier` é o segredo do PKCE: quem o tivesse trocaria o código do
 * retorno por um token — por isso o cookie é cifrado, e não só assinado.
 */
export type OidcFlowState = {
  provider: OidcProviderId;
  state: string;
  nonce: string;
  codeVerifier: string;
  intent: "signin" | "link";
  /** Já passado por `safeNext` no início; conferido de novo no retorno. */
  next: string | null;
  /** ISO 8601. A validade de 10 minutos conta a partir daqui. */
  createdAt: string;
};

/**
 * O que sai de um provedor OIDC depois de validado o ID token (ADR-008).
 *
 * Só isto, e de propósito (ADR-003, regra 1): o par `(provider, subject)` é a
 * identidade; o e-mail e a afirmação de verificação servem só para o vínculo
 * automático (ADR-001). Nome, foto, título, URL de perfil e os tokens do
 * provedor nunca saem do adapter — não há campo onde caberiam.
 */
export type VerifiedIdentity = {
  provider: OidcProviderId;
  subject: string;
  /** Normalizado; `null` quando o provedor não mandou e-mail. */
  email: string | null;
  /** `true` só quando o provedor afirma, no token, que verificou o e-mail. */
  emailVerified: boolean;
};

export type OidcStart = { url: string; flow: OidcFlowState };

/**
 * Por que o retorno do provedor não virou identidade.
 *
 * - `cancelled`: a pessoa recusou no consentimento (`access_denied`);
 * - `provider_error`: o provedor respondeu erro ou não respondeu (descoberta,
 *   token, JWKS) — "não conseguimos falar com o Google";
 * - `invalid_response`: respondeu, mas o ID token não passou na validação
 *   (assinatura, `iss`, `aud`, `exp`, `nonce`).
 */
export type OidcFailure = "cancelled" | "provider_error" | "invalid_response";

export type OidcCompletion = { ok: true; identity: VerifiedIdentity } | { ok: false; reason: OidcFailure };

/**
 * Porta do login social (ADR-008): Google e LinkedIn diferem só em emissor,
 * escopos e leitura das afirmações; o resto do contexto não sabe qual.
 */
export type OidcProvider = {
  readonly id: OidcProviderId;
  /** URL de autorização com PKCE S256, `state` e `nonce`, e o estado a guardar no cookie. */
  start(input: { redirectUri: string; intent: OidcFlowState["intent"]; next: string | null }): Promise<OidcStart>;
  /** Troca o código e valida o ID token. Erro de provedor é valor, nunca exceção. */
  complete(input: { redirectUri: string; callbackUrl: URL; flow: OidcFlowState }): Promise<OidcCompletion>;
};

export type NewSession = {
  userId: number;
  expiresAt: string;
  /** Preenchido só quando um admin assume a identidade de alguém. */
  impersonatedBy?: number | null;
};

export type SessionStore = {
  /** Returns the raw token exactly once; only its hash is persisted. */
  create(input: NewSession): Promise<string>;
  /** Resolves a raw token to a session, or null when absent/expired/revoked. */
  resolve(token: string): Promise<Session | null>;
  revoke(token: string): Promise<void>;
  revokeAllFor(userId: number): Promise<number>;
  /** Housekeeping; expired rows are proof of nothing. */
  purgeExpired(): Promise<number>;
};

export type Identity = {
  userId: number;
  email: string;
  /** Nome de quem usa a conta. Nulo enquanto ninguém preencheu. */
  fullName: string | null;
  roles: Role[];
  candidateId: number | null;
  /** Candidatos que este recrutador acompanha. Vazio para os outros papéis. */
  linkedCandidateIds: number[];
};

export type IdentityProvider = {
  readonly name: string;
  /** Starts a login. Returns whatever the caller must deliver to the user. */
  begin(email: string): Promise<{ token: string; expiresAt: string }>;
  /** Completes a login, or null when the token is invalid, used or expired. */
  complete(token: string): Promise<Identity | null>;
};

export type AuthAuditInput = {
  kind: string;
  userId?: number | null;
  email?: string | null;
  detail?: string;
};

export type AuthRepository = {
  record(input: AuthAuditInput): Promise<void>;
  findUserId(email: string): Promise<number | null>;
};

/** Resumo de uma conta, para a tela de administração. */
export type UserSummary = {
  id: number;
  email: string;
  /** Nome de quem usa a conta. Nulo enquanto ninguém preencheu. */
  fullName: string | null;
  roles: Role[];
  candidateId: number | null;
  disabledAt: string | null;
  createdAt: string;
  hasPassword: boolean;
};

/**
 * Gestão de contas.
 *
 * Porta separada de `IdentityProvider` porque responde outra pergunta: aquele
 * autentica, este administra. Juntá-los faria o provedor de login carregar
 * escrita de conta, que é justamente o que não se quer perto de um caminho de
 * autenticação.
 */
export type UserDirectory = {
  list(): Promise<UserSummary[]>;
  find(userId: number): Promise<UserSummary | null>;
  create(input: {
    email: string;
    fullName?: string | null;
    roles: Role[];
    candidateId?: number | null;
  }): Promise<{ id: number }>;
  updateRoles(userId: number, roles: Role[]): Promise<void>;
  /**
   * Edita os dados da conta.
   *
   * Campo ausente significa "não mexe", e é por isso que cada um é opcional em
   * vez de a tela mandar o registro inteiro: mandar tudo faz duas edições
   * simultâneas se sobrescreverem em silêncio, e aqui a edição vem de um admin
   * que pode ter aberto a modal antes da última alteração.
   *
   * `fullName: null` é diferente de ausente — é a pessoa apagando o nome.
   */
  update(
    userId: number,
    patch: { email?: string; fullName?: string | null; roles?: Role[] },
  ): Promise<void>;
  setDisabled(userId: number, disabled: boolean): Promise<void>;
  /**
   * Apaga a conta.
   *
   * Irreversível, e diferente de desabilitar: desabilitar preserva o histórico
   * e permite voltar atrás. O que sobrevive à exclusão é decidido pelas chaves
   * estrangeiras, e cada escolha é deliberada — sessão e token de login caem em
   * cascata (não podem valer para conta que não existe), enquanto `auth_event`
   * e a atribuição de vaga viram nulo, porque auditoria e vaga são fato
   * ocorrido e não deixam de ter ocorrido. O candidato NÃO é apagado: conta e
   * candidato são coisas distintas, e apagar o currículo de alguém por causa
   * de uma conta removida seria dano colateral silencioso.
   *
   * As concessões ativas de recrutador da conta terminam como
   * `ended_account_removed`, com histórico, na mesma transação (#465).
   */
  remove(userId: number): Promise<void>;
  /** Candidatos que um recrutador acessa agora — o mesmo predicado da sessão. */
  linkedCandidates(recruiterUserId: number): Promise<number[]>;
  /** Concessões que valem agora, com o id, para a tela revogá-las sem citar o candidato. */
  linksOf(recruiterUserId: number): Promise<{ id: number; candidateId: number }[]>;
  /**
   * Grava concessão ativa com evento `system`. Só para fixture.
   *
   * `candidateId` vem de quem CONSENTE, nunca do admin: ver a nota em
   * `drizzle-directory.ts` sobre por que admin não concede.
   */
  linkCandidate(recruiterUserId: number, candidateId: number, by: number): Promise<void>;
  /**
   * O administrador `by` revoga uma concessão pelo id: UPDATE condicional com
   * histórico, nunca DELETE (ADR-008, ADR-012).
   */
  revokeGrant(
    grantId: number,
    by: number,
  ): Promise<{ ok: true } | { ok: false; error: "already_ended" | "not_found" }>;
};

export type PasswordResult =
  | { ok: true; identity: Identity }
  /**
   * `unavailable`: o verificador não rodou — falha de recurso, não
   * veredito sobre a senha. Ver `KdfIndisponivelError`.
   */
  | { ok: false; reason: "invalid" | "rate_limited" | "unavailable" };

export type PasswordVerifier = {
  verify(email: string, password: string): Promise<PasswordResult>;
};
