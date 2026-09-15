import { randomBytes } from "node:crypto";
import postgres from "postgres";

/** A real low-privilege login for E2E; never accepts a production connection. */
export async function provisionRuntimeLogin(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" || !/^\/jho_test_[a-f0-9]{32}$/.test(url.pathname)) {
    throw new Error("Runtime login fixture requires an isolated test database");
  }
  const name = "jho_runtime_" + randomBytes(12).toString("hex");
  const password = randomBytes(32).toString("hex");
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    // Both interpolated values are freshly generated hex, never user input.
    await admin.unsafe(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}' IN ROLE master_jobs_runtime
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  } finally { await admin.end(); }
  url.username = name;
  url.password = password;
  return {
    url: url.toString(),
    async drop() {
      const connection = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try { await connection.unsafe(`DROP ROLE "${name}"`); }
      finally { await connection.end(); }
    },
  };
}
