// `pnpm route <papel> <complexidade> [--session <harness>] [--author <modelo>]… [--unavailable a,b]`
//
// Imprime em JSON o provedor, o harness, o modelo, o effort e o valor do campo
// de modelo da chamada de delegação (`agentModel`) que a política de
// `config/model-routing.json` manda usar. Falha fechado: política inválida,
// modo desconhecido ou juiz sem alternativa saem com código 1 e sem rota.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRoute, validateRouting, type Route, type RouteRequest, type Routing } from "./model-routing.ts";

export const ROUTING_FILE = "config/model-routing.json";

export function loadRouting(root: string): Routing {
  return validateRouting(JSON.parse(readFileSync(resolve(root, ROUTING_FILE), "utf8")));
}

const USAGE =
  "uso: pnpm route <papel> <complexidade> [--session <harness>] [--author <modelo>]… [--unavailable a,b]";

export function parseArgs(argv: readonly string[]): RouteRequest {
  const positional: string[] = [];
  const authors: string[] = [];
  const unavailable: string[] = [];
  let session: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--author" || arg === "--unavailable" || arg === "--session") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} exige um valor`);
      const values = value.split(",").filter((item) => item !== "");
      if (arg === "--author") authors.push(...values);
      else if (arg === "--unavailable") unavailable.push(...values);
      else session = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`opção desconhecida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  return { role: positional[0]!, complexity: positional[1]!, authors, unavailable, session };
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
