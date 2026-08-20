"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addManualDescriptionJob } from "../../../src/core/ingest/manual.ts";
import { scoreOne } from "../../../src/core/scoring/apply.ts";
import { listCandidates } from "../../../src/core/candidate.ts";
import { guard } from "../../auth";

/**
 * Cadastra uma vaga oferecida por um recrutador.
 *
 * Chama o MESMO caminho de ingestão que a CLI usa. Reimplementar a
 * normalização aqui produziria duas versões da mesma coisa divergindo em
 * silêncio, e quebraria a invariante de que a interface é adaptador sobre as
 * APIs públicas, não uma segunda implementação.
 */
export async function createRecruiterJobAction(formData: FormData) {
  // `job:write` é do acervo global — admin, candidato e recrutador têm.
  const session = await guard("job:write");

  const result = await addManualDescriptionJob({
    title: String(formData.get("title") ?? ""),
    companyName: String(formData.get("companyName") ?? ""),
    description: String(formData.get("description") ?? ""),
    location: String(formData.get("location") ?? "") || undefined,
    url: String(formData.get("url") ?? "") || undefined,
    // Digitada no formulário, que para o registro é o mesmo que colada.
    inputMethod: "paste",
    sourceKind: "recruiter",
    // Regra 15 na letra: id em FormData é pedido, não prova. Vem da sessão, e
    // um campo homônimo que chegue no formulário é ignorado.
    postedByUserId: session.userId,
  });

  // Pontua na hora, para TODO candidato.
  //
  // A ingestão em lote apenas invalida os scores e deixa o cálculo para
  // `jho jobs score`. Para uma vaga vinda do sync isso é certo — são milhares,
  // e ninguém está olhando. Aqui alguém acabou de digitar e vai procurá-la: sem
  // score ela não aparece em lista nenhuma, e a pessoa conclui que o cadastro
  // falhou. É uma vaga só, e o custo é milissegundos.
  //
  // Para TODOS os candidatos porque o acervo é global: cada um vê a própria
  // nota, e pontuar só para quem cadastrou deixaria a vaga invisível justamente
  // para quem ela interessa — o recrutador não é o destinatário dela.
  for (const person of await listCandidates()) {
    await scoreOne(person.id, result.jobId).catch(() => {
      // Score é derivado e recalculável; a vaga não. Falhar aqui não pode
      // desfazer o cadastro.
    });
  }

  revalidatePath("/jobs");
  revalidatePath("/");
  redirect(`/jobs/${result.jobId}`);
}
