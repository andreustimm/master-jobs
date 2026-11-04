import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseIdentity, verifyBackupAttestation } from "../src/core/db/backup-attestation.ts";

let dir: string;
const now = new Date("2026-11-03T20:00:00.000Z");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "retention-attestation-"));
  vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/testdb");
  for (const file of ["data.sql", "schema.sql", "restore.txt"]) await writeFile(join(dir, file), file);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

async function writeAttestation(overrides: Record<string, unknown> = {}): Promise<string> {
  const path = join(dir, "attestation.json");
  await writeFile(path, JSON.stringify({
    version: 1, database: "local:testdb", capturedAt: "2026-11-03T19:00:00.000Z", restoreValidatedAt: "2026-11-03T19:30:00.000Z",
    data: { path: "data.sql", sha256: digest("data.sql") },
    schema: { path: "schema.sql", sha256: digest("schema.sql") },
    restoreEvidence: { path: "restore.txt", sha256: digest("restore.txt") },
    ...overrides,
  }));
  return path;
}

describe("atestado de backup antes da retenção", () => {
  it("confere banco, data e integridade dos três arquivos", async () => {
    expect(await verifyBackupAttestation(await writeAttestation(), now)).toEqual({ dataSha256: digest("data.sql") });
  });

  it("recusa arquivo alterado, banco errado e validação anterior ao backup", async () => {
    const path = await writeAttestation();
    await writeFile(join(dir, "data.sql"), "alterado");
    await expect(verifyBackupAttestation(path, now)).rejects.toThrow(/integridade/);
    await expect(verifyBackupAttestation(await writeAttestation({ database: "local:other" }), now)).rejects.toThrow(/banco/);
    await expect(verifyBackupAttestation(await writeAttestation({ restoreValidatedAt: "2026-11-03T18:00:00.000Z" }), now)).rejects.toThrow(/restauração/);
  });

  it("recusa backup antigo e não identifica um host desconhecido por suposição", async () => {
    await expect(verifyBackupAttestation(await writeAttestation({ capturedAt: "2026-11-01T18:00:00.000Z" }), now)).rejects.toThrow(/recente/);
    expect(() => databaseIdentity("postgresql://user:password@example.test/db")).toThrow(/identificar/);
    expect(databaseIdentity("postgresql://postgres.project123:password@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")).toBe("supabase:project123");
    expect(databaseIdentity("postgresql://postgres:password@db.project123.supabase.co:5432/postgres")).toBe("supabase:project123");
  });
});
