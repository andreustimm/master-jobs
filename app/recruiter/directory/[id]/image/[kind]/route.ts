import { readImageObject } from "../../../../../../src/core/candidate-image-read.ts";
import { allowlistedImageKey } from "../../../../../../src/core/candidate-public.ts";
import { DIRECTORY_VISIBILITIES } from "../../../../../../src/core/candidate-directory.ts";
import { isPublicImageKind } from "../../../../../../src/core/public-images.ts";
import { requirePage } from "../../../../../auth";
import { imageNotFound, imageResponse } from "../../../../../image-response";

/**
 * Foto e capa de um perfil do diretório (#465, ADR-013). A guarda vem antes
 * de tudo — recrutador autenticado, como a página —, e a decisão de servir é
 * a do `/p/`: `allowlistedImageKey()` reconfere, a cada requisição, a
 * visibilidade (Recrutadores ou Público, constante do servidor) e o opt-in do
 * tipo. Perfil Privado, sem opt-in ou id desconhecido: o mesmo 404 sem corpo.
 *
 * Não conta no limite da busca: cada perfil aberto pede até duas imagens, e a
 * página que as referencia já contou.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  await requirePage("candidate:discover");
  const { id, kind } = await context.params;
  if (!isPublicImageKind(kind) || !/^\d{1,10}$/.test(id)) return imageNotFound();
  const image = await readImageObject(await allowlistedImageKey({ id: Number(id) }, kind, DIRECTORY_VISIBILITIES));
  return image ? imageResponse(image) : imageNotFound();
}
