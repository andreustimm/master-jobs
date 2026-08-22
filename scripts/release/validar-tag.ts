/** Valida o SHA remoto de uma tag antes de aceitá-la ou criá-la. */
import { estadoDaTag } from "../../src/core/release.ts";

const releaseSha = process.argv[2];
const tagSha = process.argv[3] || null;
const obrigatoria = process.argv.includes("--required");

if (!releaseSha) {
  throw new Error("uso: validar-tag.ts <release-sha> [tag-sha] [--required]");
}

console.log(estadoDaTag(releaseSha, tagSha, obrigatoria));
