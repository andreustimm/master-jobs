/**
 * Onde o sistema pode falar com a internet — e a prova de que preparar uma
 * candidatura não é um desses lugares.
 *
 * A regra 13 diz que nada aqui envia candidatura, e a ADR 0010 diz que isso é
 * ausência de capacidade, não um serviço de submissão desligado. Ausência não
 * se testa chamando a coisa; testa-se pelo inventário: todo arquivo de `src/`
 * e `app/` que abre transporte de saída está numa lista fechada, cada um com a
 * sua finalidade. Um adapter de envio para Greenhouse, Lever ou Workday
 * precisaria de transporte — e entraria aqui como arquivo novo, fora da lista,
 * reprovando o teste até alguém escrever por que ele existe.
 *
 * O teste tem duas metades de propósito:
 *   1. o detector é exercitado contra trechos sintéticos, positivos e
 *      negativos, para que um detector quebrado não passe como inventário
 *      vazio (o jeito mais comum de um teste de fitness mentir);
 *   2. o inventário real é comparado com a lista em igualdade, então também
 *      reprova entrada obsoleta.
 *
 * O que ele NÃO prova, e por isso a prova de comportamento continua em
 * `cov-apply-dossier.test.ts` (fetch e porta HTTP instrumentados, zero pedido):
 *   - chamada que reutiliza um transporte já listado para outro destino — um
 *     `safeRemoteFetch(applyUrl, { method: "POST" })` num arquivo listado passa
 *     aqui; a revisão da lista é humana e fica nos arquivos listados;
 *   - código montado por string ou `eval`, e scripts fora de `src/` e `app/`;
 *   - ferramentas de agente e skills, que agem fora deste runtime — essas são
 *     cobertas pela política escrita (`docs/linkedin-policy.md`, ADR 0010).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Tira comentários e o conteúdo de strings simples, para que `// fetch(x)` e
 * `"use fetch"` não contem. Template literal fica: ele pode interpolar código.
 */
function stripNoise(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

const TRANSPORT_MODULES =
  /\bfrom\s+["'](node:)?(http|https|http2|net|tls|dgram|undici|axios|got|node-fetch|ky|ws)["']|\bimport\(\s*["'](node:)?(http|https|http2|net|tls|dgram|undici|axios|got|node-fetch|ky|ws)["']\s*\)|\brequire\(\s*["'](node:)?(http|https|http2|net|tls|dgram|undici|axios|got|node-fetch|ky|ws)["']\s*\)/;

/**
 * Que tipo de transporte de saída o trecho usa. Vazio quando nenhum.
 *
 * Os módulos são lidos ANTES de apagar as strings (o nome do módulo é uma
 * string); o uso de `fetch` é lido DEPOIS, para ignorar comentário e texto.
 */
function outboundTransportUses(source: string): string[] {
  const uses = new Set<string>();
  const imports = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const moduleHit = TRANSPORT_MODULES.exec(imports);
  if (moduleHit) uses.add(`module:${moduleHit[2] ?? moduleHit[4] ?? moduleHit[6]}`);

  const code = stripNoise(source);
  for (const line of code.split("\n")) {
    // Definição ou assinatura de método chamado `fetch` (porta de câmbio) não
    // é transporte; uma chamada solta `fetch(url, ...);` continua sendo.
    if (/^\s*async\s+fetch\s*\(/.test(line)) continue;
    if (/^\s*fetch\s*\([^)]*\)\s*:/.test(line)) continue;
    const withoutTypes = line.replace(/\btypeof\s+fetch\b/g, "");
    if (/(?<![.\w$])fetch\b/.test(withoutTypes)) uses.add("fetch");
    if (/\b(globalThis|window|self)\s*\.\s*fetch\b/.test(withoutTypes)) uses.add("fetch");
    if (/\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/.test(withoutTypes)) uses.add("xhr/ws");
    if (/\bnavigator\s*\.\s*sendBeacon\b/.test(withoutTypes)) uses.add("beacon");
  }
  return [...uses].sort();
}

/**
 * Cada arquivo que pode abrir transporte, e o que ele faz com isso. Nenhuma
 * finalidade aqui é "enviar ao empregador ou ATS" — e não pode passar a ser.
 */
const ALLOWED: Record<string, string> = {
  "src/core/remote-url.ts":
    "único transporte para URL de vaga (adapters, sonda, captura): SSRF e recusa do LinkedIn por salto",
  "src/core/scrape/fetcher.ts":
    "captura HTML de vaga; injeta o fetch global, mas sempre por dentro de safeRemoteFetch",
  "src/core/llm/providers.ts": "BYOK: leitura qualitativa de vaga, com confirmação antes de enviar",
  "src/core/mail/gmail.ts": "Gmail somente leitura (ADR 0008) e callback OAuth em loopback",
  "src/contexts/auth/infra/resend-mailer.ts": "e-mail transacional da própria conta (recuperar senha)",
  "src/contexts/operations/infra/github-dispatch.ts": "dispara workflow do próprio repositório",
};

