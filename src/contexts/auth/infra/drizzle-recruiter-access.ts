/**
 * Concessões de acesso de recrutador sobre Drizzle (#465, ADR-011, ADR-012).
 *
 * Um dos três arquivos autorizados a importar `recruiterGrant`
 * (`tests/architecture.test.ts`); os outros dois são `drizzle-store.ts`, que
 * lê o acesso na carga da sessão, e `drizzle-directory.ts`, que administra.
 * Aqui moram as peças que os dois compartilham — o predicado de acesso e o
 * encerramento —, para que exista um jeito só de dizer "ativa" e um jeito só
 * de encerrar.
 *
 * O histórico (`recruiter_access_event`) só recebe INSERT. Nenhuma função
 * deste arquivo, nem de outro, o atualiza ou apaga.
 */
import { and, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import type { DB, DbTransaction } from "../../../core/db/client.ts";
import { authUser, recruiterAccessEvent, recruiterGrant } from "../../../core/db/schema.ts";
import { firstNonEmpty } from "../../../core/sources/http.ts";
import type { AccessActor, AccessEventKind, GrantStatus } from "../domain/recruiter-access.ts";

type Executor = DB | DbTransaction;

/**
 * A concessão vale agora: `active` e sem fim ou com fim depois de `nowIso`.
 *
 * É o corte de revogação, prazo e encerramento por conta removida (ADR-012).
 * Papel removido e conta desabilitada são cortados antes, na sessão. O texto
 * ISO em UTC compara em ordem cronológica, que é como todo instante é gravado.
 */
export function activeGrantCondition(nowIso: string): SQL {
  return and(
    eq(recruiterGrant.status, "active"),
    or(isNull(recruiterGrant.expiresAt), gt(recruiterGrant.expiresAt, nowIso)),
  )!;
}

/** Concessões que valem agora para um recrutador, com o id da concessão. */
export async function activeGrantsOf(
  db: Executor,
  recruiterUserId: number,
  nowIso: string,
): Promise<{ id: number; candidateId: number }[]> {
  return db
    .select({ id: recruiterGrant.id, candidateId: recruiterGrant.candidateId })
    .from(recruiterGrant)
    .where(and(eq(recruiterGrant.recruiterUserId, recruiterUserId), activeGrantCondition(nowIso)))
    .orderBy(recruiterGrant.id);
}

export type HistoryEntry = {
  candidateId: number;
  recruiterEmail: string;
  kind: AccessEventKind;
  actor: AccessActor;
  grantId?: number | null;
  inviteId?: number | null;
  actorUserId?: number | null;
  actorName?: string | null;
  detail?: string | null;
  at: string;
};

/** Acrescenta ao histórico. A única escrita que a tabela aceita. */
export async function appendHistory(db: Executor, entries: readonly HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(recruiterAccessEvent).values(
    entries.map((entry) => ({
      candidateId: entry.candidateId,
      grantId: entry.grantId ?? null,
      inviteId: entry.inviteId ?? null,
      recruiterEmail: entry.recruiterEmail,
      kind: entry.kind,
      actor: entry.actor,
      actorUserId: entry.actorUserId ?? null,
      actorName: entry.actorName ?? null,
      detail: entry.detail ?? null,
      at: entry.at,
    })),
  );
}

/**
 * Grava uma concessão ativa e o `grant_created`, na transação de quem chama.
 *
 * Devolve `null` quando já existe concessão ativa para o par: o índice único
 * parcial decide, não uma leitura anterior, e por isso duplo envio não cria
 * duas nem grava dois eventos.
 */
export async function insertActiveGrant(
  tx: DbTransaction,
  input: {
    candidateId: number;
    recruiterUserId: number;
    recruiterEmail: string;
    createdBy: number | null;
    actor: AccessActor;
    at: string;
    inviteId?: number | null;
    expiresAt?: string | null;
    expiryTz?: string | null;
  },
): Promise<number | null> {
  const [row] = await tx
    .insert(recruiterGrant)
    .values({
      candidateId: input.candidateId,
      recruiterUserId: input.recruiterUserId,
      recruiterEmail: input.recruiterEmail,
      status: "active",
      inviteId: input.inviteId ?? null,
      createdBy: input.createdBy,
      createdAt: input.at,
      expiresAt: input.expiresAt ?? null,
      expiryTz: input.expiryTz ?? null,
    })
    .onConflictDoNothing({
      target: [recruiterGrant.candidateId, recruiterGrant.recruiterUserId],
      where: eq(recruiterGrant.status, "active"),
    })
    .returning({ id: recruiterGrant.id });
  if (!row) return null;
  await appendHistory(tx, [
    {
      candidateId: input.candidateId,
      grantId: row.id,
      inviteId: input.inviteId ?? null,
      recruiterEmail: input.recruiterEmail,
      kind: "grant_created",
      actor: input.actor,
      actorUserId: input.actor === "system" ? null : input.createdBy,
      at: input.at,
    },
  ]);
  return row.id;
}

export type EndedGrant = { id: number; candidateId: number; recruiterUserId: number | null; recruiterEmail: string };

export type EndGrantResult = { ok: true; grant: EndedGrant } | { ok: false; error: "already_ended" | "not_found" };

/**
 * Encerra uma concessão: UPDATE condicional em `status = 'active'` e o
 * histórico na mesma transação (ADR-012).
 *
 * De dois encerramentos concorrentes, o segundo espera o lock da linha, relê o
 * `where` depois do commit do primeiro e atualiza zero linhas: devolve
 * `already_ended`, e só o vencedor grava histórico e manda e-mail. O id que não
 * existe devolve `not_found`.
 */
export async function endGrant(
  db: DB,
  input: {
    grantId: number;
    status: Exclude<GrantStatus, "active">;
    kind: AccessEventKind;
    actor: AccessActor;
    actorUserId: number | null;
    actorName: string | null;
    revokedBy: number | null;
    at: string;
  },
): Promise<EndGrantResult> {
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(recruiterGrant)
      .set({ status: input.status, endedAt: input.at, revokedBy: input.revokedBy })
      .where(and(eq(recruiterGrant.id, input.grantId), eq(recruiterGrant.status, "active")))
      .returning({
        id: recruiterGrant.id,
        candidateId: recruiterGrant.candidateId,
        recruiterUserId: recruiterGrant.recruiterUserId,
        recruiterEmail: recruiterGrant.recruiterEmail,
      });
    if (!ended) {
      const [exists] = await tx
        .select({ id: recruiterGrant.id })
        .from(recruiterGrant)
        .where(eq(recruiterGrant.id, input.grantId))
        .limit(1);
      return { ok: false as const, error: exists ? ("already_ended" as const) : ("not_found" as const) };
    }
    await appendHistory(tx, [
      {
        candidateId: ended.candidateId,
        grantId: ended.id,
        recruiterEmail: ended.recruiterEmail,
        kind: input.kind,
        actor: input.actor,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        at: input.at,
      },
    ]);
    return { ok: true as const, grant: ended };
  });
}

