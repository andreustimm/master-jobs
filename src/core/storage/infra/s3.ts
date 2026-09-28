/**
 * Adapter S3 (`@aws-sdk/client-s3`): MinIO na máquina local, AWS S3 no
 * futuro — a diferença é só `S3_ENDPOINT` e `S3_FORCE_PATH_STYLE`.
 *
 * Adapter burro (G05): traduz a porta para o comando do SDK e de volta. A
 * única decisão aqui é o que conta como "não existe": `NoSuchKey` no GET,
 * `NotFound` no HEAD (sem corpo, o SDK não tem outro nome), ou 404 cru de um
 * compatível que não preenche o nome — nunca `NoSuchBucket`.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { redactSecret } from "../../llm/port.ts";
import type { S3Settings } from "../config.ts";
import {
  assertValidAddress,
  assertValidPut,
  StorageError,
  type ObjectAddress,
  type ObjectStorage,
} from "../ports.ts";

/** O único método do cliente que o adapter usa: é o que o teste substitui. */
export type S3Sender = Pick<S3Client, "send">;

export function s3Client(settings: S3Settings): S3Client {
  return new S3Client({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // O SDK passou a mandar CRC32 em toda escrita; nem todo compatível com S3
    // aceita. Só quando a operação exige, que é o comportamento da AWS antiga.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** A composição de produção: cliente de verdade, e o segredo apagado de todo erro. */
export function s3FromSettings(settings: S3Settings): ObjectStorage {
  return s3Storage(s3Client(settings), [settings.secretAccessKey, settings.accessKeyId]);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  // Bucket inexistente também é 404, mas é configuração errada, não "sem
  // foto": tratá-lo como ausência esconderia o erro atrás de um perfil vazio.
  // No HEAD o S3 não manda corpo e os dois casos chegam como `NotFound` —
  // limite aceito; o GET, que é o que serve a imagem, distingue.
  if (name === "NoSuchBucket") return false;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const meta = "$metadata" in error ? (error.$metadata as { httpStatusCode?: number } | undefined) : undefined;
  return meta?.httpStatusCode === 404;
}

export function s3Storage(client: S3Sender, secrets: readonly string[] = []): ObjectStorage {
  const fail = (operation: string, error: unknown): StorageError => {
    let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    for (const secret of secrets) message = redactSecret(message, secret);
    return new StorageError("s3", operation, message);
  };
  const where = ({ bucket, key }: ObjectAddress) => ({ Bucket: bucket, Key: key });

  return {
    driver: "s3",

    async putObject(input) {
      assertValidPut(input);
      try {
        const out = await client.send(
          new PutObjectCommand({
            ...where(input),
            Body: input.body,
            ContentType: input.contentType,
            ContentLength: input.body.byteLength,
            Metadata: { ...input.metadata },
          }),
        );
        return { etag: out.ETag ?? "" };
      } catch (error) {
        throw fail("PutObject", error);
      }
    },

    async headObject(address) {
      assertValidAddress(address);
      try {
        const out = await client.send(new HeadObjectCommand(where(address)));
        return {
          contentType: out.ContentType ?? "application/octet-stream",
          contentLength: out.ContentLength ?? 0,
          etag: out.ETag ?? "",
          metadata: { ...out.Metadata },
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw fail("HeadObject", error);
      }
    },

    async getObject(address, options) {
      assertValidAddress(address);
      try {
        const out = await client.send(new GetObjectCommand(where(address)));
        const body = out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
        return {
          body,
          contentType: out.ContentType ?? "application/octet-stream",
          contentLength: out.ContentLength ?? body.byteLength,
          etag: out.ETag ?? "",
          metadata: options?.metadata === false ? {} : { ...out.Metadata },
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw fail("GetObject", error);
      }
    },

    async deleteObject(address) {
      assertValidAddress(address);
      try {
        await client.send(new DeleteObjectCommand(where(address)));
      } catch (error) {
        throw fail("DeleteObject", error);
      }
    },
  };
}
