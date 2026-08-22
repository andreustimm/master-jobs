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
const releaseFixture = true;
\`\`\`

> ${portuguese ? "Citação segura." : "Safe quotation."}

---

[${portuguese ? "link seguro muito longo" : "very long safe link"}](https://example.com/${"a".repeat(420)})

[unsafe](javascript:alert(1)) [data](data:text/html,unsafe)

<span id="changelog-raw-html" onclick="alert(1)">raw html</span>

<script>globalThis.__changelogScriptRan=true</script>

${longBody}`;

  const older = [];
  for (let patch = 97; patch >= 0; patch -= 1) {
    const publication = patch === 97 ? "2027-01-01T01:30:00.000Z" : "2026-08-20";
    older.push(`## [0.9.${patch}] - ${publication}\n\n### ${heading}\n\n${exclusive} ${patch}.`);
  }

  return `# ${portuguese ? "Novidades" : "What's New"}

## [Unreleased]

## [1.1.0] - 2026-08-22T11:46:00.000Z

${rich}

## [1.0.0] - 2026-08-21

### ${heading}

${exclusive} ${portuguese ? "histórico sem horário" : "historical date without time"}.

${older.join("\n\n")}
`;
}

const tracingRoot = dirname(ROOT);
const temporaryRoot = await mkdtemp(join(tracingRoot, ".jho-e2e-"));
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
  await Promise.all([
    writeFile(join(appRoot, "USER_CHANGELOG.pt-BR.md"), changelogFixture("pt-BR")),
    writeFile(join(appRoot, "USER_CHANGELOG.en.md"), changelogFixture("en")),
  ]);

  const port = await availablePort();
  const env = {
    ...process.env,
    JHO_OUTPUT_TRACING_ROOT: tracingRoot,
    JHO_AUTH_MODE: "secure",
    TURSO_DATABASE_URL: `file:${join(temporaryRoot, "jobs.db")}`,
    E2E_BASE: `http://127.0.0.1:${port}`,
  };

  await run(process.execPath, ["scripts/sw-version.mjs"], { cwd: appRoot, env });
  await run(process.execPath, [nextCli, "build", "--webpack"], { cwd: appRoot, env });
  const standaloneAppRoot = join(appRoot, ".next", "standalone", relative(tracingRoot, appRoot));
  await Promise.all([
    access(join(standaloneAppRoot, "USER_CHANGELOG.pt-BR.md")),
    access(join(standaloneAppRoot, "USER_CHANGELOG.en.md")),
  ]);
  await Promise.all([
    cp(join(appRoot, "public"), join(standaloneAppRoot, "public"), { recursive: true }),
    cp(join(appRoot, ".next", "static"), join(standaloneAppRoot, ".next", "static"), {
      recursive: true,
    }),
  ]);
  console.log("✓ IT-011 standalone inclui os dois changelogs localizados");
  await run(process.execPath, ["tests/e2e/setup.mjs"], { cwd: appRoot, env });

  const startStandalone = () => spawn(
    process.execPath,
    [join(standaloneAppRoot, "server.js")],
    {
      cwd: standaloneAppRoot,
      env: { ...env, HOSTNAME: "127.0.0.1", PORT: String(port) },
      stdio: "inherit",
    },
  );
  server = startStandalone();
  await waitUntilReady(`${env.E2E_BASE}/login`, server);
  await run(process.execPath, ["tests/e2e/ui.mjs"], { cwd: appRoot, env });

  await stop(server);
  server = undefined;
  const malformed = `# Novidades

## [v1.2] - 2026-08-22

### Inválida

- Esta entrada não pode virar card.

## [1.0.0] - 2026-08-21

### Válida

- Esta entrada continua visível.
`;
  await Promise.all([
    writeFile(join(standaloneAppRoot, "USER_CHANGELOG.pt-BR.md"), malformed),
    writeFile(join(standaloneAppRoot, "USER_CHANGELOG.en.md"), malformed),
  ]);
  server = startStandalone();
  await waitUntilReady(`${env.E2E_BASE}/login`, server);
  await run(process.execPath, ["tests/e2e/changelog-degradation.mjs"], {
    cwd: appRoot,
    env: { ...env, E2E_CHANGELOG_MODE: "malformed" },
  });

  await stop(server);
  server = undefined;
  await Promise.all([
    writeFile(join(standaloneAppRoot, "USER_CHANGELOG.pt-BR.md"), "# Novidades\n\n## [Unreleased]\n"),
    writeFile(join(standaloneAppRoot, "USER_CHANGELOG.en.md"), "# What's New\n\n## [Unreleased]\n"),
  ]);
  server = startStandalone();
  await waitUntilReady(`${env.E2E_BASE}/login`, server);
  await run(process.execPath, ["tests/e2e/changelog-degradation.mjs"], {
    cwd: appRoot,
    env: { ...env, E2E_CHANGELOG_MODE: "empty" },
  });
} finally {
  await stop(server);
  await rm(temporaryRoot, { recursive: true, force: true });
}
