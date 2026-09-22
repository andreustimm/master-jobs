import { execFileSync } from "node:child_process";

/** Tag `v*` mais alta; a política do repositório exige que toda `v*` seja SemVer canônica. */
export function mostRecentVersionTag(directory = process.cwd(), reachableFrom?: string): string | null {
  const output = execFileSync(
    "git",
    ["tag", "--list", "v*", "--sort=-version:refname", ...(reachableFrom ? ["--merged", reachableFrom] : [])],
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
  return commitSubjectsSince(base, directory, latest);
}

/** Explicit immutable boundary used to replay a prepared release after tags advance. */
export function commitSubjectsSince(base: string, directory: string, since: string | null): string[] {
  const range = since ? `${since}..${base}` : base;
  return execFileSync(
    "git",
    ["log", "--format=%s", "--no-merges", range],
    { cwd: directory, encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
