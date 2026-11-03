"use server";

import { revalidatePath } from "next/cache";
import { decideRecruiterSuggestion, type DecideResult } from "../../src/contexts/pursuit/index.ts";
import { guardOwnCandidate } from "../auth";

/**
 * Aceitar e recusar uma sugestão de vaga (#465, US-021, US-022, ADR-015).
 *
 * `guardOwnCandidate("suggestion:decide")` antes de tudo: o candidato vem da
 * sessão, e a política nega a sessão emprestada (G24) — o admin que assume a
 * pessoa vê as sugestões, mas não decide por ela. O id do formulário é da
 * sugestão, e o store só a procura dentro do candidato da sessão: a de outra
 * pessoa responde `not_found`, igual à que não existe.
 */

function suggestionId(formData: FormData): number {
  const value = Number(formData.get("suggestionId"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export async function acceptSuggestionAction(formData: FormData): Promise<DecideResult> {
  const { session } = await guardOwnCandidate("suggestion:decide");
  const result = await decideRecruiterSuggestion(session, suggestionId(formData), "accept");
  revalidatePath("/suggestions");
  revalidatePath("/pipeline");
  return result;
}

export async function declineSuggestionAction(formData: FormData): Promise<DecideResult> {
  const { session } = await guardOwnCandidate("suggestion:decide");
  const result = await decideRecruiterSuggestion(session, suggestionId(formData), "decline");
  revalidatePath("/suggestions");
  return result;
}
