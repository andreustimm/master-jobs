// Agentes dos três harnesses a partir de UMA fonte (G85).
//
// `.claude/agents/<nome>.md` é o agente canônico: nome, descrição, ferramentas
// e o prompt. O Codex (`.codex/agents/<nome>.toml`) e o OpenCode
// (`.opencode/agents/<nome>.md`) recebem espelhos GERADOS, porque o formato
// não é compatível — o OpenCode recusa `tools:` em lista e lê `permission:`,
// que o Claude Code ignora; um symlink entregaria a um dos dois um agente com
// política diferente da escrita. O espelho é conferido byte a byte.
//
// Funções puras: recebem texto, devolvem texto.
import YAML from "yaml";
import { ROLES, type Role } from "../routing/model-routing.ts";

/** Ferramentas do Claude Code aceitas no `tools:` de um agente do projeto. */
export const CLAUDE_AGENT_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "Edit",
  "Write",
  "WebFetch",
  "WebSearch",
]);

const WRITE_TOOLS = new Set(["Edit", "Write"]);

/** Campos do frontmatter canônico. Campo de outro harness aqui é política que um lado lê e o outro não. */
export const AGENT_FIELDS: ReadonlySet<string> = new Set(["name", "description", "role", "tools", "model", "effort"]);

export type Access = "read-only" | "workspace-write";

export type Agent = {
  name: string;
  description: string;
  /** Papel de G86; decide o modelo e o effort de cada harness pela política. */
  role: Role;
  tools: string[];
  access: Access;
  /** Modelo e effort do Claude Code, escritos no canônico e conferidos contra a política. */
  model: string;
  effort: string;
  body: string;
};

/** Modelo e effort que a política dá ao papel no harness do espelho. */
export type ModelDefault = { model: string; effort: string | null };

export const GENERATED_NOTICE = "Gerado por `pnpm harness:sync` a partir de .claude/agents/";

export function splitFrontmatter(source: string): { data: unknown; body: string } {
  const match = /^---\n(?:([\s\S]*?)\n)?---\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("sem frontmatter delimitado por ---");
  return { data: YAML.parse(match[1] ?? ""), body: match[2]! };
}

export function parseAgent(fileName: string, source: string): Agent {
  const where = `.claude/agents/${fileName}`;
  const { data, body } = splitFrontmatter(source);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${where}: frontmatter precisa ser um mapa`);
  }
  const fields = data as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!AGENT_FIELDS.has(key)) {
      throw new Error(`${where}: campo "${key}" fora do contrato (${[...AGENT_FIELDS].join(", ")})`);
    }
  }
  const expectedName = fileName.replace(/\.md$/, "");
  if (fields.name !== expectedName) throw new Error(`${where}: name precisa ser "${expectedName}"`);
  if (typeof fields.description !== "string" || fields.description.trim() === "") {
    throw new Error(`${where}: description obrigatória`);
  }
  if (typeof fields.tools !== "string" || fields.tools.trim() === "") {
    // Sem `tools`, o Claude Code dá TODAS as ferramentas ao agente; a política
    // precisa estar escrita para ser traduzida.
    throw new Error(`${where}: tools obrigatório (lista separada por vírgula)`);
  }
  const tools = fields.tools.split(",").map((tool) => tool.trim());
  for (const tool of tools) {
    if (!CLAUDE_AGENT_TOOLS.has(tool)) throw new Error(`${where}: ferramenta "${tool}" desconhecida`);
  }
  if (!(ROLES as readonly unknown[]).includes(fields.role)) {
    throw new Error(`${where}: role precisa ser um de ${ROLES.join(", ")}`);
  }
  for (const key of ["model", "effort"] as const) {
    // Sem modelo escrito, o subagente herda o do turno principal — que é
    // justamente a escolha que o roteador existe para tornar explícita.
    if (typeof fields[key] !== "string" || (fields[key] as string).trim() === "") throw new Error(`${where}: ${key} obrigatório`);
  }
  const trimmed = body.replace(/^\n+/, "").replace(/\s*$/, "\n");
  if (trimmed.trim() === "") throw new Error(`${where}: prompt vazio`);
  return {
    name: expectedName,
    description: fields.description.trim(),
    role: fields.role as Role,
    model: (fields.model as string).trim(),
    effort: (fields.effort as string).trim(),
    tools,
    access: tools.some((tool) => WRITE_TOOLS.has(tool)) ? "workspace-write" : "read-only",
    body: trimmed,
  };
}

/** String básica de TOML: o escape do JSON é um subconjunto válido dela. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function renderCodexAgent(agent: Agent, defaults: ModelDefault): string {
  if (agent.body.includes("'''")) {
    throw new Error(`.claude/agents/${agent.name}.md: o prompt não pode conter ''' (delimitador do TOML)`);
  }
  const lines = [
    `# ${GENERATED_NOTICE}${agent.name}.md — não edite aqui.`,
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `model = ${tomlString(defaults.model)}`,
  ];
  if (defaults.effort !== null) lines.push(`model_reasoning_effort = ${tomlString(defaults.effort)}`);
  // Agente de escrita herda o sandbox da sessão; o de leitura é travado aqui.
  if (agent.access === "read-only") lines.push(`sandbox_mode = "read-only"`);
  // String literal multilinha: nada é escapado, e a quebra logo após ''' some.
  lines.push(`developer_instructions = '''\n${agent.body}'''`);
  return `${lines.join("\n")}\n`;
}

export function renderOpenCodeAgent(agent: Agent, defaults: ModelDefault): string {
  const frontmatter: Record<string, unknown> = {
    description: agent.description,
    mode: "subagent",
    model: defaults.model,
  };
  // O OpenCode repassa `reasoningEffort` ao provedor; sem effort na política,
  // o parâmetro não vai — mandá-lo seria inventar capacidade do modelo.
  if (defaults.effort !== null) frontmatter.reasoningEffort = defaults.effort;
  // Só restrição: um `allow` aqui venceria o deny global do opencode.json,
  // porque no OpenCode a regra do agente é avaliada depois da global.
  if (agent.access === "read-only") frontmatter.permission = { edit: "deny" };
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 });
  return `---\n# ${GENERATED_NOTICE}${agent.name}.md — não edite aqui.\n${yaml}---\n\n${agent.body}`;
}
