/**
 * Foto e capa do candidato (#327): gravar e remover, pela porta de
 * armazenamento. Orquestração burra — as decisões estão em
 * `public-images.ts` (puro) e o reencode em `public-images-encode.ts`. A
 * leitura, que as rotas usam, mora em `candidate-image-read.ts`, sem `sharp`.
 *
 * **Ordem da troca.** Objeto novo primeiro, com chave nova; depois o banco
 * passa a apontar para ele (linha travada, para duas trocas simultâneas não
 * apagarem uma a foto da outra); só então o antigo é apagado. Se o banco
 * falhar, o objeto novo é apagado e nada muda. Se apagar o antigo falhar, ele
 * fica órfão, mas inalcançável: é privado no provedor, e a rota do app só
 * serve a chave que o banco aponta.
 *
 * **Quem chama escopa.** Toda função recebe o `candidateId` da SESSÃO
 * (`guardOwnCandidate`); nenhuma aceita id vindo de formulário (regra 15).
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { DEFAULT_READ_DEPS, imageKeyColumn, type ImageReadDeps } from "./candidate-image-read.ts";
import { getDb } from "./db/client.ts";
import { candidate } from "./db/schema.ts";
import { encodePublicImage } from "./public-images-encode.ts";
import {
  checkUploadSize,
  isPublicImageKind,
  publicImageKey,
  type PublicImageError,
  type PublicImageKind,
} from "./public-images.ts";
import type { StorageTarget } from "./storage/index.ts";

export type ImageDeps = ImageReadDeps & {
  nonce: () => string;
};

const DEFAULT_DEPS: ImageDeps = {
  ...DEFAULT_READ_DEPS,
  nonce: () => randomBytes(16).toString("hex"),
};

export type PublicImageResult = { ok: true } | { ok: false; code: PublicImageError };

function imageColumns(kind: PublicImageKind, key: string | null, show: boolean) {
  const updatedAt = new Date().toISOString();
  return kind === "photo"
    ? { photoKey: key, publicPhoto: show, updatedAt }
    : { coverKey: key, publicCover: show, updatedAt };
}

async function deleteQuietly(target: StorageTarget, key: string, why: string): Promise<void> {
  try {
    await target.storage.deleteObject({ bucket: target.bucket, key });
  } catch (error) {
    // O erro da porta já vem sem credencial (`StorageError`). Órfão privado
    // não vaza — a rota só serve a chave que o banco aponta —, mas ocupa
    // espaço: a linha no log é o que permite apagá-lo depois.
    console.warn(`[imagens] ${why}: objeto ${key} não apagado (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Troca a chave gravada e devolve a anterior, com a linha travada. */
async function swapKey(candidateId: number, kind: PublicImageKind, key: string | null, show: boolean): Promise<string | null> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ key: imageKeyColumn(kind) })
      .from(candidate)
      .where(eq(candidate.id, candidateId))
      .for("update")
      .limit(1);
    if (!row) throw new Error(`candidato ${candidateId} não encontrado`);
    await tx.update(candidate).set(imageColumns(kind, key, show)).where(eq(candidate.id, candidateId));
    return row.key;
  });
}

/**
 * Grava a foto ou a capa e o "mostrar no perfil público" dela.
 *
 * Sem arquivo, grava só o opt-in: é o mesmo formulário, e desmarcar
 * "mostrar" não pode exigir reenviar a imagem. Sem arquivo E sem imagem
 * gravada, recusa com `imageMissing` e não grava nada — "mostrar" ligado sem
 * imagem seria um consentimento para publicar o que vier depois, sem a
 * pessoa ver o quê.
 */
export async function setPublicImage(
  candidateId: number,
  input: { kind: string; file: unknown; show: boolean },
  deps: ImageDeps = DEFAULT_DEPS,
): Promise<PublicImageResult> {
  const { kind, file, show } = input;
  if (!isPublicImageKind(kind)) return { ok: false, code: "invalidKind" };

  if (!(file instanceof Blob) || file.size === 0) {
    const optIn = kind === "photo" ? { publicPhoto: show } : { publicCover: show };
    // Condição no próprio UPDATE: uma remoção concorrente entre "tem imagem?"
    // e a escrita não deixa o opt-in ligado sem chave.
    const updated = await getDb()
      .update(candidate)
      .set({ ...optIn, updatedAt: new Date().toISOString() })
      .where(and(eq(candidate.id, candidateId), isNotNull(imageKeyColumn(kind))))
      .returning({ id: candidate.id });
    return updated.length > 0 ? { ok: true } : { ok: false, code: "imageMissing" };
  }

  // O Next já recebeu o multipart inteiro (a Vercel barra acima de 4,5 MB
  // antes daqui); o teto é conferido antes de copiar os bytes e decodificar.
  const sizeError = checkUploadSize(file.size);
  if (sizeError) return { ok: false, code: sizeError };
  const encoded = await encodePublicImage(kind, new Uint8Array(await file.arrayBuffer()));
  if (!encoded.ok) return encoded;

  const target = await deps.storage();
  if (!target) return { ok: false, code: "storageUnavailable" };
  const key = publicImageKey(candidateId, kind, deps.nonce());
  try {
    await target.storage.putObject({
      bucket: target.bucket,
      key,
      body: encoded.image.body,
      contentType: encoded.image.contentType,
      metadata: { width: String(encoded.image.width), height: String(encoded.image.height) },
    });
  } catch (error) {
    // Escrita em duas partes (no Blob, objeto e metadado irmão): a primeira
    // pode ter ficado. Registra e tenta apagar; o banco não aponta para ela.
    console.warn(`[imagens] envio falhou: objeto ${key} pode ter ficado parcial; apagando`);
    await deleteQuietly(target, key, "envio incompleto");
    throw error;
  }

  let previous: string | null;
  try {
    previous = await swapKey(candidateId, kind, key, show);
  } catch (error) {
    await deleteQuietly(target, key, "troca não gravada");
    throw error;
  }
  if (previous && previous !== key) await deleteQuietly(target, previous, "troca");
  return { ok: true };
}

/**
 * Remove a imagem: o banco esquece a chave e o opt-in volta a desligado — uma
 * imagem nova enviada depois não sai no perfil sem a pessoa marcar de novo.
 */
export async function removePublicImage(
  candidateId: number,
  kindRaw: string,
  deps: ImageDeps = DEFAULT_DEPS,
): Promise<PublicImageResult> {
  if (!isPublicImageKind(kindRaw)) return { ok: false, code: "invalidKind" };
  // Armazenamento aberto ANTES de esquecer a chave: configuração inválida
  // falha aqui, com o banco intacto, e não deixa um objeto sem registro.
  const target = await deps.storage();
  const previous = await swapKey(candidateId, kindRaw, null, false);
  if (!previous) return { ok: true };
  if (!target) {
    console.warn(`[imagens] remoção: objeto ${previous} ficou no armazenamento, que não está configurado aqui`);
    return { ok: true };
  }
  await deleteQuietly(target, previous, "remoção");
  return { ok: true };
}
