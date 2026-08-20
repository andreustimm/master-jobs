"use server";

import { revalidatePath } from "next/cache";
import { guardOwnCandidate } from "../auth";
import { setVisibility } from "../../src/core/candidate.ts";
import {
  deleteDocument,
  documentById,
  renameDocument,
  restoreDocument,
  saveDocument,
  type VersionError,
} from "../../src/core/candidate.ts";

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
  const label = String(formData.get("label") ?? "").trim() || `CV ${new Date().toISOString().slice(0, 10)}`;

  if (content.length < 100) {
    throw new Error("O texto é curto demais para ser um currículo (mínimo 100 caracteres).");
  }

  // The id comes from the guard, never from the form: a candidate id in
  // FormData is a request, not a proof.
  await saveDocument({ candidateId, kind: "cv", label, content, format: "text" });

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
  if (result.ok) revalidatePath("/candidate");
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

  revalidatePath("/candidate");
}
