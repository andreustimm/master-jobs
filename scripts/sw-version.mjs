/**
 * Gera `public/sw.js` a partir de `scripts/sw-template.js`.
 *
 * O template é a fonte e está no git; `public/sw.js` é derivado e está no
 * `.gitignore`. A marca de versão entra no lugar de `__APP_VERSION__`.
 *
 * **Por que gerar em vez de editar no lugar.** O padrão de onde este desenho
 * veio injeta a versão no `prebuild` e devolve o placeholder no `postbuild`.
 * Aquilo funciona quando o build é fotografado por um provedor — o artefato sai
 * com a versão dentro e o `postbuild` só limpa a árvore local. Aqui o servidor
 * é `next start` lendo `public/` do disco: restaurar antes de servir entregaria
 * um service worker com a string `__APP_VERSION__` literal, e todos os caches
 * se chamariam `static-__APP_VERSION__` para sempre — nenhum deploy invalidaria
 * nada.
 *
 * **Por que a marca não é só a versão do `package.json`.** Era, e estava
 * quebrada pelo mesmo motivo que o parágrafo acima descreve: `version` está em
 * `0.1.0` desde o primeiro commit e o projeto não faz release. Os nomes de
 * cache derivam da marca, então dois deploys seguidos produziam
 * `static-0.1.0` e `static-0.1.0` — o `activate` olhava, via o mesmo nome, e
 * não apagava coisa alguma. Um chunk de JavaScript da versão anterior ficaria
 * servido para sempre. A versão continua na marca porque é legível; o que
 * garante a invalidação é a revisão colada nela.
 *
 * **De onde vem a revisão.** Deploy por CLI não sobe o `.git`, então
 * `git rev-parse` não existe lá dentro — a revisão precisa chegar por ambiente.
 * A ordem abaixo vai do mais informativo ao meramente único.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

function revisao() {
  // Integração com git na Vercel: o sha diz exatamente qual código está no ar.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);

  // Deploy por CLI: sem sha, mas o id do deploy é único e a URL o carrega.
  const id = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL;
  if (id) return id.replace(/[^a-z0-9]/gi, "").slice(0, 12);

  // Build local: o git está aqui.
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Sem git e sem ambiente — tarball, CI mínimo. Um valor aleatório aqui
    // invalidaria o cache a cada build, inclusive nos que não mudaram nada.
    // Estável e honesto é melhor: quem cair neste ramo não está publicando.
    return "sem-revisao";
  }
}

const marca = `${version}+${revisao()}`;
const template = readFileSync("scripts/sw-template.js", "utf8");

if (!template.includes("__APP_VERSION__")) {
  throw new Error("scripts/sw-template.js perdeu o marcador __APP_VERSION__");
}

writeFileSync("public/sw.js", template.replaceAll("__APP_VERSION__", marca));
console.log(`sw: public/sw.js gerado com a marca ${marca}`);
