import { readImageObject } from "../../../../../src/core/candidate-images.ts";
import { publicImageKeyForSlug } from "../../../../../src/core/candidate-public.ts";
import { isPublicImageKind } from "../../../../../src/core/public-images.ts";
import { imageNotFound, imageResponse } from "../../../../image-response";

/**
 * Foto e capa do perfil público (#327), servidas pelo app — nunca por URL do
 * provedor. O objeto é privado no armazenamento; quem decide se ele sai é
 * esta rota, a CADA requisição:
 *
 * - `publicImageKeyForSlug()` confere `public_slug` (nunca o `slug` interno),
 *   `visibility = public` e o opt-in daquele tipo — a mesma lista de
 *   permissão de `/p/[slug]` (G21);
 * - perfil que ficou privado, endereço trocado ou opt-in desligado responde
 *   o mesmo 404 da ausência, inclusive para quem guardou a URL (G22);
 * - `no-store` em toda resposta, e o service worker não guarda `/p/` (G14).
 *
 * Sem sessão por necessidade: é conteúdo público como a página. A exceção
 * está registrada em `tests/architecture.test.ts` (G39), e o limite por IP é
 * o do proxy, em balde próprio para as imagens.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await context.params;
  if (!isPublicImageKind(kind)) return imageNotFound();
  const image = await readImageObject(await publicImageKeyForSlug(slug, kind));
  return image ? imageResponse(image) : imageNotFound();
}
