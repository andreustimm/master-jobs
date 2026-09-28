/**
 * Foto e capa do candidato (#327): gravar, remover e ler, pela porta de
 * armazenamento. Orquestração burra — as decisões estão em
 * `public-images.ts` (puro) e o reencode em `public-images-encode.ts`.
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
import { eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { candidate } from "./db/schema.ts";
import { encodePublicImage } from "./public-images-encode.ts";
import {
  checkUploadSize,
  isPublicImageKind,
  isServableImageType,
  publicImageKey,
  type PublicImageError,
  type PublicImageKind,
} from "./public-images.ts";
import { openStorage, type StorageTarget } from "./storage/index.ts";

export type ImageDeps = {
  storage: () => Promise<StorageTarget | null>;
  nonce: () => string;
};

const DEFAULT_DEPS: ImageDeps = {
  storage: () => openStorage(),
  nonce: () => randomBytes(16).toString("hex"),
};

export type PublicImageResult = { ok: true } | { ok: false; code: PublicImageError };

export type ServedImage = { body: Uint8Array; contentType: string };

const keyColumn = (kind: PublicImageKind) => (kind === "photo" ? candidate.photoKey : candidate.coverKey);

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
      .select({ key: keyColumn(kind) })
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
 * "mostrar" não pode exigir reenviar a imagem.
 */
export async function setPublicImage(
  candidateId: number,
  input: { kind: string; file: unknown; show: boolean },
  deps: ImageDeps = DEFAULT_DEPS,
): Promise<PublicImageResult> {
  const { kind, file, show } = input;
  if (!isPublicImageKind(kind)) return { ok: false, code: "invalidKind" };

  if (!(file instanceof Blob) || file.size === 0) {
    await getDb()
      .update(candidate)
      .set(kind === "photo" ? { publicPhoto: show, updatedAt: new Date().toISOString() } : { publicCover: show, updatedAt: new Date().toISOString() })
      .where(eq(candidate.id, candidateId));
    return { ok: true };
  }

  // O tamanho é recusado antes de ler um byte do arquivo.
  const sizeError = checkUploadSize(file.size);
  if (sizeError) return { ok: false, code: sizeError };
  const encoded = await encodePublicImage(kind, new Uint8Array(await file.arrayBuffer()));
  if (!encoded.ok) return encoded;

  const target = await deps.storage();
  if (!target) return { ok: false, code: "storageUnavailable" };
  const key = publicImageKey(candidateId, kind, deps.nonce());
  await target.storage.putObject({
    bucket: target.bucket,
    key,
    body: encoded.image.body,
    contentType: encoded.image.contentType,
    metadata: { width: String(encoded.image.width), height: String(encoded.image.height) },
  });

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
  const previous = await swapKey(candidateId, kindRaw, null, false);
  if (!previous) return { ok: true };
  const target = await deps.storage();
  if (!target) {
    console.warn(`[imagens] remoção: objeto ${previous} ficou no armazenamento, que não está configurado aqui`);
    return { ok: true };
  }
  await deleteQuietly(target, previous, "remoção");
  return { ok: true };
}

/** Lê o objeto de uma chave, ou `null` — ausente, tipo não servível ou sem armazenamento. */
export async function readImageObject(key: string | null, deps: ImageDeps = DEFAULT_DEPS): Promise<ServedImage | null> {
  if (!key) return null;
  const target = await deps.storage();
  if (!target) return null;
  const object = await target.storage.getObject({ bucket: target.bucket, key });
  if (!object || !isServableImageType(object.contentType)) return null;
  return { body: object.body, contentType: object.contentType };
}

/** A imagem do PRÓPRIO candidato, para a prévia em `/candidate` — com ou sem opt-in. */
export async function ownImageKey(candidateId: number, kind: PublicImageKind): Promise<string | null> {
  const [row] = await getDb()
    .select({ key: keyColumn(kind) })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1);
  return row?.key ?? null;
}
