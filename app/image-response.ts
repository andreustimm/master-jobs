import type { ServedImage } from "../src/core/candidate-images.ts";

/**
 * Respostas das rotas de imagem do perfil (#327), públicas e da prévia.
 *
 * **`no-store`**: a foto é pública por uma escolha revogável. Guardada no
 * cache do navegador, de um proxy ou da CDN, ela continuaria servida depois
 * de a pessoa tornar o perfil privado ou desmarcar "mostrar" — é a mesma
 * razão pela qual o service worker não guarda `/p/` (G14). Cada visita
 * pergunta de novo ao banco; a imagem já sai pequena do reencode.
 *
 * **`same-origin`** em `Cross-Origin-Resource-Policy`: outro site não embute a
 * foto (nem mede se ela existe) a partir do navegador de quem o visita.
 */
const COMMON = {
  "cache-control": "private, no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow",
  "cross-origin-resource-policy": "same-origin",
};

export function imageResponse(image: ServedImage): Response {
  return new Response(new Blob([Buffer.from(image.body)]), {
    status: 200,
    headers: {
      ...COMMON,
      "content-type": image.contentType,
      "content-length": String(image.body.byteLength),
      "content-disposition": "inline",
    },
  });
}

/**
 * Um 404 só, sem corpo, para qualquer motivo — perfil inexistente, privado,
 * endereço trocado, sem opt-in ou sem imagem. Distinguir diria quais
 * endereços existem (G22).
 */
export function imageNotFound(): Response {
  return new Response(null, { status: 404, headers: COMMON });
}
