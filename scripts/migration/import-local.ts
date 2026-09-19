import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { runMigrations } from "../../src/core/db/migrate.ts";
import { connectDatabase } from "../../src/core/db/client.ts";
import { importProduction } from "./import-production.ts";
import { selectProduction } from "./select-production.ts";
import { assertLocalTarget } from "./local-target.ts";

const options = { source: { type: "string" } } as const;
let stage = "arguments";

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function assertNoPendingJournal(path: string) {
  for (const suffix of ["-wal", "-journal"]) {
    if (existsSync(path + suffix) && statSync(path + suffix).size > 0) {
      throw new Error("Snapshot contém journal pendente; faça checkpoint antes da carga");
    }
  }
}

async function main() {
  const { values } = parseArgs({ options });
  const path = values.source;
  if (!path) throw new Error("Informe --source com o snapshot sanitizado de produção");
  stage = "target-guard";
  const url = assertLocalTarget(process.env.DATABASE_MIGRATION_URL);
  stage = "snapshot";
  assertNoPendingJournal(path);
  const sourceSha256 = await digest(path);
  stage = "selection";
  const selection = selectProduction(path);
  assertNoPendingJournal(path);
  if (await digest(path) !== sourceSha256) throw new Error("Snapshot mudou durante a seleção");
  stage = "migrations";
  await runMigrations();
  stage = "transactional-import";
  const { client } = connectDatabase(url);
  try {
    // importProduction locks every application table and requires an empty
    // target. Reset the local volume explicitly when another fixture is loaded.
    const result = await importProduction(client, selection);
    console.log(JSON.stringify({ mode: "local-import", sourceSha256, ...result }, null, 2));
  } finally { await client.end({ timeout: 5 }); }
}

try { await main(); }
catch (error) {
  // Never print a driver error: it can contain passwords, CV text or hashes.
  const candidateCode = error && typeof error === "object" && "code" in error ? String(error.code) : "VALIDATION";
  const code = /^[A-Z0-9_]{1,40}$/.test(candidateCode) ? candidateCode : "VALIDATION";
  console.error(JSON.stringify({ status: "failed", code, stage,
    message: "Importação local recusada; nenhum valor, query ou stack privado foi registrado" }));
  process.exitCode = 1;
}
