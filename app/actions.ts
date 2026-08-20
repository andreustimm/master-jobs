"use server";

import { revalidatePath } from "next/cache";
import { guard, guardOwnCandidate } from "./auth";
import { setApplicationStatus } from "../src/contexts/pursuit/index.ts";
import { parseApplicationStatus } from "../src/contexts/pursuit/domain/application.ts";

/**
 * Move a job through the funnel.
 *
 * Routed through the same `setApplicationStatus` the CLI uses, so the
 * transition lands in `application_event` identically. There is deliberately
 * no second write path — the UI is an adapter, not a parallel implementation.
 */
export async function trackAction(formData: FormData) {
  // Before any effect, never after: an action that validates late has already
  // written by the time it decides it should not have.
  const { candidateId } = await guardOwnCandidate("application:write");

  const jobId = Number(formData.get("jobId"));
  const status = parseApplicationStatus(String(formData.get("status")));
  const note = formData.get("note");

  if (!Number.isFinite(jobId)) throw new Error("jobId inválido");
  await setApplicationStatus(
    candidateId,
    jobId,
    status,
    typeof note === "string" ? note : undefined,
  );

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pipeline");
}

/**
 * Pede uma reconferência: "esta vaga ainda existe?".
 *
 * Enfileira e volta. Sondar o link dentro do clique deixaria a página pendurada
 * pelo tempo de rede de um site de terceiro — que pode ser 15 segundos até o
 * timeout, e é justamente nos links mortos que ele demora mais. O trabalho sai
 * do pedido HTTP e o worker (`pnpm jho jobs recheck run`) o consome.
 *
 * Enfileirar é idempotente por índice único: clicar três vezes atualiza a mesma
 * tarefa. Trabalho duplicado contra site de terceiro é como se toma bloqueio.
 */
export async function recheckAction(formData: FormData) {
  // Reconferir muta o corpus global, não o funil privado. Administradores podem
  // curar vagas sem ganhar, por tabela, permissão sobre candidaturas.
  await guard("job:write");

  const jobId = Number(formData.get("jobId"));
  if (!Number.isFinite(jobId)) throw new Error("jobId inválido");

  const { enqueueVerify } = await import("../src/core/ingest/verify-queue.ts");
  await enqueueVerify(jobId, { origin: "user" });

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}
