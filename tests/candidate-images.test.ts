import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureCandidate, getCandidateById, setPublicSlug, setVisibility } from "../src/core/candidate.ts";
import { publicImageKeyForSlug, publicProfile } from "../src/core/candidate-public.ts";
import { removePublicImage, setPublicImage } from "../src/core/candidate-images.ts";
import { vercelBlobStorage } from "../src/core/storage/infra/vercel-blob.ts";
import type { StorageTarget } from "../src/core/storage/index.ts";
import { fakeBlobSdk, type FakeBlob } from "./support/storage-fakes.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * #327 — foto e capa de ponta a ponta no servidor: action → caso de uso →
 * porta (Vercel Blob com SDK dublado) → banco, e as duas rotas que servem.
 *
 * O armazenamento é trocado no ponto de composição (`openStorage`), o mesmo
 * que `JHO_STORAGE_DRIVER` decide em produção: o código sob teste é o real.
 */
const TOKEN = "vercel_blob_rw_TESTE_segredo";
const state = vi.hoisted(() => ({
  candidateId: null as number | null,
  guarded: 0,
  target: null as unknown,
}));

vi.mock("../src/core/storage/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/storage/index.ts")>()),
  openStorage: async () => state.target,
}));
vi.mock("../app/auth", () => ({
  guard: async () => {
    throw new Error("não usado aqui");
  },
  guardOwnCandidate: async () => {
    state.guarded += 1;
    if (state.candidateId === null) throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
    return { session: {}, candidateId: state.candidateId };
  },
  requireOwnCandidatePage: async () => {
    state.guarded += 1;
    if (state.candidateId === null) throw new Error("NEXT_REDIRECT;/login");
    return { session: {}, candidateId: state.candidateId };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { savePublicImageAction } = await import("../app/candidate/actions.ts");
const publicRoute = await import("../app/p/[slug]/image/[kind]/route.ts");
const ownRoute = await import("../app/candidate/image/[kind]/route.ts");

let blob: FakeBlob;
let target: StorageTarget;

async function photoFile(width = 600, height = 600, name = "foto.jpg"): Promise<File> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

function objectKeys(): string[] {
  return [...blob.store.keys()].filter((key) => !key.startsWith(".metadata/")).sort();
}

async function publicCandidate(slug = "maria-silva"): Promise<number> {
  const id = await ensureCandidate({ slug: `interno-${slug}`, name: "Maria Silva" });
  expect(await setPublicSlug(id, slug)).toMatchObject({ ok: true });
  expect(await setVisibility(id, "public")).toMatchObject({ ok: true });
  return id;
}

const getPublic = (slug: string, kind: string) =>
  publicRoute.GET(new Request(`http://127.0.0.1/p/${slug}/image/${kind}`), { params: Promise.resolve({ slug, kind }) });
const getOwn = (kind: string) =>
  ownRoute.GET(new Request(`http://127.0.0.1/candidate/image/${kind}`), { params: Promise.resolve({ kind }) });

beforeEach(async () => {
  await useTestDb();
  blob = fakeBlobSdk(TOKEN);
  target = { storage: vercelBlobStorage(blob.sdk, TOKEN), bucket: "master-jobs" };
  state.target = target;
  state.candidateId = null;
  state.guarded = 0;
});

afterEach(async () => {
  await releaseTestDb();
});

describe("setPublicImage / removePublicImage", () => {
  it("grava WebP sem EXIF sob chave do candidato, e o banco guarda só a chave", async () => {
    const id = await publicCandidate();
    expect(await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true })).toEqual({ ok: true });

    const row = await getCandidateById(id);
    expect(row?.photoKey).toMatch(new RegExp(`^candidates/${id}/photo/[a-f0-9]{32}\\.webp$`));
    expect(row?.publicPhoto).toBe(true);
    expect(row?.coverKey).toBeNull();
    expect(objectKeys()).toEqual([`master-jobs/${row!.photoKey}`]);

    const stored = await target.storage.getObject({ bucket: "master-jobs", key: row!.photoKey! });
    expect(stored?.contentType).toBe("image/webp");
    expect(stored?.metadata).toEqual({ width: "512", height: "512" });
    expect((await sharp(stored!.body).metadata()).exif).toBeUndefined();
  });

  it("trocar grava chave nova e apaga o objeto antigo", async () => {
    const id = await publicCandidate();
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });
    const first = (await getCandidateById(id))!.photoKey!;
    await setPublicImage(id, { kind: "photo", file: await photoFile(700, 700), show: true });
    const second = (await getCandidateById(id))!.photoKey!;

    expect(second).not.toBe(first);
    expect(objectKeys()).toEqual([`master-jobs/${second}`]);
  });

  it("remover apaga o objeto e desliga o opt-in, sem tocar na outra imagem", async () => {
    const id = await publicCandidate();
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });
    await setPublicImage(id, { kind: "cover", file: await photoFile(1600, 500), show: true });
    const cover = (await getCandidateById(id))!.coverKey!;

    expect(await removePublicImage(id, "photo")).toEqual({ ok: true });
    expect(await getCandidateById(id)).toMatchObject({ photoKey: null, publicPhoto: false, coverKey: cover, publicCover: true });
    expect(objectKeys()).toEqual([`master-jobs/${cover}`]);
    // Remover de novo é inofensivo.
    expect(await removePublicImage(id, "photo")).toEqual({ ok: true });
  });

  it("sem arquivo grava só o opt-in, sem falar com o armazenamento", async () => {
    const id = await publicCandidate();
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });
    const calls = blob.calls.length;
    expect(await setPublicImage(id, { kind: "photo", file: null, show: false })).toEqual({ ok: true });
    expect(await setPublicImage(id, { kind: "cover", file: new File([], "vazio.png"), show: true })).toEqual({ ok: true });
    expect(blob.calls.length).toBe(calls);
    expect(await getCandidateById(id)).toMatchObject({ publicPhoto: false, publicCover: true, coverKey: null });
  });

  it("recusa pelo código antes de gravar qualquer coisa", async () => {
    const id = await publicCandidate();
    const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "foto.png", { type: "image/png" });
    expect(await setPublicImage(id, { kind: "photo", file: svg, show: true })).toEqual({ ok: false, code: "imageType" });
    expect(await setPublicImage(id, { kind: "avatar", file: await photoFile(), show: true })).toEqual({
      ok: false,
      code: "invalidKind",
    });
    expect(await removePublicImage(id, "avatar")).toEqual({ ok: false, code: "invalidKind" });
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.jpg", { type: "image/jpeg" });
    expect(await setPublicImage(id, { kind: "photo", file: huge, show: true })).toEqual({ ok: false, code: "imageTooLarge" });
    expect(await setPublicImage(id, { kind: "cover", file: await photoFile(600, 600), show: true })).toEqual({
      ok: false,
      code: "imageTooSmall",
    });
    expect(blob.calls).toEqual([]);
    expect(await getCandidateById(id)).toMatchObject({ photoKey: null, publicPhoto: false, publicCover: false });
  });

  it("sem armazenamento configurado responde storageUnavailable e não grava", async () => {
    const id = await publicCandidate();
    state.target = null;
    expect(await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true })).toEqual({
      ok: false,
      code: "storageUnavailable",
    });
    expect(await getCandidateById(id)).toMatchObject({ photoKey: null, publicPhoto: false });
  });

  it("banco que falha depois do envio: o objeto novo é apagado e nada muda", async () => {
    await expect(setPublicImage(999_999, { kind: "photo", file: await photoFile(), show: true })).rejects.toThrow(/não encontrado/);
    expect(objectKeys()).toEqual([]);
  });

  it("apagar o antigo falhando não desfaz a troca: órfão privado, só registrado", async () => {
    const id = await publicCandidate();
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });
    const first = (await getCandidateById(id))!.photoKey!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const del = blob.sdk.del;
    blob.sdk.del = (async () => {
      throw new Error(`falhou com ${TOKEN}`);
    }) as typeof del;
    let logged = "";
    try {
      expect(await setPublicImage(id, { kind: "photo", file: await photoFile(700, 700), show: true })).toEqual({ ok: true });
      logged = warn.mock.calls.flat().join(" ");
    } finally {
      blob.sdk.del = del;
      warn.mockRestore();
    }
    expect((await getCandidateById(id))!.photoKey).not.toBe(first);
    expect(logged).toContain(first);
    expect(logged).not.toContain(TOKEN);
  });
});

