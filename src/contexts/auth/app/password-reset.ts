/**
 * Recuperar a senha.
 *
 * Três disciplinas, e nenhuma é opcional:
 *
 * **1. A resposta nunca diz se o endereço existe.** Pedir recuperação para um
 * e-mail cadastrado e para um desconhecido produz exatamente a mesma tela e o
 * mesmo tempo de resposta. Um formulário que responde "não encontramos esta
 * conta" é um oráculo de enumeração aberto ao mundo — dá para descobrir quem
 * está cadastrado sem nunca entrar. A tela de login deste projeto já se
 * comporta assim; esta segue a mesma postura.
 *
 * **2. O token é de uso único e some ao ser usado.** Um link de recuperação é
 * uma credencial completa: quem o tem troca a senha. Ele vive uma hora, não os
 * quinze minutos do link de login — a pessoa que esqueceu a senha
 * frequentemente vai buscar o e-mail em outro dispositivo — e é queimado no
 * resgate, antes de a senha nova ser gravada.
 *
 * **3. Trocar a senha derruba todas as sessões.** Quem recupera a senha
 * frequentemente o faz porque suspeita de acesso indevido. Deixar as sessões
 * antigas vivas devolveria o acesso a quem já estava dentro, que é o oposto do
 * que a pessoa pediu.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { authLoginToken, authUser } from "../../../core/db/schema.ts";
import { checkPassword } from "../domain/password.ts";
import type { Mailer } from "../ports-mailer.ts";
import type { AuthRepository, SessionStore } from "../ports.ts";

export const RESET_MINUTES = 60;

/** Tentativas de recuperação por endereço, na janela. Além disso, silêncio. */
export const RESET_MAX_PER_HOUR = 5;

export type ResetDeps = {
  mailer: Mailer;
  audit: AuthRepository;
  sessions: SessionStore;
  /** Como montar o link. Injetado porque o host muda entre ambientes. */
  linkFor: (token: string) => string;
  /**
   * Grava a senha. Vem de fora para este módulo não conhecer scrypt.
   *
   * Devolve `false` quando a conta sumiu entre o resgate do token e a escrita —
   * corrida real, ainda que estreita, e o resgate precisa saber para não
   * anunciar sucesso sobre nada.
   */
  setPassword: (email: string, password: string) => Promise<boolean>;
  /** Gera e guarda o token, devolvendo o valor cru uma única vez. */
  issue: (email: string, expiresAt: string) => Promise<string>;
};

/**
 * Pede a recuperação.
 *
 * **Sempre devolve `{ sent: true }`.** O booleano não é informação sobre a
 * conta — é confirmação de que o pedido foi aceito. Quem chama não consegue
 * distinguir endereço cadastrado de desconhecido, e é assim de propósito.
 */
export async function requestPasswordReset(
  email: string,
  deps: ResetDeps,
): Promise<{ sent: true }> {
  const normalised = email.trim().toLowerCase();
  const db = getDb();

  const [user] = await db
    .select({ id: authUser.id, disabledAt: authUser.disabledAt })
    .from(authUser)
    .where(eq(authUser.email, normalised))
    .limit(1);

  // Conta desabilitada não recupera senha: recuperar devolveria acesso a quem o
  // sistema já decidiu que não entra. E, como todo o resto aqui, em silêncio.
  const eligible = Boolean(user) && !user?.disabledAt;

  if (eligible) {
    const since = new Date(clock().now() - 3_600_000).toISOString();
    const [recent] = await db
      .select({ n: sql<number>`count(*)` })
      .from(authLoginToken)
      .where(
        and(
          eq(authLoginToken.email, normalised),
          eq(authLoginToken.purpose, "reset"),
          gt(authLoginToken.createdAt, since),
        ),
      );

    // Limite por endereço. Sem ele, o formulário vira um botão de mandar e-mail
    // para qualquer pessoa quantas vezes se quiser — spam com o nosso remetente.
    if (Number(recent?.n ?? 0) < RESET_MAX_PER_HOUR) {
      const expiresAt = new Date(clock().now() + RESET_MINUTES * 60_000).toISOString();
      const token = await deps.issue(normalised, expiresAt);

      const result = await deps.mailer.send({
        to: normalised,
        subject: "Recuperar o acesso ao job-hunt-os",
        text: [
          "Alguém pediu para recuperar a senha desta conta.",
          "",
          deps.linkFor(token),
          "",
          `O link vale ${RESET_MINUTES} minutos e serve uma vez só.`,
          "Se não foi você, ignore: nada muda enquanto o link não for usado.",
        ].join("\n"),
      });

      await deps.audit.record({
        kind: result.ok ? "reset_requested" : "reset_send_failed",
        email: normalised,
        detail: result.ok ? `via ${deps.mailer.name}` : result.error,
      });
    } else {
      await deps.audit.record({ kind: "reset_rate_limited", email: normalised });
    }
  } else {
    // Registrado para o operador ver tentativa em endereço desconhecido — o que
    // NÃO acontece é a resposta mudar.
    await deps.audit.record({ kind: "reset_requested_unknown", email: normalised });
  }

  return { sent: true };
}

