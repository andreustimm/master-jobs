import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const START = "<!-- promotion-provenance:start -->";
const END = "<!-- promotion-provenance:end -->";

function block(body: string): [number, number] | undefined {
  const start = body.indexOf(START);
  const end = body.indexOf(END);
  if (start === -1 && end === -1) return undefined;
  if (start === -1 || end < start || body.lastIndexOf(START) !== start || body.lastIndexOf(END) !== end) {
    throw new Error("Bloco de proveniência ambíguo; preserve e revise a descrição da PR.");
  }
  return [start, end + END.length];
}

/** Replace only bot-owned provenance, retaining human notes and checked review items byte for byte. */
export function updatePromotionBody(previous: string, generated: string): string {
  const current = block(generated);
  if (!current) throw new Error("Descrição gerada sem bloco de proveniência.");
  const provenance = generated.slice(...current);
  const existing = block(previous);
  return existing
    ? `${previous.slice(0, existing[0])}${provenance}${previous.slice(existing[1])}`
    : `${provenance}\n\n${previous}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [previous, generated] = process.argv.slice(2);
  if (!previous || !generated) throw new Error("Uso: promotion-pr.ts <previous-body> <generated-body>");
  writeFileSync(generated, updatePromotionBody(readFileSync(previous, "utf8"), readFileSync(generated, "utf8")));
}
