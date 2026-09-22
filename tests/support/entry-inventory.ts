import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inventário das entradas HTTP do Next — descoberto, não listado à mão.
 *
 * A versão anterior do teste de autorização coletava arquivos terminados em
 * `actions.ts` e procurava `export async function`. Uma Server Action em
 * `logout-action.ts`, uma `export const x = async () => …`, um
 * `export { a as b }` ou um `"use server"` dentro de uma função passavam sem
 * ser vistos, e a omissão era invisível na revisão porque o arquivo parecia
 * código comum. Aqui a descoberta segue a SEMÂNTICA do framework:
 *
 * - página: arquivo `page.*` sob `app/`;
 * - Route Handler: arquivo `route.*` sob `app/`, e cada método HTTP exportado;
 * - Server Action: todo export de módulo cuja primeira instrução é a diretiva
 *   `"use server"`, qualquer que seja o nome do arquivo ou a forma do export,
 *   e toda função com a diretiva no próprio corpo.
 *
 * A leitura é léxica, sem compilador: comentários são removidos respeitando
 * strings, e o resto são padrões ancorados em sintaxe de export. O limite é
 * declarado — código gerado por macro ou export montado em tempo de execução
 * não existe neste repositório e não seria visto. O que o inventário prova é
 * PRESENÇA e ORDEM do guarda; a negação efetiva é provada em
 * `tests/entry-denial.test.ts`, chamando as actions de verdade.
 */

export const ROUTING_ROOTS = ["app"] as const;
const SOURCE_ROOTS = ["app", "components", "lib", "src"] as const;
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mdx)$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(full)) out.push(full);
  }
  return out;
}

