/**
 * Adapter Vercel Blob (`@vercel/blob`), o armazenamento em deployment.
 *
 * Traduz a porta S3 para o SDK do Blob:
 *
 * - **bucket + key → pathname** `<bucket>/<key>`. O Blob tem uma loja por
 *   token e nenhum bucket; o prefixo mantém o mesmo endereço nos dois
 *   provedores, e trocar de driver não muda chave gravada no banco.
 * - **Sempre privado** (`access: "private"`). O blob público é legível por
 *   quem tiver a URL, mesmo depois de o perfil deixar de ser público — foi o
 *   risco apontado na #327. Privado, só quem tem o token lê, e quem serve a
 *   imagem é a rota do app que confere a visibilidade antes.
 * - **Metadados num objeto irmão.** O Blob não guarda metadado de usuário
 *   (não há `x-amz-meta-*`). O adapter grava `.metadata/<bucket>/<key>.json`
 *   ao lado; bucket de S3 nunca começa com ponto, então o irmão não colide
 *   com objeto nenhum. Custa uma leitura a mais, em paralelo, por
 *   `get`/`head` — preço aceito para a porta ter um contrato só.
 * - **Leitura sem cache de CDN** (`useCache: false`): o S3 é consistente
 *   após escrita e remoção, e a porta promete o mesmo.
 * - **Sobrescrita explícita** (`allowOverwrite`): no S3 o `PutObject` na
 *   mesma chave substitui; no Blob o padrão é recusar.
 */
import { del, get, head, put } from "@vercel/blob";
import { redactSecret } from "../../llm/port.ts";
import type { VercelBlobSettings } from "../config.ts";
import {
  assertValidAddress,
  assertValidPut,
  StorageError,
  type ObjectAddress,
  type ObjectMetadata,
  type ObjectStorage,
} from "../ports.ts";

/** As quatro funções do SDK que o adapter usa: é o que o teste substitui. */
export type BlobSdk = {
  put: typeof put;
  get: typeof get;
  head: typeof head;
  del: typeof del;
};

/** O Blob pede no mínimo um minuto; é o cache do navegador de quem tem o token, não o nosso. */
const MIN_CACHE_SECONDS = 60;

const pathnameOf = ({ bucket, key }: ObjectAddress) => `${bucket}/${key}`;
const metadataPathOf = ({ bucket, key }: ObjectAddress) => `.metadata/${bucket}/${key}.json`;

/** O ETag vem entre aspas no cabeçalho e cru no JSON da API; a porta devolve um só. */
function normalizeEtag(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "BlobNotFoundError";
}

/** A composição de produção: o SDK de verdade, com o token vindo da configuração. */
export function vercelBlobFromSettings(settings: VercelBlobSettings): ObjectStorage {
  return vercelBlobStorage({ put, get, head, del }, settings.token);
}

export function vercelBlobStorage(sdk: BlobSdk, token: string): ObjectStorage {
  const fail = (operation: string, error: unknown): StorageError => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return new StorageError("vercel-blob", operation, redactSecret(message, token));
  };

  async function readMetadata(address: ObjectAddress): Promise<ObjectMetadata> {
    const sidecar = await sdk.get(metadataPathOf(address), { access: "private", token, useCache: false });
    if (!sidecar || sidecar.statusCode !== 200) return {};
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await bytesOf(sidecar.stream)));
    return parsed && typeof parsed === "object" ? (parsed as ObjectMetadata) : {};
  }

  return {
    driver: "vercel-blob",

    async putObject(input) {
      assertValidPut(input);
      const common = {
        access: "private" as const,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: MIN_CACHE_SECONDS,
      };
      try {
        const out = await sdk.put(pathnameOf(input), Buffer.from(input.body), {
          ...common,
          contentType: input.contentType,
        });
        const metadata = input.metadata ?? {};
        // Sobrescrever sem metadado apaga o irmão antigo: no S3, o `PutObject`
        // substitui os metadados junto com o conteúdo.
        if (Object.keys(metadata).length > 0) {
          await sdk.put(metadataPathOf(input), JSON.stringify(metadata), {
            ...common,
            contentType: "application/json",
          });
        } else {
          await sdk.del(metadataPathOf(input), { token });
        }
        return { etag: normalizeEtag(out.etag) };
      } catch (error) {
        throw fail("PutObject", error);
      }
    },

    async headObject(address) {
      assertValidAddress(address);
      try {
        const [out, metadata] = await Promise.all([
          sdk.head(pathnameOf(address), { token }),
          readMetadata(address),
        ]);
        return {
          contentType: out.contentType,
          contentLength: out.size,
          etag: normalizeEtag(out.etag),
          metadata,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw fail("HeadObject", error);
      }
    },

    async getObject(address) {
      assertValidAddress(address);
      try {
        const [out, metadata] = await Promise.all([
          sdk.get(pathnameOf(address), { access: "private", token, useCache: false }),
          readMetadata(address),
        ]);
        if (!out || out.statusCode !== 200) return null;
        const body = await bytesOf(out.stream);
        return {
          body,
          contentType: out.blob.contentType,
          contentLength: out.blob.size,
          etag: normalizeEtag(out.blob.etag),
          metadata,
        };
      } catch (error) {
        throw fail("GetObject", error);
      }
    },

    async deleteObject(address) {
      assertValidAddress(address);
      try {
        await sdk.del([pathnameOf(address), metadataPathOf(address)], { token });
      } catch (error) {
        throw fail("DeleteObject", error);
      }
    },
  };
}
