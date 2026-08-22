/** Avança staging por fast-forward até a fronteira exata desta promoção. */
import { execFileSync } from "node:child_process";

const remote = process.argv[2] ?? "origin";
const staging = process.argv[3] ?? "origin/staging";
const dev = process.argv[4] ?? "origin/dev";
const releaseSha = process.argv[5] || null;
const alvo = releaseSha ?? dev;

try {
  execFileSync("git", ["merge-base", "--is-ancestor", staging, alvo], {
    stdio: "ignore",
  });
} catch {
  throw new Error(`staging não pode avançar por fast-forward até ${alvo}`);
}

const adiante = execFileSync("git", ["rev-list", "--count", `${staging}..${alvo}`], {
  encoding: "utf8",
}).trim();

execFileSync("git", ["push", remote, `${alvo}:refs/heads/staging`], {
  stdio: "inherit",
});

console.log(`staging avançou ${adiante} commit(s) até ${alvo}`);