describe("lista de permissão da imagem pública", () => {
  it("só sai com perfil público E opt-in; endereço trocado, privado e nulo não saem", async () => {
    const id = await publicCandidate("maria-silva");
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: false });
    expect(await publicImageKeyForSlug("maria-silva", "photo")).toBeNull();
    expect((await publicProfile("maria-silva"))?.images).toEqual({ photo: null, cover: null });

    await setPublicImage(id, { kind: "photo", file: null, show: true });
    const key = (await getCandidateById(id))!.photoKey;
    expect(await publicImageKeyForSlug("maria-silva", "photo")).toBe(key);
    expect(await publicImageKeyForSlug("maria-silva", "cover")).toBeNull();
    const version = (await publicProfile("maria-silva"))?.images.photo;
    expect(version).toMatch(/^[a-f0-9]{16}$/);
    // A versão não é a chave, nem a contém.
    expect(key).not.toContain(version!);

    await setVisibility(id, "recruiters");
    expect(await publicImageKeyForSlug("maria-silva", "photo")).toBeNull();
    await setVisibility(id, "public");
    await setPublicSlug(id, "maria-nova");
    expect(await publicImageKeyForSlug("maria-silva", "photo")).toBeNull();
    expect(await publicImageKeyForSlug("maria-nova", "photo")).toBe(key);
    expect(await publicImageKeyForSlug("ninguem", "photo")).toBeNull();
  });
});

