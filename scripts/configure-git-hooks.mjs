import { spawnSync } from "node:child_process";

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
});

if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  console.log("Git worktree unavailable; local hooks were not configured.");
  process.exit(0);
}

const configured = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});
if (configured.status !== 0) process.exit(configured.status ?? 1);
console.log("Git hooks configured from .githooks.");
