/**
 * Hermetic E2E runner.
 *
 * A browser test must not seed the operator's database or depend on whichever
 * dev server happens to be open. Build, database, port and process lifetime all
 * belong to this run and are removed when it finishes.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { TASK04_FIXTURES } from "./task04-fixtures.mjs";
import { copiedToHarness } from "./database-guard.mjs";
import setupPostgres from "../support/postgres-global.ts";
import { provisionTestDatabase } from "../support/db.ts";
import { provisionRuntimeLogin } from "../support/runtime-login.ts";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manual = process.argv.includes("--manual");

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

function changelogFixture(locale) {
  const portuguese = locale === "pt-BR";
  const exclusive = portuguese ? "CONTEUDO_PT_EXCLUSIVO" : "ENGLISH_RELEASE_ONLY";
  const heading = portuguese ? "Destaques" : "Highlights";
  const body = portuguese
    ? "Parágrafo completo em português com **forte**, *ênfase* e `código em linha`."
    : "Complete English paragraph with **strong**, *emphasis*, and `inline code`.";
  const longBody = Array.from(
    { length: 24 },
    (_, index) => portuguese
      ? `Parágrafo longo ${index + 1} continua legível dentro do histórico sem deslocar o cabeçalho.`
      : `Long paragraph ${index + 1} remains readable inside the history without moving the header.`,
  ).join("\n\n");
  const rich = `### ${heading}

${exclusive}

${body}

- ${portuguese ? "item sem ordem" : "unordered item"}
  ${portuguese ? "continua na linha seguinte" : "continues on the next source line"}

1. ${portuguese ? "item ordenado" : "ordered item"}

\`\`\`ts
const releaseFixture = "${"x".repeat(420)}";
\`\`\`

> ${portuguese ? "Citação segura." : "Safe quotation."}

---

[${portuguese ? "link seguro muito longo" : "very long safe link"}](https://example.com/${"a".repeat(420)})

[unsafe](javascript:alert(1)) [data](data:text/html,unsafe)

![private export](/api/export)

<span id="changelog-raw-html" onclick="alert(1)">raw html</span>

<script>globalThis.__changelogScriptRan=true</script>

${longBody}`;

  const older = [];
  for (let patch = 97; patch >= 0; patch -= 1) {
    const publication = patch === 97 ? "2027-01-01T01:30:00.000Z" : "2026-08-20";
    const version = patch === 97 ? `0.9.${"9".repeat(120)}` : `0.9.${patch}`;
    older.push(`## [${version}] - ${publication}\n\n### ${heading}\n\n${exclusive} ${patch}.`);
  }

  // 0.8.1 is marked with its instant; 0.8.0 exists only in the technical
  // fixture below. Both are older than every noted version on purpose, so the
  // positional checks over the newest cards stay valid (issue #340).
  return `# ${portuguese ? "Novidades" : "What's New"}

<!-- sem-nota-usuario: 0.8.1 - 2026-08-19T12:00:00.000Z -->

## [Unreleased]

## [1.1.0] - 2026-08-22T11:46:00.000Z

${rich}

## [1.0.0] - 2026-08-21

### ${heading}

${exclusive} ${portuguese ? "histórico sem horário" : "historical date without time"}.

${older.join("\n\n")}
`;
}

/** Technical history: lists the versions the user fixtures omit, and nothing a user may read. */
const TECHNICAL_CHANGELOG_FIXTURE = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-08-22

### Added

- TECHNICAL_ONLY 1.1.0.

## [1.0.0] - 2026-08-21

### Added

- TECHNICAL_ONLY 1.0.0.

## [0.8.1] - 2026-08-19

### Fixed

- TECHNICAL_ONLY 0.8.1.

## [0.8.0] - 2026-08-18

### Fixed

