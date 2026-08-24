/**
 * Generates the two ignored PWA artifacts from committed pure sources.
 * `offline.html` deliberately has no revision marker: the same localized
 * document must remain byte-identical when only a deployment id changes.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderOfflineDocument } from "../src/core/pwa/offline.ts";

const VERSION_MARKER = "__APP_VERSION__";

function safeRevision(value) {
  const normalized = String(value ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  return normalized || "sem-revisao";
}

export function resolveRevision(environment = process.env) {
  if (environment.VERCEL_GIT_COMMIT_SHA) {
    return safeRevision(environment.VERCEL_GIT_COMMIT_SHA.slice(0, 7));
  }

  const deployment = environment.VERCEL_DEPLOYMENT_ID ?? environment.VERCEL_URL;
  if (deployment) return safeRevision(deployment);

  try {
    return safeRevision(execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim());
  } catch {
    return "sem-revisao";
  }
}

export function generatePwaArtifacts({
  revision = resolveRevision(),
  rootDirectory = process.cwd(),
  outputDirectory = resolve(rootDirectory, "public"),
} = {}) {
  const version = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8")).version;
  const marker = `${version}+${safeRevision(revision)}`;
  const template = readFileSync(resolve(rootDirectory, "scripts/sw-template.js"), "utf8");

  if (!template.includes(VERSION_MARKER)) {
    throw new Error(`scripts/sw-template.js perdeu o marcador ${VERSION_MARKER}`);
  }

  mkdirSync(outputDirectory, { recursive: true });
  const worker = template.replaceAll(VERSION_MARKER, marker);
  const offline = renderOfflineDocument();
  writeFileSync(resolve(outputDirectory, "sw.js"), worker);
  writeFileSync(resolve(outputDirectory, "offline.html"), offline);
  return { marker, worker, offline };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const { marker } = generatePwaArtifacts();
  console.log(`pwa: sw.js e offline.html gerados com a marca ${marker}`);
}
