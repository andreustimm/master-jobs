/**
 * Hermetic E2E runner.
 *
 * A browser test must not seed the operator's database or depend on whichever
 * dev server happens to be open. Build, database, port and process lifetime all
 * belong to this run and are removed when it finishes.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXCLUDED_ROOTS = new Set([
  ".git",
  ".next",
  "data",
  "node_modules",
  ".env",
  ".env.local",
]);

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate E2E port");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitUntilReady(url, process) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error("E2E server exited before becoming ready");
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // The port is private to this runner; refusal only means startup continues.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E server did not become ready at ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "jho-e2e-"));
const appRoot = join(temporaryRoot, "app");
const nextCli = join(ROOT, "node_modules", "next", "dist", "bin", "next");
let server;

try {
  await cp(ROOT, appRoot, {
    recursive: true,
    filter(source) {
      const path = relative(ROOT, source);
      if (!path) return true;
      return !EXCLUDED_ROOTS.has(path.split(sep)[0]);
    },
  });
  await symlink(join(ROOT, "node_modules"), join(appRoot, "node_modules"), "dir");

  const port = await availablePort();
  const env = {
    ...process.env,
    JHO_AUTH_MODE: "secure",
    TURSO_DATABASE_URL: `file:${join(temporaryRoot, "jobs.db")}`,
    E2E_BASE: `http://127.0.0.1:${port}`,
  };

  await run(process.execPath, [nextCli, "build", "--webpack"], { cwd: appRoot, env });
  await run(process.execPath, ["tests/e2e/setup.mjs"], { cwd: appRoot, env });

  server = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: appRoot, env, stdio: "inherit" },
  );
  await waitUntilReady(`${env.E2E_BASE}/login`, server);
  await run(process.execPath, ["tests/e2e/ui.mjs"], { cwd: appRoot, env });
} finally {
  await stop(server);
  await rm(temporaryRoot, { recursive: true, force: true });
}
