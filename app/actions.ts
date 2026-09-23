"use server";

import { revalidatePath } from "next/cache";
import { guard, guardOwnCandidate } from "./auth";
import {
  ApplicationTransitionConflictError,
  setApplicationStatus,
} from "../src/contexts/pursuit/index.ts";
import {
  IllegalApplicationTransitionError,
  parseApplicationStatus,
  type ApplicationStatus,
} from "../src/contexts/pursuit/domain/application.ts";
import { invalidateBoardFacets } from "../src/contexts/matching/index.ts";

/**
 * O que a tela precisa saber para explicar a recusa sem perder o rascunho.
 * `from`/`to` viajam porque a mensagem nomeia os dois status, e o cliente não
 * tem como recalcular o `from`: ele é o estado gravado, não o da página.
 */
export type TrackResult =
  | { status: "ok" }
  | { status: "error"; code: "illegal_transition"; from: ApplicationStatus; to: ApplicationStatus }
  | { status: "error"; code: "conflict" };

/**
 * Move a job through the funnel.
 *
 * Routed through the same `setApplicationStatus` the CLI uses, so the
 * transition lands in `application_event` identically. There is deliberately
 * no second write path — the UI is an adapter, not a parallel implementation.
 */
export async function trackAction(formData: FormData): Promise<TrackResult> {
  // Before any effect, never after: an action that validates late has already
  // written by the time it decides it should not have.
  const { candidateId } = await guardOwnCandidate("application:write");

  const jobId = Number(formData.get("jobId"));
  const status = parseApplicationStatus(String(formData.get("status")));
  const note = formData.get("note");

  if (!Number.isFinite(jobId)) throw new Error("jobId inválido");
  try {
    await setApplicationStatus(
      candidateId,
      jobId,
      status,
      typeof note === "string" ? note : undefined,
    );
  } catch (error) {
    // Recusa prevista do domínio não é falha do sistema: ela volta como dado
    // para a tela explicar o motivo e PRESERVAR o que a pessoa digitou. Lançar
    // aqui deixava a nota da transição recusada ser descartada com o resto do
    // formulário, e a mensagem genérica não dizia de onde para onde não dá.
    // A recusa prova que esta tela está atrasada: alguém moveu a candidatura
    // desde que ela foi renderizada. Revalidar aqui, mesmo sem escrita, é o que
    // faz a próxima renderização trazer o estágio real e os alcançáveis a partir
    // dele — sem isso a pessoa relê a lista velha e é recusada de novo.
    if (error instanceof IllegalApplicationTransitionError) {
      revalidatePath(`/jobs/${jobId}`);
      return { status: "error", code: "illegal_transition", from: error.from, to: error.to };
    }
    if (error instanceof ApplicationTransitionConflictError) {
      revalidatePath(`/jobs/${jobId}`);
      return { status: "error", code: "conflict" };
    }
    throw error;
  } finally {
    // Depois da escrita, e também na recusa: ela prova que o funil mudou por
    // outro caminho. Invalidar antes da escrita deixaria uma leitura paralela
    // guardar de novo as contagens de antes.
    invalidateBoardFacets(candidateId);
  }

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pipeline");
  return { status: "ok" };
}

/**
 * "Não me interessa" e o seu desfazer: um clique, sem nota, pelo mesmo
 * `setApplicationStatus` do seletor de estágio — arquivar é a decisão, e o
 * leitor do board esconde a arquivada de toda lista que não a pediu.
 *
 * Recusa ou corrida só revalidam: a próxima renderização traz o estágio real e
 * o botão que ele permite. Não há rascunho para preservar.
 */
async function moveFromList(candidateId: number, formData: FormData, status: "archived" | "backlog"): Promise<void> {
  const jobId = Number(formData.get("jobId"));
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("jobId inválido");
  try {
    await setApplicationStatus(candidateId, jobId, status);
  } catch (error) {
    if (!(error instanceof IllegalApplicationTransitionError || error instanceof ApplicationTransitionConflictError)) {
      throw error;
    }
  } finally {
    // Arquivar tira a vaga das contagens dos chips; restaurar a devolve.
    invalidateBoardFacets(candidateId);
  }
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pipeline");
}

export async function dismissJobAction(formData: FormData): Promise<void> {
  const { candidateId } = await guardOwnCandidate("application:write");
  await moveFromList(candidateId, formData, "archived");
}

export async function restoreJobAction(formData: FormData): Promise<void> {
  const { candidateId } = await guardOwnCandidate("application:write");
  await moveFromList(candidateId, formData, "backlog");
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
