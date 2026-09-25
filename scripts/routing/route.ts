// `pnpm route <papel> <complexidade> [--author <modelo>] [--unavailable a,b]`
//
// Imprime em JSON o provedor, o harness, o modelo e o effort que a política de
// `config/model-routing.json` manda usar. Falha fechado: política inválida,
// modo desconhecido ou juiz sem alternativa saem com código 1 e sem rota.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRoute, validateRouting, type Route } from "./model-routing.ts";

export const ROUTING_FILE = "config/model-routing.json";

export function loadRouting(root: string) {
  return validateRouting(JSON.parse(readFileSync(resolve(root, ROUTING_FILE), "utf8")));
}

export function parseArgs(argv: readonly string[]): { role: string; complexity: string; author?: string; unavailable: string[] } {
  const positional: string[] = [];
  let author: string | undefined;
  const unavailable: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--author" || arg === "--unavailable") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} exige um valor`);
      if (arg === "--author") author = value;
      else unavailable.push(...value.split(",").filter((provider) => provider !== ""));
    } else if (arg.startsWith("--")) {
      throw new Error(`opção desconhecida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error("uso: pnpm route <papel> <complexidade> [--author <modelo>] [--unavailable a,b]");
  return { role: positional[0]!, complexity: positional[1]!, author, unavailable };
}

export function main(argv: readonly string[], root: string): Route {
  return resolveRoute(loadRouting(root), parseArgs(argv));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2), process.cwd()), null, 2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