const ROOT = resolve(".");
const FILES = [...walk("src"), ...walk("app")].map((f) => relative(ROOT, resolve(f)));

describe("detector de transporte de saída", () => {
  it("encontra os jeitos reais de um envio sair", () => {
    const positives: Array<[string, string]> = [
      ['await fetch("https://boards.greenhouse.io/v1/boards/acme/jobs/1", { method: "POST" });', "fetch"],
      ["const send = options.fetchImpl ?? fetch;", "fetch"],
      ["export function mailer(fetchImpl = fetch) {}", "fetch"],
      ["await globalThis.fetch(url, init);", "fetch"],
      ['import { request } from "node:https";', "module:https"],
      ["import axios from 'axios';", "module:axios"],
      ['const { fetch: f } = await import("undici");', "module:undici"],
      ['const net = require("net");', "module:net"],
      ["const ws = new WebSocket(url);", "xhr/ws"],
      ["navigator.sendBeacon(url, body);", "beacon"],
      ['  fetch(applyUrl, { method: "POST" });', "fetch"],
      ["fetch(url);", "fetch"],
    ];
    for (const [snippet, kind] of positives) {
      expect(outboundTransportUses(snippet), snippet).toContain(kind);
    }
  });

  it("não confunde comentário, texto, tipo ou método homônimo com transporte", () => {
    const negatives = [
      "// fetch(url) só depois de a pessoa confirmar",
      "/* import axios from 'axios' */",
      'const hint = "rode fetch() depois";',
      "opts: { fetchImpl?: typeof fetch } = {}",
      "const quote = await provider.fetch(input.base);",
      "  async fetch(base) {",
      "  fetch(base: Currency): Promise<FxQuote>;",
      "const refetched = prefetch(1);",
      'import { lookup } from "node:dns/promises";',
    ];
    for (const snippet of negatives) {
      expect(outboundTransportUses(snippet), snippet).toEqual([]);
    }
  });
});

describe("inventário de transporte de saída", () => {
  it("só os arquivos listados, com finalidade escrita, abrem transporte", () => {
    const found = FILES.filter((file) => outboundTransportUses(readFileSync(file, "utf8")).length > 0);
    expect(found.sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});

/* ------------------------------------------------ preparação sem transporte */

function localImports(file: string): string[] {
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  const specs = [
    ...code.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g),
    ...code.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g),
    ...code.matchAll(/^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gm),
  ].map((m) => m[1]!);
  return specs.map((spec) => relative(ROOT, resolve(dirname(file), spec)));
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of localImports(file)) {
      if (/\.(ts|tsx)$/.test(next)) stack.push(next);
    }
  }
  return seen;
}

describe("preparar candidatura não abre transporte (regra 13)", () => {
  it("o dossiê só alcança, por import, o transporte de URL de vaga — e não o chama", () => {
    // O grafo estático é mais largo do que o comportamento, por causa dos
    // barris de contexto: matching → câmbio → porta HTTP dos adapters (para
    // atualizar cotações) e matching → candidato → auth → mailer (para
    // recuperar senha). Os dois caminhos estão FIXADOS aqui para que um
    // transporte novo no grafo (LLM, Gmail, dispatch, um cliente de ATS)
    // apareça como diferença. A prova de que nada é CHAMADO é de efeito:
    // `cov-apply-dossier.test.ts` instrumenta `fetch` e a porta e conta zero.
    const graph = reachable("src/core/apply/dossier.ts");
    expect(graph.size).toBeGreaterThan(5); // o grafo foi de fato percorrido
    expect([...graph].filter((file) => file in ALLOWED).sort()).toEqual([
      "src/contexts/auth/infra/resend-mailer.ts",
      "src/core/remote-url.ts",
    ]);
    // O próprio código de preparação não abre transporte nenhum.
    for (const file of [...graph].filter((f) => f.startsWith("src/core/apply/"))) {
      expect(outboundTransportUses(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });

  it("o comando `prep` só importa o dossiê — nenhum módulo de rede", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    const start = cli.indexOf('.command("prep <id>")');
    expect(start).toBeGreaterThan(0);
    // O próximo comando registrado, seja em `program` ou em um subcomando.
    const end = cli.slice(start + 1).search(/\n(program|const \w+ = program)\b/);
    const action = end >= 0 ? cli.slice(start, start + 1 + end) : cli.slice(start);
    expect(action).toContain("buildDossier");
    expect(action).not.toContain('.command("queue")');
    const dynamic = [...action.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    expect(dynamic).toEqual(["./core/apply/dossier.ts"]);
    expect(outboundTransportUses(action)).toEqual([]);
  });
});
