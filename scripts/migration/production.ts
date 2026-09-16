import { createHash } from "node:crypto";
import { createReadStream, statSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { connectDatabase } from "../../src/core/db/client.ts";
import { selectProduction } from "./select-production.ts";
import { importProduction } from "./import-production.ts";
import { assertProductionTarget, PRODUCTION_PROJECT_REF } from "./production-target.ts";

const options = {
  source: { type: "string" }, apply: { type: "boolean", default: false },
  "source-sha256": { type: "string" }, "confirm-project": { type: "string" },
  "writers-paused": { type: "boolean", default: false },
} as const;
let stage = "arguments";

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function assertNoPendingJournal(path: string) {
  for (const suffix of ["-wal", "-journal"]) {
    if (existsSync(path + suffix) && statSync(path + suffix).size > 0) {
      throw new Error("Snapshot contém journal pendente; exporte e faça checkpoint antes da carga");
    }
  }
}

async function main() {
  const { values } = parseArgs({ options });
  const path = values.source;
  if (!path) throw new Error("Informe --source com o snapshot final exportado do Turso");
  stage = "snapshot";
  assertNoPendingJournal(path);
  const sourceSha256 = await digest(path);
  stage = "selection";
  const selection = selectProduction(path);
  // The selector held a read transaction, so a concurrent writer could not
  // produce a mixed view. Check both sidecars and the main file after it
  // commits; apply mode additionally requires the human writer pause.
  assertNoPendingJournal(path);
  if (await digest(path) !== sourceSha256) throw new Error("Snapshot mudou durante a seleção");
  if (!values.apply) {
    console.log(JSON.stringify({ mode: "plan-only", project: PRODUCTION_PROJECT_REF, sourceSha256,
      manifest: selection.manifest }, null, 2));
    return;
  }
  stage = "cutover-confirmation";
  if (values["confirm-project"] !== PRODUCTION_PROJECT_REF || !values["writers-paused"] ||
      values["source-sha256"] !== sourceSha256) {
    throw new Error("Carga exige --confirm-project, --writers-paused e --source-sha256 correspondentes ao corte aprovado");
  }
  stage = "target-configuration";
  const url = assertProductionTarget(process.env.DATABASE_MIGRATION_URL);
  process.env.DATABASE_CA_CERT ??= "config/certs/supabase-ca.crt";
  const { client } = connectDatabase(url);
  try {
    // Migrations are an explicit earlier step. This command only loads data
    // into an already-migrated, empty target and verifies it before commit.
    stage = "transactional-import";
    const result = await importProduction(client, selection);
    console.log(JSON.stringify({ mode: "imported", project: PRODUCTION_PROJECT_REF, sourceSha256, ...result }, null, 2));
  } finally { await client.end({ timeout: 5 }); }
}

try { await main(); }
catch (error) {
  // Driver errors may contain parameters (CVs/password hashes). Never print
  // the original error, its cause, its query or its stack from this command.
  const candidateCode = error && typeof error === "object" && "code" in error ? String(error.code) : "VALIDATION";
  const code = /^[A-Z0-9_]{1,40}$/.test(candidateCode) ? candidateCode : "VALIDATION";
  console.error(JSON.stringify({ status: "failed", code, stage,
    message: "Importação recusada; nenhum valor, query ou stack privado foi registrado" }));
  process.exitCode = 1;
}
