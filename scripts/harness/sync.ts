// Gate e gerador da paridade dos harnesses (G85, #317).
//
//   pnpm check:harness   confere; reprova espelho ausente, divergente ou órfão
//   pnpm harness:sync    regenera os espelhos a partir das fontes canônicas
//
// Fontes canônicas: `.claude/settings.json` (permissões), `.claude/agents/`
// (agentes) e `.claude/commands/` (comandos); instruções são o `AGENTS.md`
// (regras por domínio sob demanda). Espelhos gerados: `opencode.json`, `.codex/hooks.json`,
// `.codex/agents/*.toml` e `.opencode/agents/*.md`. O que é idêntico entre os
// harnesses continua por symlink — ver `scripts/rules/check-instructions.ts`.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAgent, renderCodexAgent, renderOpenCodeAgent, splitFrontmatter, type Agent } from "./agents.ts";
import { toOpenCodePermission, type ClaudePermissions } from "./permissions.ts";

export const CLAUDE_SETTINGS = ".claude/settings.json";
export const CLAUDE_AGENTS = ".claude/agents";
export const CLAUDE_COMMANDS = ".claude/commands";
export const CODEX_AGENTS = ".codex/agents";
export const OPENCODE_AGENTS = ".opencode/agents";
export const CODEX_HOOKS = ".codex/hooks.json";
export const OPENCODE_CONFIG = "opencode.json";

/** Guarda do Codex: aplica a lista do Claude a cada comando e patch. */
export const CODEX_GUARD = "scripts/harness/codex-guard.ts";

/** Campos de frontmatter que um comando pode ter e os dois harnesses leem igual. */
const COMMAND_FIELDS = new Set(["description"]);

