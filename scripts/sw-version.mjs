/**
 * Gera `public/sw.js` a partir de `scripts/sw-template.js`.
 *
 * O template é a fonte e está no git; `public/sw.js` é derivado e está no
 * `.gitignore`. A versão do `package.json` entra no lugar de `__APP_VERSION__`.
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
 * Gerar remove a dança inteira: não há estado intermediário, o git nunca vê
 * diferença, e o arquivo servido sempre tem a versão.
 *
 * A versão importa porque os nomes de cache derivam dela. Um deploy novo cria
 * caches novos e o `activate` apaga os antigos; sem isso, um chunk de JavaScript
 * da versão anterior seria servido para sempre.
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const template = readFileSync("scripts/sw-template.js", "utf8");

if (!template.includes("__APP_VERSION__")) {
  throw new Error("scripts/sw-template.js perdeu o marcador __APP_VERSION__");
}

writeFileSync("public/sw.js", template.replaceAll("__APP_VERSION__", version));
console.log(`sw: public/sw.js gerado com a versão ${version}`);
