import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import postgres from "postgres";
import { majorFromServerVersionNum, postgresTestImage, readPostgresMajors } from "../../scripts/versions/postgres-majors.ts";

/**
 * Test server is always created here; never accepts a user's production URL.
 * The major comes from `config/postgres-majors.json` (newest by default;
 * `JHO_TEST_POSTGRES_MAJOR` picks another declared one).
 */
export default async function setup() {
  const image = postgresTestImage(process.env, readPostgresMajors());
  const password = randomBytes(24).toString("hex");
  const started = spawnSync("docker", ["run", "--rm", "-d", "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_PASSWORD", image], { encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: password } });
  const container = started.stdout.trim();
  if (started.status !== 0 || !/^[a-f0-9]{64}$/.test(container)) throw new Error("Docker PostgreSQL is required for tests");
  const cleanup = () => {
    const result = spawnSync("docker", ["stop", "--time", "5", container], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Test container cleanup required: ${container}`);
  };
  try {
    const binding = spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).stdout.trim();
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error("Test PostgreSQL must bind to loopback");
    const url = `postgres://postgres:${password}@${binding}/postgres`;
    const admin = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    let ready = false;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        try { await admin`SELECT 1`; ready = true; break; } catch { await setTimeout(500); }
      }
      if (ready) {
        // The run claims a major; prove the server is that major, not whatever the tag resolved to.
        const [row] = await admin`SHOW server_version_num`;
        const served = majorFromServerVersionNum(row!.server_version_num as string);
        if (`postgres:${served}` !== image) throw new Error(`Test PostgreSQL is ${served}, expected ${image}`);
        await admin.unsafe("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS");
      }
    } finally { await admin.end({ timeout: 1 }); }
    if (!ready) throw new Error("Test PostgreSQL readiness timeout");
    process.env.JHO_TEST_POSTGRES_URL = url;
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
