import { execFileSync } from "node:child_process";

/** Tag `v*` mais alta; a política do repositório exige que toda `v*` seja SemVer canônica. */
export function mostRecentVersionTag(directory = process.cwd()): string | null {
  const output = execFileSync(
    "git",
    ["tag", "--list", "v*", "--sort=-version:refname"],
    { cwd: directory, encoding: "utf8" },
  ).trim();
  return output.split("\n").filter(Boolean)[0] ?? null;
}

/** Assuntos não-merge desde a última tag até a ref informada. */
export function commitSubjectsSinceLatestTag(
  base: string,
  directory = process.cwd(),
): string[] {
  const latest = mostRecentVersionTag(directory);
  const range = latest ? `${latest}..${base}` : base;
  return execFileSync(
    "git",
    ["log", "--format=%s", "--no-merges", range],
    { cwd: directory, encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