- TECHNICAL_ONLY 0.8.0.
`;

const tracingRoot = dirname(ROOT);
const temporaryRoot = await mkdtemp(join(tracingRoot, ".jho-e2e-"));
const appRoot = join(temporaryRoot, "app");
const nextCli = join(ROOT, "node_modules", "next", "dist", "bin", "next");
let server;
let stopPostgres;
let testDatabase;
let runtimeLogin;

try {
  stopPostgres = await setupPostgres();
  testDatabase = await provisionTestDatabase();
  await cp(ROOT, appRoot, {
    recursive: true,
    filter: (source) => copiedToHarness(relative(ROOT, source)),
  });
  await symlink(join(ROOT, "node_modules"), join(appRoot, "node_modules"), "dir");
  if (!manual) await Promise.all([
    writeFile(join(appRoot, "USER_CHANGELOG.pt-BR.md"), changelogFixture("pt-BR")),
    writeFile(join(appRoot, "USER_CHANGELOG.en.md"), changelogFixture("en")),
    writeFile(join(appRoot, "CHANGELOG.md"), TECHNICAL_CHANGELOG_FIXTURE),
  ]);

  const port = await availablePort();
  const env = {
    ...process.env,
    JHO_OUTPUT_TRACING_ROOT: tracingRoot,
    JHO_AUTH_MODE: "secure",
    DATABASE_URL: testDatabase.url,
    DATABASE_MIGRATION_URL: testDatabase.url,
    JHO_TEST_DATABASE_URL: testDatabase.url,
    E2E_BASE: `http://127.0.0.1:${port}`,
    E2E_RESET_EXPIRED_TOKEN: TASK04_FIXTURES.resetExpiredToken,
    E2E_RESET_CONSUMED_TOKEN: TASK04_FIXTURES.resetConsumedToken,
    E2E_RESET_RACE_TOKEN: TASK04_FIXTURES.resetRaceToken,
    E2E_LOGIN_EXPIRED_TOKEN: TASK04_FIXTURES.loginExpiredToken,
    E2E_LOGIN_RACE_TOKEN: TASK04_FIXTURES.loginRaceToken,
    E2E_CLOSED_JOB_ID: String(TASK04_FIXTURES.closedJobId),
    E2E_DELETED_JOB_ID: String(TASK04_FIXTURES.deletedJobId),
  };

  await run(process.execPath, ["scripts/sw-version.mjs"], { cwd: appRoot, env });
  await run(process.execPath, ["scripts/build-changelog.ts"], { cwd: appRoot, env });
  await run(process.execPath, [nextCli, "build", "--webpack"], { cwd: appRoot, env });
  const standaloneAppRoot = join(appRoot, ".next", "standalone", relative(tracingRoot, appRoot));
  await access(join(standaloneAppRoot, "config", "certs", "supabase-ca.crt"));
  for (const file of ["USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md", "CHANGELOG.md"]) {
    // The complete browser suite must work without any source Markdown after build.
    await rm(join(appRoot, file));
    await rm(join(standaloneAppRoot, file), { force: true });
  }
  await Promise.all([
    cp(join(appRoot, "public"), join(standaloneAppRoot, "public"), { recursive: true }),
    cp(join(appRoot, ".next", "static"), join(standaloneAppRoot, ".next", "static"), {
      recursive: true,
    }),
  ]);
  console.log("✓ IT-011 standalone preparado com novidades compiladas e sem os Markdown de origem");
  await run(process.execPath, [manual ? "tests/e2e/setup-manual.ts" : "tests/e2e/setup.mjs"], { cwd: appRoot, env });
  runtimeLogin = await provisionRuntimeLogin(testDatabase.url);
  const runtimeEnv = { ...env, DATABASE_URL: runtimeLogin.url };
  delete runtimeEnv.DATABASE_MIGRATION_URL;
  delete runtimeEnv.JHO_TEST_POSTGRES_URL;
  delete runtimeEnv.JHO_TEST_DATABASE_URL;

  const startStandalone = () => spawn(
    process.execPath,
    [join(standaloneAppRoot, "server.js")],
    {
      cwd: standaloneAppRoot,
      env: { ...runtimeEnv, HOSTNAME: "127.0.0.1", PORT: String(port) },
      stdio: "inherit",
    },
  );
  server = startStandalone();
  await waitUntilReady(`${env.E2E_BASE}/login`, server);
  if (manual) {
    // Generated, private local credentials let the operator use the same
    // restricted runtime from the public CLI during journey verification.
    const runtimeFile = join(temporaryRoot, "runtime.env");
    await writeFile(runtimeFile, `DATABASE_URL=${runtimeLogin.url}\nJHO_AUTH_MODE=secure\n`, { mode: 0o600 });
    console.log(`QA manual ready: ${env.E2E_BASE}`);
    console.log(`Private CLI environment: ${runtimeFile}`);
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { await terminal.question("Press Enter to stop and remove this isolated QA environment.\n"); }
    finally { terminal.close(); }
  } else {
  await run(process.execPath, ["tests/e2e/ui.mjs"], { cwd: appRoot, env });
  await run(process.execPath, ["tests/e2e/a11y.mjs"], { cwd: appRoot, env });

  }
} finally {
  await stop(server);
  try { await runtimeLogin?.drop(); await testDatabase?.drop(); }
  finally {
    stopPostgres?.();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
