"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard } from "../../auth";
import { clock } from "../../../src/core/clock.ts";
import { IngestionBlockedError } from "../../../src/core/ingest/environment.ts";
import { isFetchableSourceKind } from "../../../src/core/sources/registry.ts";
import {
  editCatalogSource,
  probeCatalogSource,
  registerCatalogSource,
  retireSource,
} from "../../../src/contexts/sourcing/index.ts";
import { requestSourceRun } from "../../../src/contexts/operations/index.ts";

/**
 * Operar o catálogo de fontes (#223, tarefa 03).
 *
 * Toda action chama `guard("admin:access")` antes de qualquer efeito: a
 * política nega candidato, recrutador e sessão emprestada — inclusive a de um
 * admin assumindo outro (regra 3 de `policy.ts`). O id da fonte vem do
 * formulário como PEDIDO: o caso de uso só age sobre linha do catálogo, e
 * aposentada ou inexistente recusa com código.
 */

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** O modo aberto sintetiza `userId: 0`, que não é conta: vira "sem ator". */
function actorOf(userId: number): number | null {
  return userId > 0 ? userId : null;
}

function refresh(id?: string) {
  revalidatePath("/admin/plataformas");
  if (id) revalidatePath(`/admin/plataformas/${encodeURIComponent(id)}`);
}

export async function registerSourceAction(formData: FormData) {
  await guard("admin:access");
  const secret = text(formData, "secretRef");
  const result = await registerCatalogSource(
    {
      kind: text(formData, "kind"),
      handle: text(formData, "handle").trim(),
      label: text(formData, "label"),
      enabled: formData.get("enabled") === "on",
      secretRef: secret === "" ? null : secret,
    },
    clock().iso(),
  );
  refresh();
  // O código de recusa nunca carrega o valor recebido: um segredo colado no
  // campo errado não volta para a tela.
  return result.ok ? { status: "success" as const } : { status: "error" as const, code: result.code };
}

export async function setSourceEnabledAction(formData: FormData) {
  await guard("admin:access");
  const id = text(formData, "id");
  const enabled = text(formData, "enabled") === "true";
  const result = await editCatalogSource(id, { enabled }, clock().iso());
  refresh(id);
  return result.ok
    ? { status: "success" as const, run: enabled ? "enabled" : "disabled" }
    : { status: "error" as const, code: result.code };
}

export async function retireSourceAction(formData: FormData) {
  await guard("admin:access");
  const id = text(formData, "id");
  // A confirmação é do formulário: aposentar tira a fonte de toda execução.
  if (formData.get("confirm") !== "on") return { status: "error" as const, code: "confirm_required" };
  const result = await retireSource(id, clock().iso());
  refresh(id);
  return result.ok ? { status: "success" as const } : { status: "error" as const, code: result.code };
}

/**
 * Sonda sem gravar vaga, saúde nem cota. Fora de produção a guarda de
 * ingestão recusa antes da rede, e a tela diz isso em vez de parecer falha.
 */
export async function probeSourceAction(formData: FormData) {
  await guard("admin:access");
  const [kind = "", ...rest] = text(formData, "id").split(":");
  if (!isFetchableSourceKind(kind)) return { status: "error" as const, code: "unknown_kind" };
  try {
    const report = await probeCatalogSource(kind, rest.join(":"));
    return { status: "success" as const, run: report.outcome };
  } catch (error) {
    if (error instanceof IngestionBlockedError) return { status: "error" as const, code: "ingestion_blocked" };
    throw error;
  }
}

/** "Buscar agora" e "Atualizar status": cria a execução e leva ao detalhe dela. */
export async function requestSourceRunAction(formData: FormData) {
  const session = await guard("admin:access");
  const id = text(formData, "id");
  const verify = text(formData, "scope") === "verify";
  const result = await requestSourceRun(
    verify ? { kind: "verify", sourceId: id } : { kind: "source", sourceId: id },
    actorOf(session.userId),
  );
  refresh(id);
  if (!result.ok) return { status: "error" as const, code: result.code };
  revalidatePath("/admin/execucoes");
  redirect(`/admin/execucoes/${result.runId}`);
}
