import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodePublicImage } from "../src/core/public-images-encode.ts";
import {
  checkImageDimensions,
  checkUploadSize,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_SIDE,
  isPublicImageKind,
  isServableImageType,
  publicImageKey,
  publicImageKeyFrom,
  sniffImageFormat,
} from "../src/core/public-images.ts";

/**
 * #327 — regras da foto e da capa (puras) e o reencode com `sharp`.
 *
 * O reencode é a garantia de que a localização da câmera não sai: os testes
 * montam JPEG e WebP com EXIF de GPS, XMP e orientação, e conferem o que
 * sobra no arquivo gravado.
 */

async function image(
  format: "jpeg" | "png" | "webp",
  width: number,
  height: number,
  withGps = false,
  orientation?: number,
): Promise<Uint8Array> {
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  if (withGps) {
    pipeline = pipeline.withExifMerge({
      IFD0: { Copyright: "Câmera da Pia" },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "46/1 38/1 0/1" },
    });
  }
  const out = format === "jpeg" ? pipeline.jpeg() : format === "png" ? pipeline.png() : pipeline.webp();
  return new Uint8Array(await out.toBuffer());
}

describe("regras puras", () => {
  it("tipo só photo ou cover", () => {
    expect(isPublicImageKind("photo")).toBe(true);
    expect(isPublicImageKind("cover")).toBe(true);
    for (const value of ["", "avatar", "PHOTO", null, 1]) expect(isPublicImageKind(value)).toBe(false);
  });

  it("formato pela assinatura, não pelo nome nem pelo tipo declarado", async () => {
    expect(sniffImageFormat(await image("jpeg", 8, 8))).toBe("jpeg");
    expect(sniffImageFormat(await image("png", 8, 8))).toBe("png");
    expect(sniffImageFormat(await image("webp", 8, 8))).toBe("webp");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageFormat(svg)).toBeNull();
    expect(sniffImageFormat(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // RIFF de áudio não é WebP.
    expect(sniffImageFormat(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });

  it("tamanho recusado antes de ler o arquivo", () => {
    expect(checkUploadSize(0)).toBe("imageMissing");
    expect(checkUploadSize(IMAGE_MAX_BYTES)).toBeNull();
    expect(checkUploadSize(IMAGE_MAX_BYTES + 1)).toBe("imageTooLarge");
  });

  it("dimensão mínima por tipo e máxima comum", () => {
    expect(checkImageDimensions("photo", 128, 128)).toBeNull();
    expect(checkImageDimensions("photo", 127, 400)).toBe("imageTooSmall");
    expect(checkImageDimensions("cover", 800, 200)).toBeNull();
    expect(checkImageDimensions("cover", 799, 400)).toBe("imageTooSmall");
    expect(checkImageDimensions("cover", 2000, 199)).toBe("imageTooSmall");
    expect(checkImageDimensions("photo", IMAGE_MAX_SIDE + 1, 500)).toBe("imageTooBig");
  });

  it("chave nova por envio, com o tipo e sem nada vindo do usuário", () => {
    expect(publicImageKey(7, "photo", "a".repeat(32))).toBe(`candidates/7/photo/${"a".repeat(32)}.webp`);
    expect(() => publicImageKey(0, "photo", "a".repeat(32))).toThrow(TypeError);
    expect(() => publicImageKey(7, "photo", "../../x")).toThrow(TypeError);
    expect(() => publicImageKey(7, "cover", "curto")).toThrow(TypeError);
  });

  it("só sai chave com opt-in === true e objeto gravado; nulo é desligado", () => {
    const base = { photoKey: "k/p.webp", coverKey: "k/c.webp", publicPhoto: true, publicCover: null };
    expect(publicImageKeyFrom(base, "photo")).toBe("k/p.webp");
    expect(publicImageKeyFrom(base, "cover")).toBeNull();
    expect(publicImageKeyFrom({ ...base, publicPhoto: false }, "photo")).toBeNull();
    expect(publicImageKeyFrom({ ...base, photoKey: null }, "photo")).toBeNull();
    expect(publicImageKeyFrom({ ...base, publicCover: true }, "cover")).toBe("k/c.webp");
  });

  it("a rota só serve imagem raster", () => {
    for (const type of ["image/webp", "image/jpeg", "image/png"]) expect(isServableImageType(type)).toBe(true);
    for (const type of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
      expect(isServableImageType(type)).toBe(false);
    }
  });
});

describe("reencode", () => {
  it("remove EXIF (GPS inclusive), XMP e ICC, e grava WebP no tamanho do tipo", async () => {
    const input = await image("jpeg", 900, 700, true, 1);
    const before = await sharp(input).metadata();
    expect(before.exif?.byteLength ?? 0).toBeGreaterThan(0);
    expect(Buffer.from(before.exif!).includes(Buffer.from("Pia"))).toBe(true);

    const result = await encodePublicImage("photo", input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = await sharp(result.image.body).metadata();
    expect(after.format).toBe("webp");
    expect([after.width, after.height]).toEqual([512, 512]);
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(Buffer.from(result.image.body).includes(Buffer.from("Pia"))).toBe(false);
    expect(result.image).toMatchObject({ contentType: "image/webp", width: 512, height: 512 });
  });

  it("aplica a orientação da câmera antes de descartá-la", async () => {
    // 1000×300 com Orientation 6 é um retrato 300×1000: como capa (4:1),
    // passa pelo mínimo de largura só se NÃO for girado — e a regra mede
    // a imagem como a pessoa a vê.
    const rotated = await image("jpeg", 1000, 300, true, 6);
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const result = await encodePublicImage("cover", rotated);
    expect(result.ok ? "aceitou deitada" : result.code).toBe("imageTooSmall");
    // A mesma imagem sem a marca de orientação é uma capa válida.
    expect((await encodePublicImage("cover", await image("jpeg", 1000, 300))).ok).toBe(true);
  });

  it("a foto sai em pé: a rotação da câmera é aplicada nos pixels", async () => {
    // Metade esquerda vermelha, direita azul, gravada deitada (Orientation 6
    // = girar 90° no sentido horário para ver). Em pé, o vermelho fica EM
    // CIMA e o azul EMBAIXO; sem aplicar a rotação, cima e baixo do centro
    // teriam a mesma cor.
    const half = { create: { width: 200, height: 300, channels: 3 as const, background: { r: 0, g: 0, b: 255 } } };
    const sideways = new Uint8Array(
      await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } } })
        .composite([{ input: half, left: 200, top: 0 }])
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    const result = await encodePublicImage("photo", sideways);
    if (!result.ok) throw new Error(result.code);
    const { data, info } = await sharp(result.image.body).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [topRed, , topBlue] = pixel(256, 20);
    const [bottomRed, , bottomBlue] = pixel(256, 490);
    expect(topRed).toBeGreaterThan(200);
    expect(topBlue).toBeLessThan(60);
    expect(bottomBlue).toBeGreaterThan(200);
    expect(bottomRed).toBeLessThan(60);
  });

  it("capa sai 1600×400, de PNG ou WebP", async () => {
    for (const format of ["png", "webp"] as const) {
      const result = await encodePublicImage("cover", await image(format, 1200, 600));
      expect(result.ok && [result.image.width, result.image.height]).toEqual([1600, 400]);
    }
  });

  it("recusa pelo código: vazio, grande, tipo, pequena, arquivo forjado ou truncado", async () => {
    expect(await encodePublicImage("photo", new Uint8Array())).toEqual({ ok: false, code: "imageMissing" });
    expect(await encodePublicImage("photo", new Uint8Array(IMAGE_MAX_BYTES + 1))).toEqual({ ok: false, code: "imageTooLarge" });
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'/>");
    expect(await encodePublicImage("photo", svg)).toEqual({ ok: false, code: "imageType" });
    expect(await encodePublicImage("photo", await image("png", 100, 100))).toEqual({ ok: false, code: "imageTooSmall" });

    // Assinatura de PNG na frente de um JPEG: formato declarado ≠ conteúdo.
    const jpeg = await image("jpeg", 300, 300);
    const forged = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...jpeg]);
    const forgedResult = await encodePublicImage("photo", forged);
    expect(forgedResult.ok).toBe(false);

    const truncated = (await image("png", 400, 400)).slice(0, 120);
    expect(await encodePublicImage("photo", truncated)).toEqual({ ok: false, code: "imageUnreadable" });
  });

  it("recusa lado acima do teto sem decodificar a imagem inteira", async () => {
    const tall = await image("png", 10, IMAGE_MAX_SIDE + 1);
    expect(await encodePublicImage("photo", tall)).toEqual({ ok: false, code: "imageTooBig" });
  });
});
