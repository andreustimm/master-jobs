/** Resolve, na ref informada, o commit exato que persistiu uma versão. */
import { execFileSync } from "node:child_process";
import { commitDaVersao } from "../../src/core/release.ts";

const ref = process.argv[2];
const versao = process.argv[3];

if (!ref || !versao) {
  throw new Error("uso: commit-da-versao.ts <ref> <versão>");
}

const log = execFileSync("git", ["log", "--format=%H%x09%s", ref], {
  encoding: "utf8",
});

console.log(commitDaVersao(log, versao));
