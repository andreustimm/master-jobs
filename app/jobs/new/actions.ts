"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addManualDescriptionJob } from "../../../src/core/ingest/manual.ts";
import { scoreOne } from "../../../src/core/scoring/apply.ts";
import { listCandidates } from "../../../src/core/candidate.ts";
import { invalidateBoardFacets } from "../../../src/contexts/matching/index.ts";
import { authorize, resolvePublicOrigin, type Session } from "../../../src/contexts/auth/index.ts";
import { parseCandidateSelector, suggestJobToCandidate, validateNote } from "../../../src/contexts/pursuit/index.ts";
import { guard } from "../../auth";
import { setMutationFeedbackCookie } from "../../mutation-feedback-server";

/**
 * O candidato a quem a vaga nova também é sugerida (`suggestFor`, ADR-015),
 * ou `null` sem o campo. O id é só SELETOR dentro de
 * `session.linkedCandidateIds`: fora dela, o mesmo 404 de um candidato que não
 * existe, antes de qualquer gravação — nem a vaga nasce (IT-124). Exceção
 * registrada em `tests/support/entry-inventory.ts` (`SELECTOR_ID_BY_DESIGN`).
 */
function suggestionTarget(session: Session, formData: FormData): number | null {
  const raw = formData.get("suggestFor");
  if (raw === null || raw === "") return null;
  const candidateId = parseCandidateSelector(raw);
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) notFound();
  authorize(session, "suggestion:create", { kind: "candidate", candidateId });
  return candidateId;
}

/** Origem dos links do aviso ao candidato (G17), como nas actions de acesso. */
async function origin(): Promise<string | null> {
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return resolvePublicOrigin(process.env, { host: (await headers()).get("host"), proto });
}

/**
 * Cadastra uma vaga oferecida por um recrutador.
 *
 * Chama o MESMO caminho de ingestão que a CLI usa. Reimplementar a
 * normalização aqui produziria duas versões da mesma coisa divergindo em
 * silêncio, e quebraria a invariante de que a interface é adaptador sobre as
 * APIs públicas, não uma segunda implementação.
 *
 * Com `suggestFor`, a vaga também vira sugestão ao candidato acompanhado e a
 * pessoa volta à página dele (US-018.AC-1); sem ele, nada muda.
 */
export async function createRecruiterJobAction(formData: FormData) {
  // `job:write` é do acervo global — admin, candidato e recrutador têm.
  const session = await guard("job:write");
  const suggestFor = suggestionTarget(session, formData);
  const note = String(formData.get("note") ?? "");
  // A nota recusada não cria a vaga: corrigir e enviar de novo cadastraria
  // a mesma vaga duas vezes.
  if (suggestFor !== null && !validateNote(note).ok) return { ok: false, code: "note_too_long" };

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

  // Vaga nova, pontuada para todos: as contagens de todo mundo mudam.
  invalidateBoardFacets();
  revalidatePath("/jobs");
  revalidatePath("/");

  if (suggestFor !== null) {
    // A vaga já existe; uma recusa da sugestão (limite, acesso que acabou no
    // meio) não a desfaz, e a pessoa vê o aviso de erro na página do candidato.
    const suggestion = await suggestJobToCandidate(session, { candidateId: suggestFor, jobId: result.jobId, note }, await origin());
    revalidatePath(`/recruiter/${suggestFor}`);
    await setMutationFeedbackCookie(suggestion.ok ? "success" : "error");
    redirect(`/recruiter/${suggestFor}`);
  }

  await setMutationFeedbackCookie("success");
  redirect(`/jobs/${result.jobId}`);
}
