import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planejarGithubReleases } from "../../src/core/release.ts";

export type GitHubReleaseSyncOptions = {
  apply: boolean;
  directory: string;
  repository: string;
};

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} exige um valor`);
  return value;
}

function parseOptions(args: string[]): GitHubReleaseSyncOptions {
  const options: GitHubReleaseSyncOptions = {
    apply: false,
    directory: process.cwd(),
    repository: process.env.GITHUB_REPOSITORY ?? "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--repo") {
      options.repository = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === "--directory") {
      options.directory = resolve(requiredValue(args, index, arg));
      index += 1;
    } else {
      throw new Error(`argumento desconhecido: ${arg}`);
    }
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error("informe --repo owner/repository ou GITHUB_REPOSITORY");
  }
  return options;
}

function lines(command: string, args: string[], directory: string): string[] {
  return execFileSync(command, args, { cwd: directory, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function syncGithubReleases(options: GitHubReleaseSyncOptions): string[] {
  // A tag desta execução nasce pela API do GitHub. Atualizar as refs aqui
  // garante que o mesmo run a enxergue antes de planejar as Releases.
  execFileSync("git", ["fetch", "origin", "--tags", "--quiet"], {
    cwd: options.directory,
    stdio: "inherit",
  });
  const tags = lines("git", ["tag", "--list", "v*", "--sort=version:refname"], options.directory);
  const existingReleaseTags = lines(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${options.repository}/releases`,
      "--jq",
      ".[].tag_name",
    ],
    options.directory,
  );
  const technicalChangelog = readFileSync(resolve(options.directory, "CHANGELOG.md"), "utf8");
  const plan = planejarGithubReleases({ tags, existingReleaseTags, technicalChangelog });

  for (const release of plan) {
    if (!options.apply) continue;
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "POST",
        `repos/${options.repository}/releases`,
        "-f",
        `tag_name=${release.tag}`,
        "-f",
        `name=${release.name}`,
        "-f",
        `body=${release.body}`,
        "-F",
        "draft=false",
        "-F",
        "prerelease=false",
        "-f",
        "make_latest=legacy",
        "--silent",
      ],
      { cwd: options.directory, stdio: "inherit" },
    );
  }

  return plan.map((release) => release.tag);
}

const direct = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (direct) {
  const options = parseOptions(process.argv.slice(2));
  const plannedTags = syncGithubReleases(options);
  const action = options.apply ? "created" : "would-create";
  if (plannedTags.length === 0) console.log("github-releases current");
  else for (const tag of plannedTags) console.log(`${action} ${tag}`);
}