/**
 * Encerra todas as concessões ativas de uma conta que vai ser apagada, na
 * transação da exclusão e antes dela (ADR-012): depois do DELETE a FK zera
 * `recruiter_user_id`, e o CHECK recusaria concessão ativa sem recrutador.
 * O histórico guarda o e-mail, que sobrevive à conta.
 */
export async function endGrantsOfRemovedAccount(tx: DbTransaction, recruiterUserId: number, at: string): Promise<number> {
  const ended = await tx
    .update(recruiterGrant)
    .set({ status: "ended_account_removed", endedAt: at })
    .where(and(eq(recruiterGrant.recruiterUserId, recruiterUserId), eq(recruiterGrant.status, "active")))
    .returning({
      id: recruiterGrant.id,
      candidateId: recruiterGrant.candidateId,
      recruiterEmail: recruiterGrant.recruiterEmail,
    });
  await appendHistory(
    tx,
    ended.map((grant) => ({
      candidateId: grant.candidateId,
      grantId: grant.id,
      recruiterEmail: grant.recruiterEmail,
      kind: "access_ended_account_removed" as const,
      actor: "system" as const,
      at,
    })),
  );
  return ended.length;
}

/** Nome do administrador no momento do ato, para o histórico: nome de exibição ou, sem ele, o e-mail. */
export async function actorNameOf(db: Executor, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ fullName: authUser.fullName, email: authUser.email })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (!row) return null;
  return firstNonEmpty(row.fullName, row.email);
}
