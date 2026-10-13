"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { authorize, resolvePublicOrigin } from "../../../../src/contexts/auth/index.ts";
import { parseCandidateSelector, suggestJobToCandidate, type SuggestResult } from "../../../../src/contexts/pursuit/index.ts";
import { guard } from "../../../auth";

/**
 * Sugerir uma vaga do acervo a um candidato acompanhado (#465, US-018,
 * ADR-015).
 *
 * O id do candidato chega do formulário, e é só SELETOR dentro de
 * `session.linkedCandidateIds` — a lista que a sessão resolveu na carga, das
 * concessões vigentes. Fora dela, o mesmo 404 de um candidato que não existe
 * (US-018.EC-7); dentro, a política decide (`suggestion:create`) antes de
 * qualquer efeito. O autor e a concessão vêm da sessão, nunca do formulário.
 * Exceção registrada em `tests/support/entry-inventory.ts`
 * (`SELECTOR_ID_BY_DESIGN`), coberta por `tests/entry-denial.test.ts`.
 */

function positiveId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/** Origem dos links do aviso (G17), como nas actions de acesso. */
async function origin(): Promise<string | null> {
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return resolvePublicOrigin(process.env, { host: (await headers()).get("host"), proto });
}

export async function suggestJobAction(formData: FormData): Promise<SuggestResult | { ok: false; error: "pick_job" }> {
  // `job:read` primeiro: nega sessão ausente, vencida ou revogada antes de
  // ler qualquer campo. O vínculo e a ação de sugerir vêm logo depois.
  const session = await guard("job:read");
  const candidateId = parseCandidateSelector(formData.get("candidateId"));
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) notFound();
  authorize(session, "suggestion:create", { kind: "candidate", candidateId });

  const jobId = positiveId(formData.get("jobId"));
  if (jobId === 0) return { ok: false, error: "pick_job" };
  const result = await suggestJobToCandidate(
    session,
    { candidateId, jobId, note: String(formData.get("note") ?? "") },
    await origin(),
  );
  if (result.ok) revalidatePath(`/recruiter/${candidateId}`);
  return result;
}
