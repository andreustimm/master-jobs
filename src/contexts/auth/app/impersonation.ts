/**
 * Assumir a identidade de outra pessoa.
 *
 * É o **único** caminho pelo qual um admin alcança dado privado de um
 * candidato. A política nega leitura direta de propósito (ver `policy.ts`), e a
 * razão de existir esta porta em vez de simplesmente afrouxar aquela regra é
 * que aqui todo acesso deixa rastro: quem assumiu, de quem, quando, e quando
 * largou.
 *
 * Três defesas, e nenhuma é redundante:
 *
 *  1. **A sessão emprestada perde a administração em bloco.** Não por papel —
 *     por `impersonatedBy !== null`. O alvo pode ser outro admin.
 *  2. **Assumir exige `user:impersonate`**, que só admin tem, e a checagem
 *     acontece contra a sessão de quem pede, antes de qualquer escrita.
 *  3. **Tudo vai para `auth_event`.** Um acesso a currículo alheio que não
 *     aparece em lugar nenhum é indistinguível de um vazamento.
 *
 * Não há impersonação em cadeia: quem já está emprestado não assume ninguém,
 * porque a ação de assumir é de administração e a regra 1 a nega. O teste
 * cobre isso.
 */
import { clock } from "../../../core/clock.ts";
import { authorize } from "../domain/policy.ts";
import type { Session } from "../domain/types.ts";
import type { AuthRepository, SessionStore, UserDirectory } from "../ports.ts";

export const IMPERSONATION_HOURS = 1;

export type ImpersonationDeps = {
  sessions: SessionStore;
  users: UserDirectory;
  audit: AuthRepository;
};

export type StartResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: "not-found" | "disabled" | "self" };

/**
 * Cria uma sessão emprestada para `targetUserId`.
 *
 * Vida curta de propósito: uma hora, contra os trinta dias de uma sessão comum.
 * Assumir identidade é operação de diagnóstico, não um modo de trabalho — e uma
 * credencial de acesso a dado alheio esquecida aberta por um mês é um risco sem
 * contrapartida.
 */
export async function startImpersonation(
  actor: Session | null,
  targetUserId: number,
  deps: ImpersonationDeps,
): Promise<StartResult> {
  // Antes de qualquer efeito, nunca depois: uma ação que valida tarde já
  // escreveu quando decide que não devia.
  authorize(actor, "user:impersonate");
  const admin = actor as Session;

  if (admin.userId === targetUserId) return { ok: false, reason: "self" };

  const target = await deps.users.find(targetUserId);
  if (!target) return { ok: false, reason: "not-found" };
  // Conta desabilitada não é assumível: seria uma porta dos fundos para operar
  // como alguém que o sistema já decidiu que não entra.
  if (target.disabledAt) return { ok: false, reason: "disabled" };

  const expiresAt = new Date(clock().now() + IMPERSONATION_HOURS * 3_600_000).toISOString();
  const token = await deps.sessions.create({
    userId: targetUserId,
    expiresAt,
    impersonatedBy: admin.userId,
  });

  await deps.audit.record({
    kind: "impersonation_start",
    userId: admin.userId,
    email: admin.email,
    detail: `assumiu ${target.email} (id ${targetUserId})`,
  });

  return { ok: true, token, expiresAt };
}

/**
 * Encerra a sessão emprestada.
 *
 * Revoga no servidor, e não apenas apaga o cookie: um token que o cliente
 * esquece continua válido para quem o copiou. O admin volta pela própria
 * sessão, que nunca foi tocada — assumir cria uma sessão nova em vez de
 * transformar a existente, justamente para a volta não depender de nada dar
 * certo.
 */
export async function stopImpersonation(
  borrowed: Session | null,
  token: string,
  deps: ImpersonationDeps,
): Promise<void> {
  await deps.sessions.revoke(token);
  if (!borrowed || borrowed.impersonatedBy === null) return;

  const admin = await deps.users.find(borrowed.impersonatedBy);
  await deps.audit.record({
    kind: "impersonation_end",
    userId: borrowed.impersonatedBy,
    email: admin?.email ?? null,
    detail: `largou ${borrowed.email} (id ${borrowed.userId})`,
  });
}
