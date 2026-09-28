import { ownImageKey, readImageObject } from "../../../../src/core/candidate-images.ts";
import { isPublicImageKind } from "../../../../src/core/public-images.ts";
import { requireOwnCandidatePage } from "../../../auth";
import { imageNotFound, imageResponse } from "../../../image-response";

/**
 * Prévia da própria foto ou capa em `/candidate` (#327): a imagem gravada,
 * com ou sem opt-in e com o perfil em qualquer visibilidade — é o dono
 * olhando o que enviou. Sessão exigida e escopo vindo dela; não há id na URL
 * (regra 15).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const { kind } = await context.params;
  if (!isPublicImageKind(kind)) return imageNotFound();
  const image = await readImageObject(await ownImageKey(candidateId, kind));
  return image ? imageResponse(image) : imageNotFound();
}
