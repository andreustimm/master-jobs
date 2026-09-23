"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { guardOwnCandidate } from "../auth";
import { setMutationFeedbackCookie } from "../mutation-feedback-server";
import {
  archiveTrack,
  createTrack,
  deleteTerm,
  ensurePrimaryTrack,
  invalidateBoardFacets,
  listCandidateTracks,
  moveTerm,
  restoreTrack,
  rerunTerm,
  saveTerm,
  setPrimaryTrack,
  setTermStatus,
  termAvailability,
  updateTrack,
  type LifecycleResult,
  type RerunResult,
  type SaveTermResult,
  type TrackResult,
  type UpdateTrackResult,
} from "../../src/contexts/matching/index.ts";
import { fieldsFrom, fieldsToTarget, type TrackFormError } from "./track-form";
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

export async function saveTermAction(formData: FormData): Promise<SaveTermResult & { href?: string }> {
  const { session, candidateId } = await guardOwnCandidate("candidate:write");
  const result = await saveTerm(
    { candidateId },
    { term: String(formData.get("term") ?? ""), trackId: idFrom(formData, "trackId") },
    { now: new Date(), impersonated: session.impersonatedBy !== null },
  );
  if (result.ok && result.run === "started") drainAfterResponse(candidateId);
  refresh();
  // A duplicata aponta para o termo que já existe, em vez de só recusar.
  if (!result.ok && result.code === "term_duplicate") return { ...result, href: `/searches#term-${result.termId}` };
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

/* ------------------------------- Tracks -------------------------------- */

type FormFailure = { ok: false; code: TrackFormError };

/**
 * Cria a trilha e, quando veio da oferta da tela Vagas, salva o termo nela.
 *
 * A trilha parte da principal (faixas e senioridade vêm dela, ADR-002) e só
 * existe depois que a pessoa confirma. Com o termo salvo, volta para Buscas.
 */
export async function createTrackAction(
  formData: FormData,
): Promise<TrackResult | FormFailure | (SaveTermResult & { href?: string })> {
  const { session, candidateId } = await guardOwnCandidate("candidate:write");
  const primary = await ensurePrimaryTrack(candidateId);
  if (!primary?.target) return { ok: false, code: "primary_pending" };
  const fields = fieldsFrom(formData);
  // A lista de títulos evitados não aparece no editor: herdá-la da principal
  // zerava o título justo das vagas que a trilha nova persegue.
  const parsed = fieldsToTarget(fields, {
    ...primary.target,
    targets: { ...primary.target.targets, avoid_titles: [] },
  });
  if (!parsed.ok) return parsed;

  // A trilha comita sozinha: o termo é conferido antes, para que uma recusa
  // dele não deixe trilha órfã nem um formulário que só responde "nome já existe".
  const term = String(formData.get("term") ?? "").trim();
  if (term) {
    const available = await termAvailability({ candidateId }, term);
    if (!available.ok) {
      return available.code === "term_duplicate" ? { ...available, href: `/searches#term-${available.termId}` } : available;
    }
  }
  const created = await createTrack(candidateId, { name: fields.name, target: parsed.target });
  if (!created.ok) return created;

  if (term) {
    const saved = await saveTerm(
      { candidateId },
      { term, trackId: created.track.id },
      { now: new Date(), impersonated: session.impersonatedBy !== null },
    );
    if (saved.ok && saved.run === "started") drainAfterResponse(candidateId);
    if (!saved.ok) {
      // Corrida com outra aba entre a conferência e o salvamento: a trilha já
      // existe, então a pessoa vai para ela em vez de reenviar a criação.
      refresh();
      await setMutationFeedbackCookie("error");
      redirect(`/searches/tracks/${created.track.id}`);
    }
  }
  refresh();
  await setMutationFeedbackCookie("success");
  redirect("/searches");
}

export async function updateTrackAction(formData: FormData): Promise<UpdateTrackResult | FormFailure> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const trackId = idFrom(formData, "trackId");
  const track = trackId === null ? undefined : (await listCandidateTracks(candidateId)).find((t) => t.id === trackId);
  if (!track?.target) return { ok: false, code: "not_found" };
  const fields = fieldsFrom(formData);
  const parsed = fieldsToTarget(fields, track.target);
  if (!parsed.ok) return parsed;
  const result = await updateTrack(candidateId, track.id, {
    name: track.isPrimary ? undefined : fields.name,
    target: parsed.target,
    expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
  });
  invalidateBoardFacets(candidateId);
  refresh();
  revalidatePath(`/searches/tracks/${track.id}`);
  return result;
}

async function lifecycle(
  formData: FormData,
  candidateId: number,
  change: (candidateId: number, trackId: number) => Promise<LifecycleResult>,
): Promise<LifecycleResult> {
  const trackId = idFrom(formData, "trackId");
  if (trackId === null) return { ok: false, code: "not_found" };
  const result = await change(candidateId, trackId);
  // O cockpit lê as facetas sem trilha na chave — a principal da hora da
  // leitura. Trocar, arquivar ou restaurar trilha muda a resposta dele.
  invalidateBoardFacets(candidateId);
  refresh();
  revalidatePath(`/searches/tracks/${trackId}`);
  return result;
}

export async function setPrimaryTrackAction(formData: FormData): Promise<LifecycleResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  return lifecycle(formData, candidateId, setPrimaryTrack);
}

export async function archiveTrackAction(formData: FormData): Promise<LifecycleResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  return lifecycle(formData, candidateId, archiveTrack);
}

export async function restoreTrackAction(formData: FormData): Promise<LifecycleResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  return lifecycle(formData, candidateId, restoreTrack);
}