/**
 * O token ainda serve? Consulta que NÃO consome.
 *
 * Existe para a tela poder dizer "este link não vale mais" antes de a pessoa
 * digitar uma senha nova. Sem isso ela preenche o campo, envia, e só então
 * descobre que precisa pedir outro link — e como a mensagem de link morto e a
 * de senha curta exigem ações diferentes, misturá-las faz alguém pedir link
 * novo por ter digitado uma senha curta.
 *
 * Não é vazamento: o token É o segredo, e quem o tem já pode usá-lo. Responder
 * sobre um valor de 32 bytes aleatórios não ajuda quem está adivinhando.
 */
export async function isResetTokenLive(
  token: string,
  hashToken: (raw: string) => string,
): Promise<boolean> {
  if (!token) return false;
  const nowIso = clock().iso();
  const [row] = await getDb()
    .select({ id: authLoginToken.id })
    .from(authLoginToken)
    .where(
      and(
        eq(authLoginToken.tokenHash, hashToken(token)),
        eq(authLoginToken.purpose, "reset"),
        isNull(authLoginToken.usedAt),
        gt(authLoginToken.expiresAt, nowIso),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type RedeemResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "weak" };

/**
 * Resgata o token e grava a senha nova.
 *
 * `invalid` cobre token inexistente, expirado e já usado, sem distinguir: cada
 * distinção é uma pista para quem está adivinhando token.
 */
export async function redeemPasswordReset(
  token: string,
  newPassword: string,
  hashToken: (raw: string) => string,
  deps: ResetDeps,
): Promise<RedeemResult> {
  const db = getDb();
  const nowIso = clock().iso();

  const problem = checkPassword(newPassword);
  if (!problem.ok) return { ok: false, reason: "weak" };

  // Queima o token e lê o e-mail numa instrução só: o `WHERE` reconfere as
  // condições que o `UPDATE` pressupõe, então dois resgates do mesmo link não
  // trocam a senha duas vezes.
  const [claimed] = await db
    .update(authLoginToken)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(authLoginToken.tokenHash, hashToken(token)),
        eq(authLoginToken.purpose, "reset"),
        isNull(authLoginToken.usedAt),
        gt(authLoginToken.expiresAt, nowIso),
      ),
    )
    .returning({ email: authLoginToken.email });

  if (!claimed) return { ok: false, reason: "invalid" };

  // A conta pode ter sido apagada entre queimar o token e gravar a senha. O
  // token já foi consumido — e isso é correto: um link que falhou por conta
  // inexistente não deve continuar valendo.
  if (!(await deps.setPassword(claimed.email, newPassword))) {
    await deps.audit.record({ kind: "reset_failed", email: claimed.email });
    return { ok: false, reason: "invalid" };
  }

  // Todas as sessões caem. Quem recupera a senha costuma fazê-lo por suspeitar
  // de acesso indevido; manter as antigas devolveria o acesso a quem já estava
  // dentro.
  const [user] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, claimed.email))
    .limit(1);
  if (user) await deps.sessions.revokeAllFor(user.id);

  await deps.audit.record({ kind: "reset_completed", email: claimed.email });
  return { ok: true, email: claimed.email };
}
