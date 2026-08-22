/** Consulta a API e devolve o SHA somente da tag exata pedida. */
import { execFileSync } from "node:child_process";
import { shaDaTagRemota } from "../../src/core/release.ts";

const repositorio = process.argv[2];
const versao = process.argv[3];

if (!repositorio || !versao) {
  throw new Error("uso: tag-remota.ts <owner/repo> <versão>");
}

// `matching-refs` devolve 200 + [] para ausência. Qualquer falha do `gh` é
// propagada e interrompe o workflow antes de commit/push.
const resposta = execFileSync(
  "gh",
  ["api", `repos/${repositorio}/git/matching-refs/tags/v${versao}`],
  { encoding: "utf8" },
);
const sha = shaDaTagRemota(JSON.parse(resposta) as unknown, versao);
console.log(sha ?? "");
