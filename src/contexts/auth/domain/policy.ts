/**
 * The permission decision, as a pure function.
 *
 * `can(session, action, resource)` is the only place that decides. Everything
 * else — Proxy, Server Actions, CLI — asks it. That concentration is
 * deliberate: authorisation bugs come from a check that exists in four places
 * and disagrees with itself in one.
 *
 * Two rules run underneath every case:
 *
 *  1. **Deny by default.** An unknown action, an expired session or a missing
 *     role is a denial, never a fall-through. There is no `default: return
 *     ALLOW` anywhere in this file, and there must never be.
 *
 *  2. **Ownership is checked against the session, never against an argument.**
 *     A caller passing `candidateId` is stating what it wants, not proving it
 *     may. This is the single most common way multi-tenant systems leak: the
 *     UI filters correctly, and a hand-made request with someone else's id
 *     walks straight through.
 *
 *  3. **Sessão emprestada não administra.** Um admin pode assumir a identidade
 *     de qualquer usuário, e é assim — e só assim — que ele alcança dado
 *     privado alheio. Enquanto está emprestada, a sessão perde TODA ação de
 *     administração, em bloco.
 *
 *     O bloco importa por um caso específico: **admin assumindo outro admin**.
 *     Se a negativa dependesse dos papéis do alvo, essa sessão teria papel
 *     `admin` e passaria — e o primeiro admin operaria a instalação com a cara
 *     do segundo, sem nada no registro que os separe. Por isso a checagem é
 *     `impersonatedBy !== null`, antes de olhar papel nenhum.
 */
import {
  ADMIN_ACTIONS,
  ALLOW,
  deny,
  type Action,
  type Decision,
  type Resource,
  type Role,
  type Session,
  type Visibility,
} from "./types.ts";

export function isExpired(session: Session, now: number): boolean {
  const expiry = Date.parse(session.expiresAt);
  // An unparseable expiry is treated as expired: a session whose lifetime
  // cannot be established is not a session to trust.
  return Number.isNaN(expiry) || expiry <= now;
}

export function hasRole(session: Session, role: Role): boolean {
  return session.roles.includes(role);
}

export function can(
  session: Session | null,
  action: Action,
  resource: Resource = { kind: "global" },
  now: number = Date.now(),
): Decision {
  if (!session) return deny("sem sessão");
  if (isExpired(session, now)) return deny("sessão expirada");

  const isAdmin = hasRole(session, "admin");
  const isCandidate = hasRole(session, "candidate");
  const isRecruiter = hasRole(session, "recruiter");
  const borrowed = session.impersonatedBy !== null;

  // Antes de qualquer papel: sessão emprestada não administra. Ver regra 3.
  if (borrowed && ADMIN_ACTIONS.includes(action)) {
    return deny("sessão emprestada não executa ação de administração");
  }

  // Posse do recurso, derivada da sessão e de nada mais.
  const ownsCandidate =
    resource.kind === "candidate" &&
    session.candidateId !== null &&
    session.candidateId === resource.candidateId;

  // O vínculo do recrutador também vem da sessão, resolvido na carga.
  const followsCandidate =
    resource.kind === "candidate" && session.linkedCandidateIds.includes(resource.candidateId);

  switch (action) {
    case "admin:access":
    case "user:manage":
    case "user:impersonate":
    case "skill:audit":
    case "provider:manage":
      return isAdmin ? ALLOW : deny("requer papel admin");

    case "job:read":
      // O acervo é global, não por candidato: os três papéis leem.
      return isAdmin || isCandidate || isRecruiter ? ALLOW : deny("requer sessão válida");

    case "job:write":
      // Candidato acrescenta a vaga que está considerando; recrutador cadastra
      // a que está oferecendo; admin cura o catálogo. A origem de cada uma fica
      // registrada na `source`, para a tela poder dizer de onde veio.
      return isAdmin || isCandidate || isRecruiter ? ALLOW : deny("requer sessão válida");

    case "candidate:write":
    case "application:write":
      // Escrita em dado de candidato é só de quem é aquele candidato. Um
      // recrutador acompanha, não edita o currículo nem move o funil alheio —
      // o funil é a única coisa aqui que registra decisão de uma pessoa.
      if (!isCandidate) return deny("requer papel candidate");
      if (resource.kind !== "candidate") return deny("requer escopo de candidato");
      if (!ownsCandidate) return deny("recurso de outro candidato");
      return ALLOW;

    case "candidate:read":
      // Um recurso global nunca é atalho para dado privado: todo chamador
      // precisa provar o escopo de candidato que derivou da sessão.
      if (resource.kind !== "candidate") return deny("requer escopo de candidato");
      if (isCandidate && ownsCandidate) return ALLOW;
      // O recrutador lê quem ele acompanha, independente de visibilidade.
      if (isRecruiter && followsCandidate) return ALLOW;
      // Perfil aberto a recrutadores: qualquer recrutador AUTENTICADO.
      if (isRecruiter && resource.visibility === "recruiters") return ALLOW;
      // Perfil público é portfólio: alcança qualquer sessão. O caso sem sessão
      // nenhuma é decidido antes, no topo desta função.
      if (resource.visibility === "public") return ALLOW;
      // Admin NÃO cai aqui de propósito. Ele administra a instalação; para ver
      // dado privado precisa assumir a identidade, e assumir deixa registro.
      return deny("recurso de outro candidato");

    default:
      // Exhaustive in practice; a new action lands here until it is decided.
      return deny(`ação não reconhecida: ${String(action)}`);
  }
}

/**
 * O único caminho de leitura sem sessão.
 *
 * Separado de `can()` de propósito. `can()` começa negando quem não tem sessão,
 * e é assim que deve continuar — afrouxar aquela primeira linha para acomodar
 * portfólio abriria um buraco em todas as outras ações de uma vez.
 *
 * Aqui a permissão não vem de quem pede: vem do candidato ter marcado o perfil
 * como `public`. Ninguém anônimo alcança `recruiters` nem `private`.
 */
export function canReadPublicProfile(visibility: Visibility | undefined): Decision {
  return visibility === "public" ? ALLOW : deny("perfil não é público");
}

/** Throws unless allowed. For call sites where a denial is exceptional. */
export function authorize(
  session: Session | null,
  action: Action,
  resource: Resource = { kind: "global" },
  now: number = Date.now(),
): void {
  const decision = can(session, action, resource, now);
  if (!decision.allowed) {
    throw new AuthorizationError(action, decision.reason);
  }
}

export class AuthorizationError extends Error {
  readonly action: string;
  constructor(action: string, reason: string) {
    super(`negado: ${action} — ${reason}`);
    this.name = "AuthorizationError";
    this.action = action;
  }
}

/**
 * The candidate a session may act for.
 *
 * Call sites take the scope from here instead of accepting one, which is what
 * makes "filter by candidate" impossible to forget or forge.
 */
export function candidateScope(session: Session | null): number | null {
  return session?.candidateId ?? null;
}
