/**
 * Single libSQL client for both runtimes.
 *
 * Local dev  -> file:./data/jobs.db   (a plain SQLite file, no server)
 * Vercel     -> libsql://<db>.turso.io with an auth token
 *
 * Same driver, same SQL, same migrations. That is the whole reason this project
 * uses libSQL instead of better-sqlite3: Vercel's filesystem is ephemeral, so a
 * local-file-only database would silently lose every application you tracked.
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.ts";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let cached: { client: Client; db: DB } | undefined;

function resolveUrl(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (url && url.length > 0) return url;
  // Default keeps `pnpm jho` working with zero configuration.
  return "file:./data/jobs.db";
}

export function getDb(): DB {
  if (cached) return cached.db;

  const url = resolveUrl();
  const authToken = process.env.TURSO_AUTH_TOKEN;

  // A remote URL without a token is almost always a misconfigured deploy, and
  // failing loudly here beats a confusing 401 deep inside a cron run.
  if (!url.startsWith("file:") && !authToken) {
    throw new Error(
      `TURSO_DATABASE_URL points at a remote database (${url}) but TURSO_AUTH_TOKEN is empty.`,
    );
  }

  const client = createClient(authToken ? { url, authToken } : { url });
  const db = drizzle(client, { schema });
  cached = { client, db };
  return db;
}

/** Only for tests and CLI teardown; the Next.js runtime keeps the client warm. */
export function closeDb(): void {
  cached?.client.close();
  cached = undefined;
}

export { schema };
