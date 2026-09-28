/**
 * #327 — a porta de armazenamento no formato S3 e os dois adapters.
 *
 * A suíte de contrato (`support/storage-contract.ts`) roda três vezes:
 *   1. Vercel Blob com o SDK dublado (sempre);
 *   2. S3 com o `send` dublado (sempre — mantém a cobertura sem Docker);
 *   3. S3 contra MinIO de verdade, quando há Docker ou `JHO_TEST_S3_*`; sem
 *      eles, o bloco aparece como PULADO com o motivo no nome.
 */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { openStorage, parseStorageConfig, StorageError } from "../src/core/storage/index.ts";
import { s3Client, s3FromSettings, s3Storage } from "../src/core/storage/infra/s3.ts";
import { vercelBlobFromSettings, vercelBlobStorage } from "../src/core/storage/infra/vercel-blob.ts";
import { describeStorageContract } from "./support/storage-contract.ts";
import { fakeBlobSdk, fakeS3 } from "./support/storage-fakes.ts";
import { MINIO_IMAGE, startMinio } from "./support/minio.ts";

const BUCKETS = ["contrato-a", "contrato-b"] as const;
const TOKEN = "vercel_blob_rw_LOJA_segredo-sentinela-123";
const SECRET_FOR_CONFIG = "segredo-de-config";

const blob = fakeBlobSdk(TOKEN);
describeStorageContract("Vercel Blob (SDK dublado)", () => ({
  storage: vercelBlobStorage(blob.sdk, TOKEN),
  buckets: BUCKETS,
}));

const s3 = fakeS3(BUCKETS);
describeStorageContract("S3 (send dublado)", () => ({ storage: s3Storage(s3.sender), buckets: BUCKETS }));

const minio = await startMinio(BUCKETS);
if (!minio.ok) console.warn(`[storage-contract] contrato S3 contra MinIO PULADO: ${minio.reason}`);
afterAll(() => {
  if (minio.ok) minio.server.stop();
});

describe.skipIf(!minio.ok)(`S3 contra MinIO${minio.ok ? "" : ` — PULADO: ${minio.reason}`}`, () => {
  describeStorageContract("S3 (MinIO)", () => {
    if (!minio.ok) throw new Error("inalcançável");
    return {
      storage: s3FromSettings({
        driver: "s3",
        bucket: BUCKETS[0],
        region: "us-east-1",
        endpoint: minio.server.endpoint,
        forcePathStyle: true,
        accessKeyId: minio.server.accessKeyId,
        secretAccessKey: minio.server.secretAccessKey,
      }),
      buckets: BUCKETS,
    };
  });

  it("GET em bucket inexistente é erro no MinIO de verdade, não objeto ausente", async () => {
    if (!minio.ok) return;
    const storage = s3FromSettings({
      driver: "s3",
      bucket: "nao-existe",
      region: "us-east-1",
      endpoint: minio.server.endpoint,
      forcePathStyle: true,
      accessKeyId: minio.server.accessKeyId,
      secretAccessKey: minio.server.secretAccessKey,
    });
    const error = await storage.getObject({ bucket: "bucket-que-nao-existe", key: "k" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).not.toContain(minio.server.secretAccessKey);
  });
});

describe("adapter Vercel Blob", () => {
  it("toda escrita e leitura é privada e leva o token configurado", async () => {
    const fake = fakeBlobSdk(TOKEN);
    const storage = vercelBlobStorage(fake.sdk, TOKEN);
    const address = { bucket: "master-jobs", key: "candidates/1/photo/a.webp" };
    await storage.putObject({ ...address, body: new Uint8Array([1]), contentType: "image/webp", metadata: { w: "1" } });
    await storage.getObject(address);
    await storage.headObject(address);
    await storage.deleteObject(address);

    expect(fake.calls.length).toBeGreaterThan(4);
    for (const call of fake.calls) {
      expect(call.options.token).toBe(TOKEN);
      if (call.op === "put" || call.op === "get") expect(call.options.access).toBe("private");
    }
  });

  it("traduz bucket + key para pathname, e o metadado mora num irmão que não colide", async () => {
    const fake = fakeBlobSdk(TOKEN);
    const storage = vercelBlobStorage(fake.sdk, TOKEN);
    await storage.putObject({
      bucket: "master-jobs",
      key: "candidates/1/photo/a.webp",
      body: new Uint8Array([1, 2]),
      contentType: "image/webp",
      metadata: { width: "512" },
    });
    expect([...fake.store.keys()].sort()).toEqual([
      ".metadata/master-jobs/candidates/1/photo/a.webp.json",
      "master-jobs/candidates/1/photo/a.webp",
    ]);
    await storage.deleteObject({ bucket: "master-jobs", key: "candidates/1/photo/a.webp" });
    expect(fake.store.size).toBe(0);
  });

  it("erro do provedor vira StorageError sem o token (G41)", async () => {
    const fake = fakeBlobSdk(TOKEN);
    const storage = vercelBlobStorage(fake.sdk, TOKEN);
    const address = { bucket: "master-jobs", key: "k" };
    const operations = [
      () => storage.putObject({ ...address, body: new Uint8Array([1]), contentType: "image/webp" }),
      () => storage.getObject(address),
      () => storage.headObject(address),
      () => storage.deleteObject(address),
    ];
    for (const run of operations) {
      fake.failNext(`Forbidden: token ${TOKEN} recusado`);
      const error = await run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageError);
      expect(String((error as Error).message)).not.toContain(TOKEN);
      expect(String((error as Error).message)).toContain("***");
    }
  });

  it("a composição de produção usa o SDK de verdade com o token da configuração", () => {
    const storage = vercelBlobFromSettings({ driver: "vercel-blob", bucket: "master-jobs", token: TOKEN });
    expect(storage.driver).toBe("vercel-blob");
  });
});

