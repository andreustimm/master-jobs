import { execFileSync } from "node:child_process";

const git = (args, cwd = process.cwd()) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

// Diagnóstico local. Um HEAD contido em dev não prova que o WIP foi entregue,
// nem substitui a confirmação da PR (especialmente em merges por squash).
const blocks = git(["worktree", "list", "--porcelain"]).split("\n\n");
for (const block of blocks) {
  if (!block.trim()) continue;
  const lines = block.split("\n");
  const path = lines.find((line) => line.startsWith("worktree ")).slice(9);
  const branch = lines.find((line) => line.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "(detached)";
  if (lines.includes("bare")) continue;
  try {
    const changes = git(["status", "--porcelain", "--untracked-files=all"], path).split("\n").filter(Boolean).length;
    const commits = git(["rev-list", "--count", "origin/dev..HEAD"], path);
    console.log(`${branch}: ${changes} arquivo(s) pendente(s), ${commits} commit(s) fora de origin/dev\n  ${path}`);
  } catch {
    console.error(`${branch}: não foi possível inspecionar ${path}; nenhuma alteração feita.`);
    process.exitCode = 1;
  }
}
