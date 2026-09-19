"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { guardOwnCandidate } from "../auth";
import {
  deleteTerm,
  moveTerm,
  rerunTerm,
  saveTerm,
  setTermStatus,
  type RerunResult,
  type SaveTermResult,
} from "../../src/contexts/matching/index.ts";
import { runTermCaptures } from "../../src/contexts/sourcing/index.ts";
import { enqueueScore } from "../../src/core/scoring/queue.ts";

/**
 * Ações da tela Buscas. Cada uma espera `guardOwnCandidate` antes de qualquer
 * efeito, e o candidato vem da sessão: id de termo ou de trilha no formulário
 * é pedido, conferido contra esse escopo (regra 15).
 */

function idFrom(formData: FormData, field: string): number | null {
  const value = Number(formData.get(field));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Drena a fila depois da resposta: a pessoa não espera a rede de terceiro.
 * 25 segundos, porque o `after()` morre em 30 (ADR-007). As vagas novas pedem
 * nota para quem pediu a busca; a fila de repontuação cuida disso.
 */
function drainAfterResponse(candidateId: number): void {
  after(async () => {
    await runTermCaptures({ budgetMs: 25_000, worker: "web" });
    await enqueueScore(candidateId, { origin: "perfil" });
  });
}

function refresh(): void {
  revalidatePath("/searches");
  revalidatePath("/jobs");
}

export async function saveTermAction(formData: FormData): Promise<SaveTermResult> {
  const { session, candidateId } = await guardOwnCandidate("candidate:write");
  const result = await saveTerm(
    { candidateId },
    { term: String(formData.get("term") ?? ""), trackId: idFrom(formData, "trackId") },
    { now: new Date(), impersonated: session.impersonatedBy !== null },
  );
  if (result.ok && result.run === "started") drainAfterResponse(candidateId);
  refresh();
  return result;
}

export async function rerunTermAction(formData: FormData): Promise<RerunResult> {
  const { session, candidateId } = await guardOwnCandidate("candidate:write");
  const termId = idFrom(formData, "termId");
  if (termId === null) return { ok: false, code: "not_found" };
  const result = await rerunTerm({ candidateId }, termId, {
    now: new Date(),
    impersonated: session.impersonatedBy !== null,
  });
  if (result.ok && result.run === "started") drainAfterResponse(candidateId);
  refresh();
  return result;
}

async function setStatus(candidateId: number, formData: FormData, status: "active" | "paused") {
  const termId = idFrom(formData, "termId");
  if (termId === null) return { ok: false, code: "not_found" as const };
  const result = await setTermStatus({ candidateId }, termId, status);
  refresh();
  return result;
}

export async function pauseTermAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  return setStatus(candidateId, formData, "paused");
}

export async function resumeTermAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  return setStatus(candidateId, formData, "active");
}

export async function moveTermAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const termId = idFrom(formData, "termId");
  const trackId = idFrom(formData, "trackId");
  if (termId === null || trackId === null) return { ok: false, code: "not_found" as const };
  const result = await moveTerm({ candidateId }, termId, trackId);
  refresh();
  return result;
}

export async function deleteTermAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const termId = idFrom(formData, "termId");
  if (termId === null) return { ok: true };
  const result = await deleteTerm({ candidateId }, termId);
  refresh();
  return result;
}
