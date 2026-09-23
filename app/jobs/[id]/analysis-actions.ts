"use server";

import { revalidatePath } from "next/cache";
import { clock } from "../../../src/core/clock.ts";
import { requestJobAnalysis } from "../../../src/core/llm/job-analysis.ts";
import { guard } from "../../auth";
import { setMutationFeedbackCookie } from "../../mutation-feedback-server";

/**
 * Pede a análise estruturada da vaga. Só grava o pedido: a chamada ao
 * provedor roda na CLI (`jho analysis run`), nunca nesta requisição.
 *
 * `job:read` basta: quem lê a vaga pode pedir a leitura dela, e o resultado
 * não carrega dado de candidato. Vaga inexistente e vaga que a sessão não lê
 * respondem igual — o acervo é global, então não há a segunda.
 */
export async function requestJobAnalysisAction(formData: FormData) {
  const session = await guard("job:read");
  // Nome próprio, e não `jobId`: o campo `jobId` na tela da vaga é o sinal de
  // formulário de funil, que o recrutador não pode receber (E2E por papel).
  const jobId = Number(formData.get("analysisJobId"));
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    await setMutationFeedbackCookie("error");
    return;
  }
  // Quem pediu vem da sessão; um campo homônimo no formulário é ignorado.
  const result = await requestJobAnalysis({ jobId, requestedBy: session.userId, now: clock().iso() });
  if (!result.ok || result.outcome === "exhausted") {
    await setMutationFeedbackCookie("error");
    return;
  }
  revalidatePath(`/jobs/${jobId}`);
  await setMutationFeedbackCookie("success");
}
