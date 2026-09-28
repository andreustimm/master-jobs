/**
 * Dublês dos SDKs de armazenamento, no nível da chamada que o adapter faz.
 *
 * Não são outra implementação da porta: imitam o PROVEDOR (o `send` do S3 com
 * os comandos do SDK, e as quatro funções do `@vercel/blob`), inclusive os
 * jeitos de falhar — `NoSuchKey`/`NotFound` no S3, `BlobNotFoundError` no
 * `head` e `null` no `get` do Blob. Assim a suíte de contrato roda os
 * adapters de verdade sem rede, e o MinIO confirma o S3 quando está de pé.
 *
 * O dublê do Blob RECUSA qualquer chamada que não seja privada ou que venha
 * sem o token: blob público é o risco apontado na #327, e o teste reprova se
 * o adapter um dia pedir um.
 */
import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { BlobSdk } from "../../src/core/storage/infra/vercel-blob.ts";
import type { S3Sender } from "../../src/core/storage/infra/s3.ts";

type Stored = { body: Uint8Array; contentType: string; metadata: Record<string, string>; etag: string };

const md5 = (body: Uint8Array) => createHash("md5").update(body).digest("hex");

function toBytes(body: unknown): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  throw new Error(`corpo não suportado pelo dublê: ${typeof body}`);
}

/* ---------------------------------------------------------------- Vercel Blob */

export type FakeBlob = {
  sdk: BlobSdk;
  store: Map<string, Stored>;
  calls: Array<{ op: string; pathname: string | string[]; options: Record<string, unknown> }>;
  /** Faz a próxima chamada falhar com esta mensagem (para testar a redação do token). */
  failNext: (message: string) => void;
};

export function fakeBlobSdk(token: string): FakeBlob {
  const store = new Map<string, Stored>();
  const calls: FakeBlob["calls"] = [];
  let pendingFailure: string | null = null;

  const check = (op: string, pathname: string | string[], options: Record<string, unknown> | undefined) => {
    calls.push({ op, pathname, options: options ?? {} });
    if (pendingFailure !== null) {
      const message = pendingFailure;
      pendingFailure = null;
      throw Object.assign(new Error(message), { name: "BlobError" });
    }
    if (options?.token !== token) throw new Error(`${op} sem o token configurado`);
    if ((op === "put" || op === "get") && options?.access !== "private") {
      throw new Error(`${op} pediu blob não privado: ${String(options?.access)}`);
    }
  };

  const sdk = {
    async put(pathname: string, body: unknown, options: Record<string, unknown>) {
      check("put", pathname, options);
      if (store.has(pathname) && options.allowOverwrite !== true) {
        throw new Error("This blob already exists");
      }
      const bytes = toBytes(body);
      const etag = `"${md5(bytes)}"`;
      store.set(pathname, { body: bytes, contentType: String(options.contentType), metadata: {}, etag });
      return { url: `https://loja.private.blob.vercel-storage.com/${pathname}`, downloadUrl: "", pathname, contentType: String(options.contentType), contentDisposition: "", etag };
    },
    async get(pathname: string, options: Record<string, unknown>) {
      check("get", pathname, options);
      const found = store.get(pathname);
      if (!found) return null;
      return {
        statusCode: 200,
        stream: new Blob([Buffer.from(found.body)]).stream(),
        headers: new Headers({ etag: found.etag }),
        blob: {
          url: "",
          downloadUrl: "",
          pathname,
          contentDisposition: "",
          cacheControl: "",
          uploadedAt: new Date(0),
          // O cabeçalho vem entre aspas; o adapter normaliza.
          etag: found.etag,
          contentType: found.contentType,
          size: found.body.byteLength,
        },
      };
    },
    async head(pathname: string, options: Record<string, unknown>) {
      check("head", pathname, options);
      const found = store.get(pathname);
      if (!found) throw Object.assign(new Error("The requested blob does not exist"), { name: "BlobNotFoundError" });
      return {
        url: "",
        downloadUrl: "",
        pathname,
        size: found.body.byteLength,
        contentType: found.contentType,
        contentDisposition: "",
        cacheControl: "",
        uploadedAt: new Date(0),
        // O JSON da API vem sem aspas.
        etag: found.etag.replaceAll('"', ""),
      };
    },
    async del(pathnames: string | string[], options: Record<string, unknown>) {
      check("del", pathnames, options);
      for (const pathname of Array.isArray(pathnames) ? pathnames : [pathnames]) store.delete(pathname);
    },
  };

  return {
    sdk: sdk as unknown as BlobSdk,
    store,
    calls,
    failNext: (message) => {
      pendingFailure = message;
    },
  };
}

/* ------------------------------------------------------------------------ S3 */

export type FakeS3 = {
  sender: S3Sender;
  failNext: (message: string) => void;
};

/** Um bucket só existe se for criado — como no S3, `NoSuchBucket` fora dele. */
export function fakeS3(buckets: readonly string[]): FakeS3 {
  const store = new Map<string, Stored>();
  const known = new Set(buckets);
  let pendingFailure: string | null = null;
  const at = (bucket: unknown, key: unknown) => {
    if (!known.has(String(bucket))) {
      throw Object.assign(new Error("The specified bucket does not exist"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } });
    }
    return `${String(bucket)}\u0000${String(key)}`;
  };
  const missing = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

  const sender = {
    async send(command: unknown) {
      if (pendingFailure !== null) {
        const message = pendingFailure;
        pendingFailure = null;
        throw Object.assign(new Error(message), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      }
      if (command instanceof PutObjectCommand) {
        const input = command.input;
        const body = toBytes(input.Body);
        const etag = `"${md5(body)}"`;
        // O S3 devolve as chaves de metadado em minúsculas.
        const metadata = Object.fromEntries(Object.entries(input.Metadata ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
        store.set(at(input.Bucket, input.Key), { body, contentType: input.ContentType ?? "", metadata, etag });
        return { ETag: etag };
      }
      if (command instanceof HeadObjectCommand) {
        const found = store.get(at(command.input.Bucket, command.input.Key));
        if (!found) throw missing("NotFound");
        return { ContentType: found.contentType, ContentLength: found.body.byteLength, ETag: found.etag, Metadata: { ...found.metadata } };
      }
      if (command instanceof GetObjectCommand) {
        const found = store.get(at(command.input.Bucket, command.input.Key));
        if (!found) throw missing("NoSuchKey");
        return {
          Body: { transformToByteArray: async () => new Uint8Array(found.body) },
          ContentType: found.contentType,
          ContentLength: found.body.byteLength,
          ETag: found.etag,
          Metadata: { ...found.metadata },
        };
      }
      if (command instanceof DeleteObjectCommand) {
        store.delete(at(command.input.Bucket, command.input.Key));
        return {};
      }
      throw new Error("comando não suportado pelo dublê");
    },
  };

  return {
    sender: sender as unknown as S3Sender,
    failNext: (message) => {
      pendingFailure = message;
    },
  };
}
