/**
 * Reencode da foto e da capa (#327) com `sharp` — o mesmo libvips que o Next
 * já traz para otimizar imagem; a dependência direta só fixa a versão que ele
 * resolve, sem pacote novo no lockfile.
 *
 * Por que reencodar em vez de "tirar o EXIF": remover metadado de JPEG, PNG e
 * WebP à mão é três parsers, e cada um tem um canto (XMP no PNG, EXIF no
 * chunk do WebP) por onde a localização passa. Decodificar em pixels e
 * escrever um WebP novo não carrega nada que não seja pixel: o `sharp` só
 * copia metadado quando se pede (`keepMetadata`/`withMetadata`), e aqui não
 * se pede. A orientação da câmera é aplicada ANTES (`rotate()`), senão a foto
 * sairia deitada ao perder o EXIF que a endireitava.
 */
import sharp from "sharp";
import {
  checkImageDimensions,
  checkUploadSize,
  IMAGE_MAX_PIXELS,
  IMAGE_SPEC,
  PUBLIC_IMAGE_CONTENT_TYPE,
  sniffImageFormat,
  type PublicImageError,
  type PublicImageKind,
} from "./public-images.ts";

export type EncodedImage = {
  body: Uint8Array;
  contentType: typeof PUBLIC_IMAGE_CONTENT_TYPE;
  width: number;
  height: number;
};

const WEBP_QUALITY = 82;

export async function encodePublicImage(
  kind: PublicImageKind,
  bytes: Uint8Array,
): Promise<{ ok: true; image: EncodedImage } | { ok: false; code: PublicImageError }> {
  const sizeError = checkUploadSize(bytes.byteLength);
  if (sizeError) return { ok: false, code: sizeError };
  const format = sniffImageFormat(bytes);
  if (format === null) return { ok: false, code: "imageType" };

  // `limitInputPixels` recusa antes de alocar; `failOn: "error"` recusa
  // arquivo truncado em vez de devolver meia imagem cinza.
  // `metadata()` só lê o cabeçalho; a dimensão é conferida antes de decodificar.
  const options = { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" as const };
  let width: number;
  let height: number;
  try {
    const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
    // Assinatura de um formato e conteúdo de outro é arquivo forjado.
    if (meta.format !== format) return { ok: false, code: "imageType" };
    ({ width, height } = meta.autoOrient);
  } catch {
    return { ok: false, code: "imageUnreadable" };
  }
  const dimensionError = checkImageDimensions(kind, width, height);
  if (dimensionError) return { ok: false, code: dimensionError };

  const spec = IMAGE_SPEC[kind];
  try {
    const { data, info } = await sharp(bytes, options)
      .rotate()
      .resize(spec.width, spec.height, { fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      image: { body: new Uint8Array(data), contentType: PUBLIC_IMAGE_CONTENT_TYPE, width: info.width, height: info.height },
    };
  } catch {
    return { ok: false, code: "imageUnreadable" };
  }
}
