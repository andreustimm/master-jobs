import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
let cached: { client: postgres.Sql; db: DB } | undefined;

/** Explicit PostgreSQL connection; never silently falls back to a local file. */
export function connectDatabase(url: string): { client: postgres.Sql; db: DB } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  // TLS policy cannot be weakened through connection-string query parameters.
  if (parsed.search) throw new Error("Configure PostgreSQL options separately from DATABASE_URL");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const ca = process.env.DATABASE_CA_CERT;
  const client = postgres(url, {
    ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(ca, "utf8") } : {}) },
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}

export function getDb(): DB {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url?.trim()) throw new Error("DATABASE_URL is required; SQLite/Turso is no longer the runtime database");
    cached = connectDatabase(url);
  }
  return cached.db;
}

/** Await in CLI/tests so pending work drains before teardown. */
export async function closeDb(): Promise<void> {
  const previous = cached;
  cached = undefined;
  await previous?.client.end({ timeout: 5 });
}

export { schema };