/**
 * O código sem comentários, com strings e templates preservados.
 *
 * Sem isso, `"use server"` citado num comentário (como em `app/auth.ts`)
 * contaria como diretiva, e um `export async function` comentado contaria como
 * action. O contrário também: um export real depois de um comentário com `{`
 * deslocaria a busca pelo corpo.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i++;
      // Aspas simples e duplas não atravessam linha. Parar no fim da linha
      // limita o estrago de uma aspa dentro de regex literal (`/["']/`), que
      // este leitor não distingue de string.
      while (i < source.length && source[i] !== c && (c === "`" || source[i] !== "\n")) {
        if (source[i] === "\\") i++;
        i++;
      }
      out += source.slice(start, i + 1);
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** A primeira instrução do módulo é a diretiva `"use server"`. */
export function isServerModule(source: string): boolean {
  return /^\s*(["'])use server\1\s*;?/.test(stripComments(source));
}

/**
 * Funções com `"use server"` no próprio corpo — Server Action inline.
 *
 * Nenhuma existe hoje. A forma é recusada a menos que seja registrada, porque
 * ela transforma um trecho de componente num endpoint público sem que o nome
 * do arquivo diga isso.
 */
export function inlineServerDirectives(source: string): number {
  const code = stripComments(source);
  const all = [...code.matchAll(/(["'])use server\1/g)].length;
  return isServerModule(source) ? all - 1 : all;
}

export type ExportedBinding = {
  /** Nome visto de fora (`default` para export default). */
  exported: string;
  /** Nome local cujo corpo é conferido; `null` quando não há corpo legível. */
  local: string | null;
};

/**
 * Todo valor que o módulo exporta, em qualquer forma.
 *
 * `export type`/`export interface` ficam de fora: são apagados antes do
 * runtime e não viram endpoint. Re-export (`export … from`) e `export *` são
 * devolvidos com `local: null` — o corpo não está aqui, então a conferência do
 * guarda recusa, e quem quiser a forma precisa registrar exceção.
 */
export function exportedBindings(source: string): ExportedBinding[] {
  const code = stripComments(source);
  const found: ExportedBinding[] = [];

  for (const m of code.matchAll(/\bexport\s+default\s+(?:async\s+)?function\s*\*?\s*(\w+)?/g)) {
    // Função anônima não tem nome pelo qual achar o corpo: recusa-se.
    found.push({ exported: "default", local: m[1] ?? null });
  }
  for (const m of code.matchAll(/\bexport\s+default\s+(?!(?:async\s+)?function\b)(?!async\b)(\w+)?/g)) {
    // `export default async () => …` não tem nome: `local` nulo, e recusa.
    found.push({ exported: "default", local: m[1] ?? null });
  }
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*(\w+)/g)) {
    found.push({ exported: m[1]!, local: m[1]! });
  }
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+(\w+|[{[])/g)) {
    const name = m[1]!;
    // Desestruturação exportada não tem um corpo por nome; recusa-se.
    found.push(/^\w+$/.test(name) ? { exported: name, local: name } : { exported: "<destructured>", local: null });
  }
  for (const m of code.matchAll(/\bexport\s*(type\s*)?\{([^}]*)\}(\s*from\s*["'][^"']+["'])?/g)) {
    if (m[1]) continue;
    const reexport = Boolean(m[3]);
    for (const part of m[2]!.split(",")) {
      const spec = part.trim();
      if (spec === "" || /^type\s/.test(spec)) continue;
      const [local, exported] = spec.split(/\s+as\s+/).map((s) => s.trim());
      found.push({ exported: exported ?? local!, local: reexport ? null : local! });
    }
  }
  for (const m of code.matchAll(/\bexport\s*\*\s*(?:as\s+(\w+)\s*)?from/g)) {
    found.push({ exported: m[1] ?? "*", local: null });
  }
  return found;
}

/**
 * As actions que não passam por `guard`, e por quê.
 *
 * Cada entrada é um furo deliberado, amarrado ao ARQUIVO em que mora: o mesmo
 * nome exportado em outro módulo não herda a exceção. A justificativa é o
 * que substitui o guarda, e fica no registro em vez de ser uma omissão que
 * ninguém notou.
 */
export const UNGUARDED_BY_DESIGN = new Map<string, { file: string; why: string }>([
  [
    "passwordLoginAction",
    {
      file: "app/login/actions.ts",
      // Sign-in is where a session begins, so requiring one would be circular.
      why: "pré-sessão: a sessão nasce aqui; limite de tentativas e resposta idêntica substituem a permissão",
    },
  ],
  [
    // Encerrar uma sessão não pode exigir uma sessão válida. `guard` lançaria
    // para quem está com sessão emprestada expirada ou quebrada, e a pessoa
    // ficaria presa na identidade de outra — sem caminho de volta pela
    // interface.
    "stopImpersonatingAction",
    {
      file: "app/admin/actions.ts",
      why: "encerra o empréstimo; `endImpersonation` confere a sessão emprestada e só restaura o cookie do admin",
    },
  ],
  [
    // Mesma razão: sair não pode exigir sessão válida. Ficava fora do teste
    // só porque o arquivo não termina em `actions.ts`.
    "logoutAction",
    {
      file: "app/logout-action.ts",
      why: "revoga o token do próprio cookie; sem token não há o que revogar nem o que ler",
    },
  ],
  [
    // Recuperação de senha não pode exigir sessão: quem esqueceu a senha não
    // tem uma. `requestResetAction` responde igual para conta existente e
    // inexistente, e limita por endereço.
    "requestResetAction",
    {
      file: "app/login/forgot/actions.ts",
      why: "pré-sessão: resposta uniforme e limite por endereço; não revela quem está cadastrado",
    },
  ],
  [
    // `submitResetAction` trata o TOKEN como a autorização — uso único, uma
    // hora de validade, e queimado antes de a senha ser gravada.
    "submitResetAction",
    {
      file: "app/login/reset/actions.ts",
      why: "pré-sessão: o token de uso único é a autorização, queimado antes de gravar",
    },
  ],
  [
    "setLocaleAction",
    {
      file: "app/locale-action.ts",
      why: "preferência de interface em cookie próprio; não lê nem escreve dado de ninguém e precisa valer no /login",
    },
  ],
  [
    "setAppearanceAction",
    {
      file: "app/theme-action.ts",
      why: "preferência de interface em cookie próprio; não lê nem escreve dado de ninguém e precisa valer no /login",
    },
  ],
]);

const GUARD_CALL = /^await\s+(guard|guardOwnCandidate)\s*\(/;

/**
 * Efeitos síncronos que não podem acontecer antes do guarda. Uma chamada a
 * `revalidatePath` ou a `cookies()` antes do `await guard(...)` já é efeito,
 * mesmo que o guarda negue logo em seguida.
 */
const EFFECT_BEFORE_GUARD = /\b(?:revalidatePath|revalidateTag|redirect|cookies|headers|getDb|fetch|after)\s*\(/;

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/**
 * O primeiro `await` da função é o guarda, e nada com efeito vem antes dele.
 *
 * "Primeiro await" e não "primeira instrução": `const session = await
 * guard(...)` e `await guard(...)` são a mesma coisa, e o tipo de retorno —
 * que pode conter chaves — fica antes do corpo sem conter `await` nenhum.
 */
export function guardComesFirst(source: string, local: string | null): GuardVerdict {
  if (local === null) return { ok: false, reason: "sem corpo local (re-export ou desestruturação)" };
  const code = stripComments(source);
  const declaration = new RegExp(
    `(?:\\bfunction\\s*\\*?\\s*${local}\\s*\\(|\\b(?:const|let|var)\\s+${local}\\s*(?::[^=]+)?=)`,
  ).exec(code);
  if (!declaration) return { ok: false, reason: `declaração de ${local} não encontrada` };
  const rest = code.slice(declaration.index + declaration[0].length);
  const awaitAt = rest.search(/\bawait\b/);
  if (awaitAt === -1) return { ok: false, reason: "nenhum await: o guarda não é chamado" };
  // O próximo `export` delimita a função; um await depois dele é de outra.
  const nextExport = rest.search(/\n\s*export\s/);
  if (nextExport !== -1 && nextExport < awaitAt) return { ok: false, reason: "nenhum await no corpo" };
  if (!GUARD_CALL.test(rest.slice(awaitAt))) {
    return { ok: false, reason: `o primeiro await não é guard: ${rest.slice(awaitAt, awaitAt + 60).split("\n")[0]}` };
  }
  const before = rest.slice(0, awaitAt);
  const effect = EFFECT_BEFORE_GUARD.exec(before);
  if (effect) return { ok: false, reason: `efeito antes do guarda: ${effect[0]}` };
  return { ok: true };
}

const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
/** Exports de configuração de segmento que o Next lê de um Route Handler. */
const SEGMENT_CONFIG = new Set(["dynamic", "revalidate", "maxDuration", "runtime", "preferredRegion", "fetchCache", "dynamicParams"]);

export function routeMethods(source: string): { methods: string[]; unknown: string[] } {
  const methods: string[] = [];
  const unknown: string[] = [];
  for (const binding of exportedBindings(source)) {
    if (HTTP_METHODS.has(binding.exported)) methods.push(binding.exported);
    else if (!SEGMENT_CONFIG.has(binding.exported)) unknown.push(binding.exported);
  }
  return { methods, unknown };
}

export type Inventory = {
  pages: string[];
  routes: string[];
  /** Arquivos especiais de segmento que renderizam sem ser página. */
  segments: string[];
  serverModules: string[];
  inlineServer: string[];
};

const SEGMENT_FILE = /\/(?:layout|template|default|loading|error|global-error|not-found|forbidden|unauthorized)\.(?:tsx|ts|jsx|js)$/;
const METADATA_ROUTE = /\/(?:opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:tsx|ts|jsx|js)$/;

export function discoverEntries(): Inventory {
  const routing = ROUTING_ROOTS.flatMap((root) => walk(root));
  const all = SOURCE_ROOTS.flatMap((root) => walk(root));
  const read = (file: string) => readFileSync(file, "utf8");
  return {
    pages: routing.filter((f) => /\/page\.(?:tsx|ts|jsx|js|mdx)$/.test(f)).sort(),
    // Rota de metadados é Route Handler para o Next: responde HTTP sem página.
    routes: routing.filter((f) => /\/route\.(?:ts|js|tsx|jsx)$/.test(f) || METADATA_ROUTE.test(f)).sort(),
    segments: routing.filter((f) => SEGMENT_FILE.test(f)).sort(),
    serverModules: all.filter((f) => isServerModule(read(f))).sort(),
    inlineServer: all.filter((f) => inlineServerDirectives(read(f)) > 0).sort(),
  };
}
