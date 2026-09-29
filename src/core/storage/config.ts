/**
 * Qual armazenamento usar, lido do ambiente. Puro: recebe o `env`, não o lê.
 *
 * **Falha fechado.** Valor desconhecido em `JHO_STORAGE_DRIVER` é erro, não
 * "o outro driver": um erro de digitação em produção que caísse no S3 local
 * mandaria a foto para lugar nenhum — ou para um bucket que ninguém protege.
 * Variável ausente é "não configurado": o upload responde que o ambiente não
 * tem armazenamento, e o perfil público continua sem foto, sem quebrar.
 *
 * **Credencial não sai daqui por mensagem.** Os erros citam o NOME da
 * variável que falta, nunca um valor (regra 16, G41).
 */
import { isValidBucket, STORAGE_DRIVERS, type StorageDriver } from "./ports.ts";

/** Bucket padrão quando `JHO_STORAGE_BUCKET` não é dado. No Blob vira prefixo do pathname. */
export const DEFAULT_BUCKET = "master-jobs";

export type S3Settings = {
  driver: "s3";
  bucket: string;
  region: string;
  /** Ausente é a AWS; presente é MinIO ou outro compatível. */
  endpoint: string | null;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

export type VercelBlobSettings = {
  driver: "vercel-blob";
  bucket: string;
  token: string;
};

export type StorageSettings = S3Settings | VercelBlobSettings;

export type StorageConfig =
  | { status: "configured"; settings: StorageSettings }
  | { status: "unconfigured" }
  | { status: "invalid"; reason: string };

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function isDriver(raw: string): raw is StorageDriver {
  return (STORAGE_DRIVERS as readonly string[]).includes(raw);
}

export function parseStorageConfig(env: Env): StorageConfig {
  const driver = value(env, "JHO_STORAGE_DRIVER");
  if (driver === null) return { status: "unconfigured" };
  if (!isDriver(driver)) {
    return { status: "invalid", reason: `JHO_STORAGE_DRIVER deve ser ${STORAGE_DRIVERS.join(" ou ")}` };
  }
  const bucket = value(env, "JHO_STORAGE_BUCKET") ?? DEFAULT_BUCKET;
  if (!isValidBucket(bucket)) return { status: "invalid", reason: "JHO_STORAGE_BUCKET fora das regras de nome do S3" };

  if (driver === "vercel-blob") {
    const token = value(env, "BLOB_READ_WRITE_TOKEN");
    if (token === null) return { status: "invalid", reason: "falta BLOB_READ_WRITE_TOKEN" };
    return { status: "configured", settings: { driver, bucket, token } };
  }

  const missing = ["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((name) => value(env, name) === null);
  if (missing.length > 0) return { status: "invalid", reason: `falta ${missing.join(", ")}` };
  const endpoint = value(env, "S3_ENDPOINT");
  const pathStyle = value(env, "S3_FORCE_PATH_STYLE");
  if (pathStyle !== null && pathStyle !== "true" && pathStyle !== "false") {
    return { status: "invalid", reason: "S3_FORCE_PATH_STYLE deve ser true ou false" };
  }
  const s3Bucket = value(env, "S3_BUCKET") ?? bucket;
  if (!isValidBucket(s3Bucket)) return { status: "invalid", reason: "S3_BUCKET fora das regras de nome do S3" };
  return {
    status: "configured",
    settings: {
      driver,
      bucket: s3Bucket,
      region: value(env, "S3_REGION")!,
      endpoint,
      // MinIO e a maioria dos compatíveis só atendem `endpoint/bucket/key`;
      // a AWS prefere o bucket no host. Sem valor explícito, decide o endpoint.
      forcePathStyle: pathStyle === null ? endpoint !== null : pathStyle === "true",
      accessKeyId: value(env, "S3_ACCESS_KEY_ID")!,
      secretAccessKey: value(env, "S3_SECRET_ACCESS_KEY")!,
    },
  };
}