function listMarkdown(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

export function loadAgents(root: string): Agent[] {
  return listMarkdown(root, CLAUDE_AGENTS).map((file) =>
    parseAgent(file, readFileSync(join(root, CLAUDE_AGENTS, file), "utf8")),
  );
}

/**
 * Instruções do OpenCode: só a entrada comum, como no Claude Code e no Codex.
 * As regras por domínio são lidas sob demanda pelo roteador do `AGENTS.md`;
 * carregá-las sempre custaria ~26 mil tokens fixos por sessão e daria ao
 * OpenCode um contexto que os outros dois não têm (G85; alternativa em aberto
 * na D6 da #321).
 */
export function openCodeInstructions(): string[] {
  return ["AGENTS.md"];
}

export function renderOpenCodeConfig(root: string): string {
  const settings = JSON.parse(readFileSync(join(root, CLAUDE_SETTINGS), "utf8")) as {
    permissions?: ClaudePermissions;
  };
  if (!settings.permissions) throw new Error(`${CLAUDE_SETTINGS}: sem "permissions"`);
  const config = {
    $schema: "https://opencode.ai/config.json",
    instructions: openCodeInstructions(),
    permission: toOpenCodePermission(settings.permissions),
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function renderCodexHooks(): string {
  const hooks = {
    hooks: {
      PreToolUse: [
        {
          matcher: "^(Bash|apply_patch)$",
          hooks: [
            {
              type: "command",
              // Saída diferente de 0 e 2 faz o Codex seguir sem a guarda; o
              // `exit 2` transforma node ausente, módulo quebrado ou exceção
              // em bloqueio.
              command: `node --experimental-strip-types --no-warnings "$(git rev-parse --show-toplevel)/${CODEX_GUARD}" || { echo "guarda de permissões do projeto falhou; comando bloqueado" >&2; exit 2; }`,
              timeout: 10,
              statusMessage: "Conferindo a política de permissões do projeto",
            },
          ],
        },
      ],
    },
  };
  return `${JSON.stringify(hooks, null, 2)}\n`;
}

/** Caminho relativo → conteúdo esperado de cada espelho gerado. */
export function expectedMirrors(root: string): Map<string, string> {
  const files = new Map<string, string>();
  files.set(OPENCODE_CONFIG, renderOpenCodeConfig(root));
  files.set(CODEX_HOOKS, renderCodexHooks());
  for (const agent of loadAgents(root)) {
    files.set(`${CODEX_AGENTS}/${agent.name}.toml`, renderCodexAgent(agent));
    files.set(`${OPENCODE_AGENTS}/${agent.name}.md`, renderOpenCodeAgent(agent));
  }
  return files;
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Arquivos nos diretórios de espelho que nenhum agente canônico gera. */
function orphans(root: string, expected: Map<string, string>): string[] {
  const found: string[] = [];
  for (const directory of [CODEX_AGENTS, OPENCODE_AGENTS]) {
    const absolute = join(root, directory);
    if (!existsSync(absolute) || isSymlink(absolute)) continue;
    for (const name of readdirSync(absolute).sort()) {
      const path = `${directory}/${name}`;
      if (!expected.has(path)) found.push(path);
    }
  }
  return found;
}

export function checkCommands(root: string): string[] {
  const errors: string[] = [];
  for (const file of listMarkdown(root, CLAUDE_COMMANDS)) {
    const where = `${CLAUDE_COMMANDS}/${file}`;
    let data: unknown;
    try {
      data = splitFrontmatter(readFileSync(join(root, CLAUDE_COMMANDS, file), "utf8")).data;
    } catch (error) {
      errors.push(`${where}: ${(error as Error).message}`);
      continue;
    }
    const fields = (data ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      // `allowed-tools` restringe no Claude e é ignorado pelo OpenCode, que lê
      // o mesmo arquivo pelo symlink: o comando ficaria mais largo lá.
      if (!COMMAND_FIELDS.has(key)) errors.push(`${where}: campo "${key}" não é lido igual pelos dois harnesses`);
    }
    if (typeof fields.description !== "string" || fields.description.trim() === "") {
      errors.push(`${where}: description obrigatória`);
    }
  }
  return errors;
}

export function checkHarness(root: string): string[] {
  const errors: string[] = [];
  if (isSymlink(join(root, OPENCODE_AGENTS))) {
    errors.push(`${OPENCODE_AGENTS}: é symlink; os agentes do OpenCode são espelhos gerados (rode pnpm harness:sync)`);
  }
  let expected: Map<string, string>;
  try {
    expected = expectedMirrors(root);
  } catch (error) {
    return [...errors, (error as Error).message];
  }
  for (const [path, contents] of expected) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) errors.push(`${path}: ausente — rode pnpm harness:sync`);
    else if (readFileSync(absolute, "utf8") !== contents) {
      errors.push(`${path}: diverge da fonte canônica — edite a fonte e rode pnpm harness:sync`);
    }
  }
  for (const path of orphans(root, expected)) {
    errors.push(`${path}: órfão — o agente não existe em ${CLAUDE_AGENTS}/`);
  }
  return [...errors, ...checkCommands(root)];
}

export function syncHarness(root: string): string[] {
  const expected = expectedMirrors(root);
  const opencodeAgents = join(root, OPENCODE_AGENTS);
  if (isSymlink(opencodeAgents)) unlinkSync(opencodeAgents);
  const removed = orphans(root, expected);
  for (const path of removed) unlinkSync(join(root, path));
  const written: string[] = [];
  for (const [path, contents] of expected) {
    const absolute = join(root, path);
    if (existsSync(absolute) && readFileSync(absolute, "utf8") === contents) continue;
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
    written.push(path);
  }
  return [...written.map((path) => `escrito: ${path}`), ...removed.map((path) => `removido: ${path}`)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  if (process.argv.includes("--write")) {
    const changes = syncHarness(root);
    console.log(changes.length > 0 ? changes.join("\n") : "Espelhos dos harnesses já estavam em dia.");
  }
  const errors = checkHarness(root);
  if (errors.length > 0) {
    console.error(`Paridade dos harnesses com ${errors.length} problema(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Harnesses: permissões, agentes, hooks e comandos conferem com as fontes canônicas.");
  }
}
