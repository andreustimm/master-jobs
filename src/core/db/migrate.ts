import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "./client.ts";

/** Separate privileged connection. Runtime credentials need no DDL rights. */
export async function runMigrations(folder = "./drizzle/postgres"): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url?.trim()) throw new Error("DATABASE_MIGRATION_URL is required to apply migrations");
  const { db, client } = connectDatabase(url);
  try { await migrate(db, { migrationsFolder: folder }); }
  finally { await client.end({ timeout: 5 }); }
}
