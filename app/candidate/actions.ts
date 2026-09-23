"use server";

import { revalidatePath } from "next/cache";
import { guard, guardOwnCandidate } from "../auth";
import { scoreAfterResponse } from "../score-queue-drain";
import { createOwnCandidate } from "../../src/contexts/auth/index.ts";
import {
  CV_MIN,
  parseOwnProfile,
  validatePublicSlug,
  type NameError,
  type OwnProfileError,
  type PublicSlugError,
} from "../../src/core/candidate-identity.ts";
import {
  requestCvRescore,
  setCandidateName,
  setPublicCv,
  setPublicSlug,
  setVisibility,
} from "../../src/core/candidate.ts";
import {
  deleteDocument,
  documentById,
  renameDocument,
  restoreDocument,
  saveDocument,
  type VersionError,
} from "../../src/core/candidate.ts";

/** Rótulo de versão sem idioma: a data. Fica gravado, então não pode ser frase. */
function defaultCvLabel(): string {
  return `CV ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Save the CV the candidate pasted.
 *
 * Versioned, never overwritten — knowing what was actually sent to a company
 * three weeks ago is the difference between answering an interview question
 * and guessing.
 */
export async function saveCvAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");

  const content = String(formData.get("content") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || defaultCvLabel();

  if (content.length < CV_MIN) {
    throw new Error("O texto é curto demais para ser um currículo (mínimo 100 caracteres).");
  }

  // The id comes from the guard, never from the form: a candidate id in
  // FormData is a request, not a proof.
  await saveDocument({ candidateId, kind: "cv", label, content, format: "text" });
  // Currículo novo, nota nova: a fatia roda depois da resposta (#280).
  scoreAfterResponse();

  revalidatePath("/candidate");
}

/**
 * Import a CV from an uploaded PDF.
 *
 * Extraction is not trusted: the result is saved as a new version like any
 * other, so the candidate reviews it in the editor before it feeds skill
 * detection. A scanned CV has no text layer at all, and failing loudly here is
 * better than silently storing three lines of header.
 */
export async function importPdfAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Selecione um arquivo PDF.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Arquivo acima de 10 MB. Currículo não deveria chegar perto disso.");
  }

  const { extractPdfText } = await import("../../src/core/pdf.ts");
  const extracted = await extractPdfText(await file.arrayBuffer());

  if (extracted.text.trim().length < 100) {
    throw new Error(
      "Quase nenhum texto no PDF. Provavelmente é digitalizado (imagem), sem camada de texto — cole o conteúdo manualmente.",
    );
  }

  await saveDocument({
    candidateId,
    kind: "cv",
    label: file.name.replace(/\.pdf$/i, ""),
    content: extracted.text,
    format: "text",
  });
  scoreAfterResponse();

  revalidatePath("/candidate");
}

/* -------------------------------------------------------------------------- */
/* Versões                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As ações de versão **retornam** o erro em vez de lançar.
 *
 * As duas outras ações deste arquivo lançam, e para elas serve: "PDF sem texto"
 * é excepcional. Aqui não é. "Não dá para excluir, três candidaturas citam esta
 * versão" é uma resposta prevista, que o usuário precisa ler ao lado da linha
 * que clicou — e não numa fronteira de erro que substitui a página inteira.
 *
 * O código volta como chave; a tela traduz. Mensagem montada no servidor sai
 * sempre no idioma de quem escreveu o código, não no de quem lê.
 */
export type VersionActionResult =
  | { ok: true }
  | { ok: false; error: VersionError; detail?: string };

export async function renameVersionAction(
  id: number,
  label: string,
): Promise<VersionActionResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const result = await renameDocument(candidateId, id, label);
  if (result.ok) revalidatePath("/candidate");
  return result;
}

export async function deleteVersionAction(id: number): Promise<VersionActionResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const result = await deleteDocument(candidateId, id);
  if (result.ok) revalidatePath("/candidate");
  return result;
}

/**
 * `label` chega pronto da tela porque é dado do usuário no idioma dele: um
 * sufixo "(restaurada)" montado no servidor sairia em português para quem está
 * lendo a interface em inglês, e ficaria gravado assim para sempre.
 */
export async function restoreVersionAction(
  id: number,
  label: string,
): Promise<VersionActionResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const result = await restoreDocument(candidateId, id, label);
  if (result.ok) {
    // Restaurar grava uma versão nova do currículo e enfileira como salvar.
    scoreAfterResponse();
    revalidatePath("/candidate");
  }
  return result.ok ? { ok: true } : result;
}

/** Conteúdo de uma versão, para o painel de visualização. */
export async function readVersionAction(
  id: number,
): Promise<{ ok: true; label: string; content: string } | { ok: false; error: VersionError }> {
  const { candidateId } = await guardOwnCandidate("candidate:read");
  const doc = await documentById(candidateId, id);
  if (!doc) return { ok: false, error: "not-found" };
  return { ok: true, label: doc.label, content: doc.content };
}

/* -------------------------------------------------------------------------- */
/* Visibilidade do perfil                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Muda quem alcança o perfil: privado, recrutadores ou público.
 *
 * `guardOwnCandidate` não aceita id por parâmetro — o escopo sai da sessão.
 * É o que impede alguém de mudar a visibilidade do perfil de outra pessoa
 * mandando um id à mão, que aqui seria especialmente grave: a mudança é para
 * MAIS exposição, e a vítima não teria como perceber.
 */
export async function setVisibilityAction(formData: FormData) {
  const { candidateId } = await guardOwnCandidate("candidate:write");

  const result = await setVisibility(candidateId, String(formData.get("visibility") ?? ""));
  if (!result.ok) throw new Error("Visibilidade inválida.");

  // O currículo só é publicado quando as DUAS coisas são verdade. Sem esta
  // segunda condição, alguém que marcou "público" uma vez e depois voltou para
  // privado deixaria o consentimento do CV pendurado, pronto para reabrir na
  // próxima vez que marcasse público de novo.
  await setPublicCv(candidateId, result.visibility === "public" && formData.get("publicCv") === "on");

  revalidatePath("/candidate");
}

/* -------------------------------------------------------------------------- */
/* Criar o próprio perfil                                                      */
/* -------------------------------------------------------------------------- */

export type CreateProfileResult =
  | { ok: true }
  | { ok: false; code: OwnProfileError | PublicSlugError | "slugTaken" | "unavailable" };

/**
 * "Criar meu perfil": a conta sem candidato cria o PRÓPRIO.
 *
 * O guarda vem antes de tudo e decide pela sessão — `candidate:create` só
 * passa para conta de papel candidato, sem candidato, e com sessão própria.
 * Não há id nenhum no formulário: a conta é a da sessão, e o candidato é uma
 * linha nova. Identidade vem do que a pessoa escreveu; `profile.yaml` é do
 * dono e não entra aqui.
 *
 * Duplo envio devolve sucesso sem criar o segundo: `createOwnCandidate` trava
 * a linha da conta, e a segunda requisição encontra o vínculo já feito. O
 * currículo, quando colado, entra no MESMO commit do candidato.
 */
export async function createProfileAction(formData: FormData): Promise<CreateProfileResult> {
  const session = await guard("candidate:create");

  const parsed = parseOwnProfile({
    name: String(formData.get("name") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    location: String(formData.get("location") ?? ""),
    cv: String(formData.get("cv") ?? ""),
  });
  if (!parsed.ok) return parsed;

  // Endereço público opcional: em branco, deriva do nome.
  const rawSlug = String(formData.get("publicSlug") ?? "").trim();
  let publicSlug: string | null = null;
  if (rawSlug !== "") {
    const valid = validatePublicSlug(rawSlug);
    if (!valid.ok) return valid;
    publicSlug = valid.slug;
  }

  const result = await createOwnCandidate(session, { ...parsed.value, cvLabel: defaultCvLabel(), publicSlug });
  if (result.status === "no-account") return { ok: false, code: "unavailable" };
  if (result.status === "slug-taken") return { ok: false, code: "slugTaken" };
  if (result.status === "created" && parsed.value.cv !== null) {
    await requestCvRescore(result.candidateId);
    // Sem isto a primeira trilha e as primeiras notas esperavam a varredura do
    // dia seguinte — ou para sempre, quando ela falhava (#280).
    scoreAfterResponse();
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Nome público                                                                */
/* -------------------------------------------------------------------------- */

export type PublicNameResult = { ok: true } | { ok: false; code: NameError };

/**
 * Troca o nome que o perfil público mostra. O candidato vem da sessão
 * (`guardOwnCandidate`, sem id por parâmetro), e a guarda vem antes de ler o
 * formulário.
 */
export async function setPublicNameAction(formData: FormData): Promise<PublicNameResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const result = await setCandidateName(candidateId, String(formData.get("name") ?? ""));
  if (!result.ok) return result;
  revalidatePath("/candidate");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Endereço público                                                            */
/* -------------------------------------------------------------------------- */

export type PublicSlugResult = { ok: true } | { ok: false; code: PublicSlugError | "slugTaken" };

/**
 * Troca o endereço `/p/<slug>` do próprio perfil.
 *
 * O candidato vem da sessão (`guardOwnCandidate`, sem id por parâmetro). O
 * antigo deixa de responder na hora; ver `setPublicSlug` e a ADR 0024.
 */
export async function setPublicSlugAction(formData: FormData): Promise<PublicSlugResult> {
  const { candidateId } = await guardOwnCandidate("candidate:write");
  const result = await setPublicSlug(candidateId, String(formData.get("publicSlug") ?? ""));
  if (!result.ok) return result;
  revalidatePath("/candidate");
  return { ok: true };
}
