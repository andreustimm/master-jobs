/**
 * Foto e capa do perfil público (#327): as regras que decidem, sem banco,
 * rede, relógio nem biblioteca de imagem (G05).
 *
 * **O tipo vem da assinatura, não do que o navegador declarou.** `file.type`
 * e a extensão são texto do cliente; os primeiros bytes são o arquivo. Um SVG
 * renomeado para `.png` (script dentro de "imagem") para aqui.
 *
 * **O arquivo guardado nunca é o enviado.** Todo upload é decodificado e
 * reencodado em WebP no tamanho fixo do tipo (`IMAGE_SPEC`), o que remove
 * EXIF, XMP e IPTC — inclusive a localização da câmera — e normaliza o que o
 * perfil serve. O reencode mora em `public-images-encode.ts`; aqui ficam os
 * limites que ele aplica.
 *
 * **Chave nova a cada envio** (`publicImageKey`): quem guardou a URL do
 * objeto antigo não ganha a foto nova, e o antigo é apagado na troca.
 */

export const PUBLIC_IMAGE_KINDS = ["photo", "cover"] as const;
export type PublicImageKind = (typeof PUBLIC_IMAGE_KINDS)[number];

export function isPublicImageKind(value: unknown): value is PublicImageKind {
  return typeof value === "string" && (PUBLIC_IMAGE_KINDS as readonly string[]).includes(value);
}

/** Teto do arquivo enviado. A action do Next aceita 11 MB; a imagem, bem menos. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_MEGABYTES = IMAGE_MAX_BYTES / (1024 * 1024);

/**
 * Lado máximo aceito na entrada. Protege o decodificador de "bomba de
 * descompressão" (um PNG de poucos KB que abre em 50 mil × 50 mil) antes de
 * alocar a imagem inteira.
 */
export const IMAGE_MAX_SIDE = 8000;

/**
 * O que cada tipo vira: tamanho de saída (recorte central) e o mínimo de
 * entrada — abaixo dele a ampliação ficaria borrada no perfil.
 */
export const IMAGE_SPEC: Record<PublicImageKind, { width: number; height: number; minWidth: number; minHeight: number }> = {
  photo: { width: 512, height: 512, minWidth: 128, minHeight: 128 },
  cover: { width: 1600, height: 400, minWidth: 800, minHeight: 200 },
};

/** O único tipo que o armazenamento recebe: todo upload é reencodado nele. */
export const PUBLIC_IMAGE_CONTENT_TYPE = "image/webp";

export type ImageFormat = "jpeg" | "png" | "webp";

export type PublicImageError =
  | "invalidKind"
  | "imageMissing"
  | "imageTooLarge"
  | "imageType"
  | "imageTooSmall"
  | "imageTooBig"
  | "imageUnreadable"
  | "storageUnavailable";

/** Assinatura dos três formatos aceitos; qualquer outra coisa é `null`. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

/** Tamanho do arquivo, antes de ler um byte dele. */
export function checkUploadSize(size: number): PublicImageError | null {
  if (size <= 0) return "imageMissing";
  if (size > IMAGE_MAX_BYTES) return "imageTooLarge";
  return null;
}

/** Dimensão já com a orientação da câmera aplicada (retrato deitado conta em pé). */
export function checkImageDimensions(kind: PublicImageKind, width: number, height: number): PublicImageError | null {
  if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE) return "imageTooBig";
  const spec = IMAGE_SPEC[kind];
  if (width < spec.minWidth || height < spec.minHeight) return "imageTooSmall";
  return null;
}

/**
 * A chave do objeto. `nonce` vem de quem compõe (aleatório); o domínio não
 * sorteia. O id do candidato fica na chave, e a chave nunca sai do servidor:
 * a URL pública é `/p/<endereço>/image/<tipo>`.
 */
export function publicImageKey(candidateId: number, kind: PublicImageKind, nonce: string): string {
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) throw new TypeError("candidato inválido");
  if (!/^[a-z0-9]{16,64}$/.test(nonce)) throw new TypeError("nonce inválido");
  return `candidates/${candidateId}/${kind}/${nonce}.webp`;
}

/** O que a rota aceita servir: só imagem raster. Qualquer outro tipo guardado vira 404. */
export function isServableImageType(contentType: string): boolean {
  return contentType === "image/webp" || contentType === "image/jpeg" || contentType === "image/png";
}

/** Colunas de imagem de uma linha de `candidate`, como a leitura as traz. */
export type StoredImages = {
  photoKey: string | null;
  coverKey: string | null;
  publicPhoto: boolean | null;
  publicCover: boolean | null;
};

/**
 * A chave que pode sair publicamente, por tipo: só com opt-in `=== true`
 * (nulo da importação legada é desligado) E objeto gravado. A visibilidade do
 * perfil é conferida antes, por quem chama — esta função não a enxerga.
 */
export function publicImageKeyFrom(row: StoredImages, kind: PublicImageKind): string | null {
  const [key, shown] = kind === "photo" ? [row.photoKey, row.publicPhoto] : [row.coverKey, row.publicCover];
  return shown === true && key ? key : null;
}
