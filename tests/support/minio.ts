/**
 * Um MinIO para a suíte de contrato do adapter S3.
 *
 * Com `JHO_TEST_S3_ENDPOINT` (e as credenciais `JHO_TEST_S3_ACCESS_KEY_ID` /
 * `JHO_TEST_S3_SECRET_ACCESS_KEY`), usa o servidor dado — o do
 * `docker-compose.local.yml`, por exemplo. Sem isso, sobe um contêiner
 * descartável como `postgres-global.ts` faz com o PostgreSQL: credencial
 * aleatória, porta só em 127.0.0.1, parado no fim. Sem Docker ou sem a imagem,
 * devolve o motivo e quem chama PULA com mensagem — nunca passa em silêncio.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

/** A mesma imagem do `docker-compose.local.yml` (conferido em teste). */
export const MINIO_IMAGE = "pgsty/minio:RELEASE.2026-08-04T00-00-00Z";

export type MinioServer = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => void;
};

async function waitReady(endpoint: string): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${endpoint}/minio/health/live`);
      if (response.ok) return true;
    } catch {
      // ainda subindo
    }
    await setTimeout(500);
  }
  return false;
}

function fromEnv(): MinioServer | null {
  const endpoint = process.env.JHO_TEST_S3_ENDPOINT?.trim();
  const accessKeyId = process.env.JHO_TEST_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.JHO_TEST_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, accessKeyId, secretAccessKey, stop: () => {} };
}

function disposable(): MinioServer | string {
  const accessKeyId = `teste${randomBytes(6).toString("hex")}`;
  const secretAccessKey = randomBytes(24).toString("hex");
  const started = spawnSync(
    "docker",
    ["run", "--rm", "-d", "-p", "127.0.0.1::9000", "-e", "MINIO_ROOT_USER", "-e", "MINIO_ROOT_PASSWORD", MINIO_IMAGE, "server", "/data"],
    {
      encoding: "utf8",
      timeout: 180_000,
      env: { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey },
    },
  );
  const container = started.stdout?.trim() ?? "";
  if (started.status !== 0 || !/^[a-f0-9]{64}$/.test(container)) {
    return `docker run ${MINIO_IMAGE} falhou: ${(started.stderr ?? started.error?.message ?? "").trim().slice(0, 200)}`;
  }
  const stop = () => void spawnSync("docker", ["stop", "--time", "2", container], { encoding: "utf8" });
  const binding = spawnSync("docker", ["port", container, "9000/tcp"], { encoding: "utf8" }).stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) {
    stop();
    return "o MinIO de teste precisa escutar só em 127.0.0.1";
  }
  return { endpoint: `http://${binding}`, accessKeyId, secretAccessKey, stop };
}

export async function startMinio(buckets: readonly string[]): Promise<{ ok: true; server: MinioServer } | { ok: false; reason: string }> {
  const server = fromEnv() ?? disposable();
  if (typeof server === "string") return { ok: false, reason: server };
  if (!(await waitReady(server.endpoint))) {
    server.stop();
    return { ok: false, reason: `MinIO em ${server.endpoint} não respondeu` };
  }
  const client = new S3Client({
    region: "us-east-1",
    endpoint: server.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: server.accessKeyId, secretAccessKey: server.secretAccessKey },
  });
  try {
    for (const bucket of buckets) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
      }
    }
  } catch (error) {
    server.stop();
    return { ok: false, reason: `não criou os buckets: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.destroy();
  }
  return { ok: true, server };
}
