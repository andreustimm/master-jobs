"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard } from "../../auth";
import { requestSourceRun, retrySourceRun } from "../../../src/contexts/operations/index.ts";

/**
 * Pedir execuções que não são de uma fonte só (#223, tarefa 03): "Buscar em
 * todas", "Atualizar status de todas" e "Tentar de novo".
 *
 * `guard("admin:access")` antes de qualquer efeito, e sessão emprestada nega
 * (regra 3 de `policy.ts`). O id da execução vem do formulário como pedido: o
 * caso de uso confere se ela existe e se terminou sem sucesso.
 */

/** O modo aberto sintetiza `userId: 0`, que não é conta: vira "sem ator". */
function actorOf(userId: number): number | null {
  return userId > 0 ? userId : null;
}

export async function requestAllRunsAction(formData: FormData) {
  const session = await guard("admin:access");
  const verify = formData.get("scope") === "verify";
  const result = await requestSourceRun(verify ? { kind: "verify", sourceId: null } : { kind: "all" }, actorOf(session.userId));
  revalidatePath("/admin/execucoes");
  if (!result.ok) return { status: "error" as const, code: result.code };
  redirect(`/admin/execucoes/${result.runId}`);
}

export async function retryRunAction(formData: FormData) {
  const session = await guard("admin:access");
  const runId = Number(formData.get("runId"));
  if (!Number.isSafeInteger(runId) || runId <= 0) return { status: "error" as const, code: "run_not_found" };
  const result = await retrySourceRun(runId, actorOf(session.userId));
  revalidatePath("/admin/execucoes");
  if (!result.ok) return { status: "error" as const, code: result.code };
  redirect(`/admin/execucoes/${result.runId}`);
}
