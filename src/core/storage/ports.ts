/**
 * Armazenamento de objetos na semântica do S3 (#327, ADR 0029).
 *
 * O código do app só conhece este formato — bucket + key, `PutObject`,
 * `GetObject`, `HeadObject`, `DeleteObject`, `ContentType`, `ContentLength`,
 * metadados e ETag. Nenhum arquivo fora de `infra/` importa SDK de provedor,
 * e nada depende de URL pública: o objeto é lido pela porta e servido por uma
 * rota do app que confere a visibilidade antes (G22).
 *
 * A variação é real (G04): Vercel Blob em deployment, S3 com MinIO na máquina
 * local e AWS S3 no futuro, trocados só por configuração
 * (`JHO_STORAGE_DRIVER`).
 *
 * Os corpos são bytes em memória, não stream: os objetos deste produto são
 * imagens de poucas centenas de KB já reprocessadas no upload, e um contrato
 * de stream obrigaria cada chamador a tratar leitura parcial por nada.
 */

export const STORAGE_DRIVERS = ["vercel-blob", "s3"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/** Metadados do usuário (`x-amz-meta-*`): chave minúscula, valor ASCII. */
export type ObjectMetadata = Readonly<Record<string, string>>;

export type ObjectAddress = {
  bucket: string;
  key: string;
};

export type PutObjectInput = ObjectAddress & {
  body: Uint8Array;
  contentType: string;
  metadata?: ObjectMetadata;
};

export type PutObjectOutput = {
  /** Opaco: igual ao de `headObject`/`getObject` do mesmo conteúdo. */
  etag: string;
};

export type HeadObjectOutput = {
  contentType: string;
  contentLength: number;
  etag: string;
  metadata: ObjectMetadata;
};

export type GetObjectOutput = HeadObjectOutput & {
  body: Uint8Array;
};

/**
 * `metadata: false` é o caminho de serviço: quem só entrega o corpo não paga
 * pelo metadado (no Blob, uma leitura a mais). O contrato é o mesmo nos dois
 * adapters — `metadata` volta `{}` —, para ninguém depender do que um
 * provedor devolveria de graça e o outro não.
 */
export type GetObjectOptions = {
  metadata?: boolean;
};

/**
 * A porta. Chave inexistente devolve `null` em `get`/`head` (o `NoSuchKey`
 * do S3 vira valor, não exceção) e `delete` é idempotente, como no S3.
 * `put` na mesma chave sobrescreve conteúdo, tipo e metadados.
 */
export type ObjectStorage = {
  readonly driver: StorageDriver;
  putObject(input: PutObjectInput): Promise<PutObjectOutput>;
  getObject(address: ObjectAddress, options?: GetObjectOptions): Promise<GetObjectOutput | null>;
  headObject(address: ObjectAddress): Promise<HeadObjectOutput | null>;
  deleteObject(address: ObjectAddress): Promise<void>;
};

/**
 * Falha do provedor, já sem credencial. Quem assina a requisição conhece o
 * segredo e o apaga pelo VALOR antes de a mensagem virar erro (G41).
 */
export class StorageError extends Error {
  readonly driver: StorageDriver;
  readonly operation: string;

  constructor(driver: StorageDriver, operation: string, message: string) {
    super(`${driver} ${operation}: ${message}`);
    this.name = "StorageError";
    this.driver = driver;
    this.operation = operation;
  }
}

/**
 * Regras de nome do S3, conferidas pela porta e não pelo provedor: os dois
 * adapters recusam o mesmo endereço, e o que passa no Blob passa no S3.
 * Bucket: 3–63 caracteres, minúsculas, dígito, ponto e hífen. Chave: os
 * "caracteres seguros" da documentação do S3, sem `/` inicial nem `..`.
 */
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const KEY = /^[A-Za-z0-9!_.*'()-][A-Za-z0-9!_.*'()/-]*$/;
const METADATA_KEY = /^[a-z0-9-]{1,64}$/;
const METADATA_VALUE = /^[\x20-\x7e]{0,512}$/;

/** A mesma régua para a configuração: bucket inválido falha na carga, não no primeiro envio. */
export function isValidBucket(bucket: string): boolean {
  return BUCKET.test(bucket);
}

export function assertValidAddress(address: ObjectAddress): void {
  if (!isValidBucket(address.bucket)) throw new TypeError(`bucket inválido: ${address.bucket}`);
  const { key } = address;
  if (key.length > 1024 || !KEY.test(key) || key.split("/").some((part) => part === "..")) {
    throw new TypeError(`key inválida: ${key}`);
  }
}

export function assertValidPut(input: PutObjectInput): void {
  assertValidAddress(input);
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(input.contentType)) {
    throw new TypeError(`ContentType inválido: ${input.contentType}`);
  }
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!METADATA_KEY.test(key) || !METADATA_VALUE.test(value)) {
      throw new TypeError(`metadado inválido: ${key}`);
    }
  }
}