describe("rota pública /p/[slug]/image/[kind]", () => {
  it("serve a imagem com opt-in, sem cache, e o mesmo 404 para qualquer recusa — inclusive pela URL antiga", async () => {
    const id = await publicCandidate("maria-silva");
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });

    const ok = await getPublic("maria-silva", "photo");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(ok.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await sharp(new Uint8Array(await ok.arrayBuffer())).metadata()).format).toBe("webp");

    const refusals: Response[] = [];
    refusals.push(await getPublic("maria-silva", "cover")); // sem capa
    refusals.push(await getPublic("maria-silva", "avatar")); // tipo desconhecido
    refusals.push(await getPublic("ninguem", "photo")); // endereço inexistente
    await setPublicImage(id, { kind: "photo", file: null, show: false });
    refusals.push(await getPublic("maria-silva", "photo")); // opt-in desligado
    await setPublicImage(id, { kind: "photo", file: null, show: true });
    await setVisibility(id, "private");
    refusals.push(await getPublic("maria-silva", "photo")); // perfil privado, mesma URL

    const shapes = await Promise.all(
      refusals.map(async (response) => ({
        status: response.status,
        body: await response.text(),
        headers: [...response.headers.entries()].sort(),
      })),
    );
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
    expect(shapes[0]).toMatchObject({ status: 404, body: "" });
  });

  it("tipo guardado que não é imagem raster vira 404", async () => {
    const id = await publicCandidate("maria-silva");
    await setPublicImage(id, { kind: "photo", file: await photoFile(), show: true });
    const key = (await getCandidateById(id))!.photoKey!;
    await target.storage.putObject({ bucket: "master-jobs", key, body: new TextEncoder().encode("<svg/>"), contentType: "image/svg+xml" });
    expect((await getPublic("maria-silva", "photo")).status).toBe(404);
  });
});

describe("prévia do dono /candidate/image/[kind]", () => {
  it("mostra a própria imagem mesmo privada e sem opt-in; sem imagem é 404", async () => {
    const id = await ensureCandidate({ slug: "privada", name: "Pia" });
    state.candidateId = id;
    await setPublicImage(id, { kind: "cover", file: await photoFile(1600, 500), show: false });

    const cover = await getOwn("cover");
    expect(cover.status).toBe(200);
    expect(cover.headers.get("cache-control")).toContain("no-store");
    expect((await getOwn("photo")).status).toBe(404);
    expect((await getOwn("avatar")).status).toBe(404);
  });

  it("sem sessão própria, redireciona antes de ler", async () => {
    await expect(getOwn("photo")).rejects.toThrow(/NEXT_REDIRECT/);
    expect(blob.calls).toEqual([]);
  });
});

describe("savePublicImageAction", () => {
  function form(fields: Record<string, string | File>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  it("grava no candidato da sessão e ignora id no formulário (regra 15)", async () => {
    const id = await publicCandidate("maria-silva");
    const other = await ensureCandidate({ slug: "ana", name: "Ana" });
    state.candidateId = id;
    const result = await savePublicImageAction(
      form({ kind: "photo", file: await photoFile(), show: "on", candidateId: String(other) }),
    );
    expect(result).toEqual({ ok: true });
    expect((await getCandidateById(id))?.photoKey).not.toBeNull();
    expect(await getCandidateById(other)).toMatchObject({ photoKey: null, publicPhoto: false });
  });

  it("remover pelo botão devolve run removed", async () => {
    const id = await publicCandidate("maria-silva");
    state.candidateId = id;
    await savePublicImageAction(form({ kind: "cover", file: await photoFile(1600, 500), show: "on" }));
    expect(await savePublicImageAction(form({ kind: "cover", intent: "remove" }))).toEqual({ ok: true, run: "removed" });
    expect(await getCandidateById(id)).toMatchObject({ coverKey: null, publicCover: false });
    expect(await savePublicImageAction(form({ kind: "x", intent: "remove" }))).toEqual({ ok: false, code: "invalidKind" });
    expect(await savePublicImageAction(form({ kind: "photo", file: new File(["x"], "a.png") }))).toEqual({
      ok: false,
      code: "imageType",
    });
  });

  it("sem sessão própria, 403 antes de ler o arquivo ou falar com o armazenamento", async () => {
    const id = await publicCandidate("maria-silva");
    await expect(savePublicImageAction(form({ kind: "photo", file: await photoFile(), show: "on" }))).rejects.toThrow(/403/);
    expect(state.guarded).toBe(1);
    expect(blob.calls).toEqual([]);
    expect(await getCandidateById(id)).toMatchObject({ photoKey: null, publicPhoto: false });
  });
});

describe("CSP", () => {
  it("imagem só da própria origem: nenhuma origem de provedor de armazenamento é aberta", async () => {
    const { default: config } = await import("../next.config.ts");
    const rules = await config.headers!();
    const csp = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy")!.value;
    const imgSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("img-src"));
    // A foto sai pela rota do app (`/p/<endereço>/image/<tipo>`), então `'self'`
    // basta; abrir `*.blob.vercel-storage.com` ou um host S3 seria servir
    // por fora da checagem de visibilidade.
    expect(imgSrc).toBe("img-src 'self' data:");
    expect(csp).not.toMatch(/vercel-storage|amazonaws|minio|:9000/);
  });
});
