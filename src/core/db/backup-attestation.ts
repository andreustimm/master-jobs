import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, dirname } from "node:path";
import { resolveDatabaseUrl } from "./config.ts";

type EvidenceFile = { path: string; sha256: string };
type Attestation = {
  version: 1;
  database: string;
  capturedAt: string;
  restoreValidatedAt: string;
  data: EvidenceFile;
  schema: EvidenceFile;
  restoreEvidence: EvidenceFile;
};

/** Do not print the URL or username: either can contain credentials. */
export function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return `local:${parsed.pathname.slice(1)}`;
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (direct) return `supabase:${direct[1]}`;
  if (host.endsWith(".pooler.supabase.com")) {
    const user = decodeURIComponent(parsed.username);
    const pooler = /^postgres\.([a-z0-9]+)$/.exec(user);
    if (pooler) return `supabase:${pooler[1]}`;
  }
  throw new Error("Não foi possível identificar o banco para conferir o backup; operação recusada.");
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Validates integrity and the operator's restore attestation; it cannot prove the restore itself. */
export async function verifyBackupAttestation(path: string, now = new Date()): Promise<{ dataSha256: string }> {
  const manifestPath = resolve(path);
  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("Atestado de backup inválido.");
  const attestation = raw as Partial<Attestation>;
  if (attestation.version !== 1 || typeof attestation.database !== "string" || attestation.database !== databaseIdentity(resolveDatabaseUrl("runtime").url)) {
    throw new Error("Atestado não identifica o banco conectado.");
  }
  const captured = Date.parse(attestation.capturedAt ?? "");
  const verified = Date.parse(attestation.restoreValidatedAt ?? "");
  const clock = now.getTime();
  if (!Number.isFinite(captured) || !Number.isFinite(verified) || captured > verified || verified > clock + 300_000 || captured > clock + 300_000 || clock - captured > 86_400_000) {
    throw new Error("Backup precisa ser recente e a restauração validada depois da captura.");
  }
  const paths = new Set<string>();
  for (const entry of [attestation.data, attestation.schema, attestation.restoreEvidence]) {
    if (!entry || typeof entry.path !== "string" || !entry.path || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      throw new Error("Arquivo ou SHA-256 ausente no atestado de backup.");
    }
    const file = isAbsolute(entry.path) ? entry.path : resolve(dirname(manifestPath), entry.path);
    const canonical = await realpath(file);
    const info = await stat(canonical);
    if (paths.has(canonical) || !info.isFile() || info.size === 0 || (await sha256(canonical)) !== entry.sha256) {
      throw new Error("A integridade de um arquivo do backup não confere.");
    }
    paths.add(canonical);
  }
  return { dataSha256: attestation.data!.sha256 };
}
