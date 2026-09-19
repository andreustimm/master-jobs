import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "./client.ts";
import { resolveDatabaseUrl } from "./config.ts";

/**
 * Conexão privilegiada separada. A credencial de runtime não precisa de DDL.
 *
 * A ordem de nomes aqui prefere a conexão DIRETA à do pooler: DDL em pooler
 * modo transação é onde migrations travam sem explicar por quê.
 */
export async function runMigrations(folder = "./drizzle/postgres"): Promise<void> {
  const { url, source } = resolveDatabaseUrl("migration");
  const { db, client } = connectDatabase(url, source);
  try { await migrate(db, { migrationsFolder: folder }); }
  finally { await client.end({ timeout: 5 }); }
}
