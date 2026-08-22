/** Valida o SHA remoto de uma tag antes de aceitá-la ou criá-la. */
import { estadoDaTag, exigirTagAlvoAusente } from "../../src/core/release.ts";

const releaseSha = process.argv[2];
const tagSha = process.argv[3] || null;
const obrigatoria = process.argv.includes("--required");
const deveEstarAusente = process.argv.includes("--must-be-missing");

if (deveEstarAusente) {
  console.log(exigirTagAlvoAusente(tagSha));
} else if (!releaseSha) {
  throw new Error("uso: validar-tag.ts <release-sha> [tag-sha] [--required]");
} else {
  console.log(estadoDaTag(releaseSha, tagSha, obrigatoria));
}
