"use server";

import { revalidatePath } from "next/cache";
import { guard } from "../../auth";
import { requestRoutine } from "../../../src/contexts/operations/index.ts";

/**
 * Pede uma rotina de manutenção.
 *
 * `guard` antes de qualquer efeito, e a rotina vem do formulário como **pedido**
 * — o domínio recusa nome fora da lista (regra 15). Nenhum identificador de
 * candidato entra aqui: manutenção é do acervo, não de uma pessoa.
 */
export async function requestRoutineAction(formData: FormData) {
  await guard("admin:access");

  const result = await requestRoutine(formData.get("routine"));
  // A tela lê o estado das tabelas que a rotina escreve; revalidar deixa o
  // próximo carregamento mostrar o que ela já mudou.
  revalidatePath("/admin/operacoes");

  if (result.ok) return { status: "success" as const };
  if (result.code === "routine_unknown") return { status: "error" as const, code: "unknownRoutine" };
  if (result.code === "no_token") return { status: "error" as const, code: "notConfigured" };
  return { status: "error" as const, code: "rejected", status_code: result.status };
}
