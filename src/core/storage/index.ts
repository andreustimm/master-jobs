/**
 * Composição do armazenamento: lê o ambiente, escolhe o adapter e devolve a
 * porta com o bucket. Função, sem container (regra 4).
 *
 * O adapter é carregado sob demanda: só o driver escolhido traz o próprio SDK
 * para a memória, e quem nunca sobe imagem (a maioria das requisições) não
 * paga nenhum dos dois.
 */
import { parseStorageConfig } from "./config.ts";
import type { ObjectStorage } from "./ports.ts";

export type StorageTarget = {
  storage: ObjectStorage;
  bucket: string;
};

export class StorageConfigError extends Error {
  constructor(reason: string) {
    super(`armazenamento mal configurado: ${reason}`);
    this.name = "StorageConfigError";
  }
}

/**
 * `null` quando o ambiente não tem armazenamento (`JHO_STORAGE_DRIVER`
 * ausente); exceção quando tem e está errado — falha fechado, nunca "o outro".
 */
export async function openStorage(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<StorageTarget | null> {
  const config = parseStorageConfig(env);
  if (config.status === "unconfigured") return null;
  if (config.status === "invalid") throw new StorageConfigError(config.reason);
  const { settings } = config;
  if (settings.driver === "vercel-blob") {
    const { vercelBlobFromSettings } = await import("./infra/vercel-blob.ts");
    return { storage: vercelBlobFromSettings(settings), bucket: settings.bucket };
  }
  const { s3FromSettings } = await import("./infra/s3.ts");
  return { storage: s3FromSettings(settings), bucket: settings.bucket };
}

export { parseStorageConfig, DEFAULT_BUCKET } from "./config.ts";
export type { StorageConfig, StorageSettings } from "./config.ts";
export {
  STORAGE_DRIVERS,
  StorageError,
  type GetObjectOutput,
  type HeadObjectOutput,
  type ObjectAddress,
  type ObjectMetadata,
  type ObjectStorage,
  type PutObjectInput,
  type StorageDriver,
} from "./ports.ts";