describe("adapter S3", () => {
  const SECRET = "segredo-s3-sentinela-abcdef";

  it("erro que não é 'não existe' vira StorageError sem o segredo (G41)", async () => {
    const fake = fakeS3(["b-ok"]);
    const storage = s3Storage(fake.sender, [SECRET]);
    const address = { bucket: "b-ok", key: "k" };
    const operations = [
      () => storage.putObject({ ...address, body: new Uint8Array([1]), contentType: "image/webp" }),
      () => storage.getObject(address),
      () => storage.headObject(address),
      () => storage.deleteObject(address),
    ];
    for (const run of operations) {
      fake.failNext(`AccessDenied para a chave ${SECRET}`);
      const error = await run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageError);
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("bucket inexistente é erro, não objeto ausente", async () => {
    const storage = s3Storage(fakeS3(["b-ok"]).sender);
    // NoSuchBucket responde 404 também; tratá-lo como "sem foto" esconderia
    // uma configuração errada atrás de um perfil vazio.
    await expect(storage.getObject({ bucket: "outro-bucket", key: "k" })).rejects.toThrow(StorageError);
  });

  it("o cliente respeita endpoint e path style da configuração", async () => {
    const client = s3Client({
      driver: "s3",
      bucket: "b",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      accessKeyId: "a",
      secretAccessKey: "s",
    });
    expect(client.config.forcePathStyle).toBe(true);
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe("127.0.0.1");
    client.destroy();
  });
});

describe("configuração por ambiente", () => {
  it("sem JHO_STORAGE_DRIVER não há armazenamento, e openStorage devolve null", async () => {
    expect(parseStorageConfig({})).toEqual({ status: "unconfigured" });
    expect(parseStorageConfig({ JHO_STORAGE_DRIVER: "  " })).toEqual({ status: "unconfigured" });
    expect(await openStorage({})).toBeNull();
  });

  it("valor desconhecido falha fechado, sem cair no outro driver", async () => {
    expect(parseStorageConfig({ JHO_STORAGE_DRIVER: "vercel_blob" }).status).toBe("invalid");
    await expect(openStorage({ JHO_STORAGE_DRIVER: "gcs" })).rejects.toThrow(/JHO_STORAGE_DRIVER/);
  });

  it("vercel-blob exige o token e nunca o cita no erro", async () => {
    expect(parseStorageConfig({ JHO_STORAGE_DRIVER: "vercel-blob" })).toEqual({
      status: "invalid",
      reason: "falta BLOB_READ_WRITE_TOKEN",
    });
    const target = await openStorage({ JHO_STORAGE_DRIVER: "vercel-blob", BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(target?.storage.driver).toBe("vercel-blob");
    expect(target?.bucket).toBe("master-jobs");
  });

  it("s3 exige região e credenciais, nomeando as variáveis que faltam", () => {
    const config = parseStorageConfig({ JHO_STORAGE_DRIVER: "s3", S3_ACCESS_KEY_ID: "id" });
    expect(config).toEqual({ status: "invalid", reason: "falta S3_REGION, S3_SECRET_ACCESS_KEY" });
    expect(
      parseStorageConfig({
        JHO_STORAGE_DRIVER: "s3",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "id",
        S3_SECRET_ACCESS_KEY: SECRET_FOR_CONFIG,
        S3_FORCE_PATH_STYLE: "sim",
      }),
    ).toEqual({ status: "invalid", reason: "S3_FORCE_PATH_STYLE deve ser true ou false" });
  });

  it("MinIO: endpoint liga path style; AWS: sem endpoint, bucket no host", async () => {
    const base = { JHO_STORAGE_DRIVER: "s3", S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: SECRET_FOR_CONFIG };
    const minioConfig = parseStorageConfig({ ...base, S3_ENDPOINT: "http://127.0.0.1:9000", S3_BUCKET: "local" });
    expect(minioConfig.status === "configured" && minioConfig.settings).toMatchObject({
      driver: "s3",
      bucket: "local",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
    });
    const aws = parseStorageConfig({ ...base, JHO_STORAGE_BUCKET: "fotos", S3_FORCE_PATH_STYLE: "true" });
    expect(aws.status === "configured" && aws.settings).toMatchObject({ bucket: "fotos", endpoint: null, forcePathStyle: true });
    const target = await openStorage(base);
    expect(target?.storage.driver).toBe("s3");
  });
});


describe("MinIO local (docker-compose.local.yml)", () => {
  const compose = readFileSync("docker-compose.local.yml", "utf8");

  it("usa a mesma imagem da suíte de contrato", () => {
    expect(compose).toContain(`pgsty/minio:${MINIO_IMAGE.split(":")[1]}`);
  });

  it("publica portas só em 127.0.0.1 (regra 12) e cria o bucket no bootstrap", () => {
    const ports = [...compose.matchAll(/^\s+- "([^"]+:\d+)"$/gm)].map((match) => match[1]!);
    expect(ports.length).toBeGreaterThanOrEqual(3);
    for (const port of ports) expect(port.startsWith("127.0.0.1:"), port).toBe(true);
    expect(compose).toContain("mc mb --ignore-existing");
  });
});
