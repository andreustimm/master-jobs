"use server";

import { revalidatePath } from "next/cache";
import { clock } from "../../src/core/clock.ts";
import { retryJobAnalysis } from "../../src/core/llm/job-analysis.ts";
import { guard } from "../auth";
import { setMutationFeedbackCookie } from "../mutation-feedback-server";

/**
 * Nova tentativa de uma análise que não terminou bem, ligada à original.
 *
 * Só admin, e nunca por sessão emprestada (`admin:access` está entre as ações
 * de administração): cada tentativa é uma chamada paga à chave de quem opera,
 * e é o admin quem passa do teto de pedidos por texto.
 */
export async function retryJobAnalysisAction(formData: FormData) {
  const session = await guard("admin:access");
  const analysisId = Number(formData.get("analysisId"));
  if (!Number.isSafeInteger(analysisId) || analysisId <= 0) {
    await setMutationFeedbackCookie("error");
    return;
  }
  const result = await retryJobAnalysis({ analysisId, requestedBy: session.userId, now: clock().iso() });
  if (!result.ok) {
    await setMutationFeedbackCookie("error");
    return;
  }
  revalidatePath(`/jobs/${result.jobId}`);
  await setMutationFeedbackCookie("success");
}
