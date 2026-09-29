/**
 * Leitura da foto e da capa (#327), para as rotas que servem a imagem.
 *
 * Separada de `candidate-images.ts` de propósito: a gravação importa o
 * reencode (`sharp`, libvips nativo), e a rota pública — a mais chamada, sem
 * sessão — não pode carregar um decodificador de imagem que ela nunca usa.
 * Este módulo só conhece o banco e a porta de armazenamento; um teste confere
 * que o grafo de imports das duas rotas não alcança o encoder.
 */
import { eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { candidate } from "./db/schema.ts";
import { isServableImageType, type PublicImageKind } from "./public-images.ts";
import { openStorage, type StorageTarget } from "./storage/index.ts";

export type ImageReadDeps = {
  storage: () => Promise<StorageTarget | null>;
};

export const DEFAULT_READ_DEPS: ImageReadDeps = { storage: () => openStorage() };

export type ServedImage = { body: Uint8Array; contentType: string };

export const imageKeyColumn = (kind: PublicImageKind) =>
  kind === "photo" ? candidate.photoKey : candidate.coverKey;

/**
 * Lê o objeto de uma chave, ou `null` — ausente, tipo não servível ou sem
 * armazenamento. Sem metadados: servir a imagem só precisa do corpo e do
 * tipo, e no Blob o metadado custaria uma leitura a mais por visita.
 */
export async function readImageObject(
  key: string | null,
  deps: ImageReadDeps = DEFAULT_READ_DEPS,
): Promise<ServedImage | null> {
  if (!key) return null;
  const target = await deps.storage();
  if (!target) return null;
  const object = await target.storage.getObject({ bucket: target.bucket, key }, { metadata: false });
  if (!object || !isServableImageType(object.contentType)) return null;
  return { body: object.body, contentType: object.contentType };
}

/** A imagem do PRÓPRIO candidato, para a prévia em `/candidate` — com ou sem opt-in. */
export async function ownImageKey(candidateId: number, kind: PublicImageKind): Promise<string | null> {
  const [row] = await getDb()
    .select({ key: imageKeyColumn(kind) })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1);
  return row?.key ?? null;
}
