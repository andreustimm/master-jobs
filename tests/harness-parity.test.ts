// Suite: paridade dos harnesses — Claude Code, Codex e OpenCode (#317, G85)
// Invariant: uma fonte canônica por assunto (`.claude/settings.json`,
//   `.claude/agents/`, `.claude/commands/`) e espelhos gerados que nunca são
//   mais permissivos que ela; espelho ausente, divergente ou órfão reprova
// Boundary IN: scripts/harness/{permissions,agents,sync,codex-guard}.ts sobre
//   árvores temporárias com regressões induzidas, a árvore real e a ligação ao
//   `pnpm check` e ao CI
// Boundary OUT: o comportamento dos binários do Codex e do OpenCode — o teste
//   prova o arquivo que eles leem, com a semântica documentada de cada um
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_AGENT_TOOLS,
  openCodeToolsDenied,
  parseAgent,
  renderCodexAgent,
  renderOpenCodeAgent,
  splitFrontmatter,
} from "../scripts/harness/agents.ts";
import { judge, patchPaths, run } from "../scripts/harness/codex-guard.ts";
import {
  bashSpecifierMatches,
  commandSegments,
  decideCommand,
  decidePath,
  openCodePathPatterns,
  parseRules,
  pathSpecifierMatches,
  toOpenCodePermission,
  type ClaudePermissions,
  type Decision,
  type OpenCodePermission,
} from "../scripts/harness/permissions.ts";
import { checkHarness, syncHarness } from "../scripts/harness/sync.ts";
import { ciWorkflow, gatedJobWithStep } from "./support/ci-workflow.ts";

const REAL_SETTINGS = JSON.parse(readFileSync(".claude/settings.json", "utf8")) as { permissions: ClaudePermissions };
const context = { root: "/repo", home: "/home/eu" };

describe("regras do Claude Code lidas como o Claude Code lê", () => {
  it("prefixo `:*` casa o comando e seus argumentos, não outro comando com o mesmo início", () => {
    expect(bashSpecifierMatches("git:*", "git status")).toBe(true);
    expect(bashSpecifierMatches("git:*", "git")).toBe(true);
    expect(bashSpecifierMatches("git:*", "gitk --all")).toBe(false);
    expect(bashSpecifierMatches("pwd", "pwd")).toBe(true);
    expect(bashSpecifierMatches("pwd", "pwd -P")).toBe(false);
  });

  it("curinga casa em qualquer posição, inclusive com o prefixo `rtk`", () => {
    expect(bashSpecifierMatches("*git*push* main", "rtk git push origin main")).toBe(true);
    expect(bashSpecifierMatches("*git*push* main", "git push origin main-fix")).toBe(false);
    expect(bashSpecifierMatches("* .env", "cat .env")).toBe(true);
  });

  it("comando composto é julgado inteiro e por trecho; deny vence ask, que vence allow", () => {
    const rules = parseRules({ allow: ["Bash(git:*)"], ask: ["Bash(rm:*)"], deny: ["Bash(*git*push* main)"] });
    expect(commandSegments("cd x && git push origin main | tee log")).toContain("git push origin main");
    expect(decideCommand(rules, "cd x && git push origin main")).toBe("deny");
    expect(decideCommand(rules, "git status; rm -rf build")).toBe("ask");
    expect(decideCommand(rules, "git status")).toBe("allow");
    expect(decideCommand(rules, "ls")).toBeNull();
    expect(decideCommand(parseRules({ deny: ["Bash"] }), "ls")).toBe("deny");
  });

  it("o prefixo `rtk` do Codex e do OpenCode não tira o comando da regra ancorada", () => {
    const rules = parseRules({ allow: ["Bash(git:*)", "Bash(rtk proxy:*)"], ask: ["Bash(rm:*)"], deny: ["Bash(sudo *)"] });
    expect(decideCommand(rules, "rtk sudo ls")).toBe("deny");
    expect(decideCommand(rules, "rtk proxy sudo ls")).toBe("deny");
    expect(decideCommand(rules, "rtk rm -rf build")).toBe("ask");
    expect(decideCommand(rules, "rtk git status")).toBe("allow");
  });

  it.each([
    "env rm -rf src",
    "command rm -rf src",
    "timeout 5 rm -rf src",
    "/bin/rm -rf src",
    "sh -c 'rm -rf src'",
    "bash -c \"cd x && rm -rf src\"",
    "rtk env FOO=1 rm -rf src",
  ])("invólucro não esconde o comando da regra: %s", (command) => {
    const rules = parseRules({ allow: ["Bash(git:*)"], ask: ["Bash(rm:*)"] });
    expect(decideCommand(rules, command)).toBe("ask");
  });

  it("texto entre aspas simples não vira comando", () => {
    const rules = parseRules({ allow: ["Bash(git:*)"], deny: ["Bash(sudo *)"] });
    expect(decideCommand(rules, "git commit -m 'fix(harness): julga (sudo ls) no texto'")).toBe("allow");
    expect(decideCommand(rules, "git commit -m 'docs: explica `rtk sudo ls`'")).toBe("allow");
    expect(decideCommand(rules, 'git commit -m "$(sudo ls)"')).toBe("deny");
  });

  it.each(["git status & sudo ls", "echo $(sudo ls)", "ls `sudo ls`", "git status; (sudo ls)", "cat <(sudo ls)", "{ sudo ls; }"])(
    "comando escondido em sintaxe do shell ainda é julgado: %s",
    (command) => {
      const rules = parseRules({ allow: ["Bash(git:*)", "Bash(echo:*)", "Bash(ls:*)", "Bash(cat:*)"], deny: ["Bash(sudo *)"] });
      expect(decideCommand(rules, command)).toBe("deny");
    },
  );

  it("padrão de arquivo segue o gitignore: `./` na raiz, `~/` no pessoal, sem âncora em qualquer nível", () => {
    expect(pathSpecifierMatches("./.env", "/repo/.env", context)).toBe(true);
    expect(pathSpecifierMatches("./.env", "/repo/app/.env", context)).toBe(false);
    expect(pathSpecifierMatches("./.env.*", "/repo/.env.production", context)).toBe(true);
    expect(pathSpecifierMatches("./**/*.pem", "/repo/a/b/c.pem", context)).toBe(true);
    expect(pathSpecifierMatches("./**/*.pem", "/repo/c.pem", context)).toBe(true);
    expect(pathSpecifierMatches("./.env", "/outro/.env", context)).toBe(false);
    expect(pathSpecifierMatches("~/.ssh/**", "/home/eu/.ssh/id_ed25519", context)).toBe(true);
    expect(pathSpecifierMatches("*.key", "/qualquer/lugar/x.key", context)).toBe(true);
    expect(pathSpecifierMatches("//etc/*", "/etc/hosts", context)).toBe(true);
    expect(pathSpecifierMatches("./a?.txt", "/repo/ab.txt", context)).toBe(true);
    expect(pathSpecifierMatches("./.env", "/repo/./x/../.env", context)).toBe(true);
    const rules = parseRules({ deny: ["Edit(./.env)"], ask: ["Edit"] });
    expect(decidePath(rules, "Edit", "/repo/.env", context)).toBe("deny");
    expect(decidePath(rules, "Edit", "/repo/x.ts", context)).toBe("ask");
    expect(decidePath(rules, "Read", "/repo/.env", context)).toBeNull();
  });

  it("regra ilegível reprova em vez de ser ignorada", () => {
    expect(() => parseRules({ deny: ["Bash(sem fechar"] })).toThrow("regra de permissão ilegível");
  });
});

/** O OpenCode: `*` casa qualquer caractere e a ÚLTIMA regra que casa vence. */
function openCodeDecide(permission: OpenCodePermission, tool: string, input: string): Decision {
  const rules = permission[tool];
  if (rules === undefined) return "allow";
  if (typeof rules === "string") return rules;
  let found: Decision = "allow";
  for (const [pattern, decision] of Object.entries(rules)) {
    const source = pattern
      .split("*")
      .map((part) => part.split("?").map((piece) => piece.replace(/[.+^${}()|[\]\\/-]/g, "\\$&")).join("."))
      .join(".*");
    if (new RegExp(`^${source}$`, "s").test(input)) found = decision;
  }
  return found;
}

const STRENGTH: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

describe("OpenCode: tradução gerada de `.claude/settings.json`", () => {
  const permission = toOpenCodePermission(REAL_SETTINGS.permissions);
  const rules = parseRules(REAL_SETTINGS.permissions);

  // Corpus com os casos que a lista existe para pegar e os que ela libera.
  const commands = [
    "git status",
    "rtk git status",
    "git push origin main",
    "rtk git push -u origin feat/x",
    "rtk git push origin staging",
    "git push --force origin feat/x",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "gh api -X DELETE repos/x",
    "gh pr create --base dev",
    "pnpm check",
    "rtk pnpm jho jobs sync",
    "cat .env",
    "cat app/.env.production",
    "cat .linkedin.token.json",
    "rm -rf build",
    "rm -rf /",
    "sudo ls",
    "curl -s https://example.com",
    "curl https://example.com",
    "docker ps",
    "pwd",
    "rtk sudo ls",
    "rtk rm -rf /",
    "rtk rm -rf build",
    "rtk proxy rm -rf build",
    "rtk chmod 777 x",
    "rtk find . -delete",
  ];

  it.each(commands)("nunca é mais permissivo que o Claude Code: %s", (command) => {
    // Nada casando, o Claude Code pergunta; o OpenCode recebeu "*": "ask".
    const claude = decideCommand(rules, command) ?? "ask";
    // O OpenCode julga cada comando do composto; aqui os casos são simples.
    expect(STRENGTH[openCodeDecide(permission, "bash", command)]).toBeGreaterThanOrEqual(STRENGTH[claude]);
  });

  it("reproduz a decisão do Claude Code nos casos que decidem", () => {
    expect(openCodeDecide(permission, "bash", "rtk git push origin main")).toBe("deny");
    expect(openCodeDecide(permission, "bash", "git push --force origin feat/x")).toBe("ask");
    expect(openCodeDecide(permission, "bash", "git status")).toBe("allow");
    expect(openCodeDecide(permission, "bash", "docker ps")).toBe("ask");
    expect(openCodeDecide(permission, "bash", "rtk sudo ls")).toBe("deny");
    expect(openCodeDecide(permission, "bash", "rtk rm -rf /")).toBe("deny");
    expect(openCodeDecide(permission, "bash", "rtk proxy rm -rf build")).toBe("ask");
  });

  it.each([".env", "/repo/.env", "/repo/app/.env.local", "/repo/certs/x.pem", ".linkedin.token.json"])(
    "arquivo secreto negado para leitura e escrita: %s",
    (path) => {
      expect(openCodeDecide(permission, "read", path)).toBe("deny");
      expect(openCodeDecide(permission, "edit", path)).toBe("deny");
    },
  );

  it("leitura comum liberada; escrita pergunta, como no Claude Code sem Edit liberado", () => {
    expect(openCodeDecide(permission, "read", "/repo/src/cli.ts")).toBe("allow");
    expect(openCodeDecide(permission, "edit", "/repo/src/cli.ts")).toBe("ask");
    expect(permission.external_directory).toBe("ask");
  });

  it("padrão de arquivo traduzido nunca fica mais estreito", () => {
    expect(openCodePathPatterns("./.env")).toEqual([".env", "*/.env"]);
    expect(openCodePathPatterns("./**/*.pem")).toEqual(["*.pem"]);
    expect(openCodePathPatterns("~/.ssh/**")).toEqual(["~/.ssh/*"]);
    expect(openCodePathPatterns("/abs/x")).toEqual(["abs/x", "*/abs/x"]);
  });

  it("regra repetida em duas listas vai para a posição da mais forte", () => {
    const generated = toOpenCodePermission({ allow: ["Bash(git:*)"], deny: ["Bash(git:*)"], ask: ["Bash(*x*)"] });
    expect(openCodeDecide(generated, "bash", "git x")).toBe("deny");
  });

  it("ferramenta sem regra específica vira decisão simples; ferramenta sem tradução reprova", () => {
    expect(toOpenCodePermission({ deny: ["WebFetch"] }).webfetch).toBe("deny");
    expect(() => toOpenCodePermission({ allow: ["NotebookEdit"] })).toThrow("sem tradução para o OpenCode");
    expect(() => toOpenCodePermission({ deny: ["WebFetch(domain:evil.com)"] })).toThrow("WebFetch(domain:evil.com) sem tradução");
  });
});

const AGENT = [
  "---",
  "name: revisor",
  "description: Revisa o delta.",
  "role: reviewer",
  "tools: Read, Grep, Glob, Bash",
  "model: claude-opus-5-5",
  "effort: high",
  "---",
  "",
  "Você revisa. Aspas \"duplas\" e barra \\ ficam literais.",
  "",
].join("\n");

const CODEX_DEFAULT = { model: "gpt-5.6-terra", effort: "medium" };
const OPENCODE_DEFAULT = { model: "opencode-go/qwen3.7-plus", effort: null };

describe("agentes: canônico no Claude Code, espelhos gerados", () => {
  it("agente de leitura vira sandbox read-only no Codex e edit deny no OpenCode, com o modelo da política", () => {
    const agent = parseAgent("revisor.md", AGENT);
    expect(agent).toMatchObject({ access: "read-only", role: "reviewer", model: "claude-opus-5-5", effort: "high" });
    const codex = renderCodexAgent(agent, CODEX_DEFAULT);
    expect(codex).toContain('name = "revisor"');
    expect(codex).toContain('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"');
    expect(codex).toContain('sandbox_mode = "read-only"');
    expect(codex).toContain("developer_instructions = '''\nVocê revisa.");
    const openCode = renderOpenCodeAgent(agent, OPENCODE_DEFAULT);
    expect(openCode).toMatch(/^---\n# Gerado/);
    expect(openCode).toContain("mode: subagent");
    expect(openCode).toContain("model: opencode-go/qwen3.7-plus");
    expect(openCode).not.toContain("reasoningEffort");
    expect(openCode).toContain("edit: deny");
    expect(renderOpenCodeAgent(agent, { model: "openai/gpt-x", effort: "high" })).toContain("reasoningEffort: high");
    expect(renderCodexAgent(agent, { model: "m", effort: null })).not.toContain("model_reasoning_effort");
  });

  it("agente de escrita herda o sandbox e nunca recebe `allow` no OpenCode", () => {
    const agent = parseAgent("executor.md", AGENT.replace("revisor", "executor").replace("Bash", "Bash, Edit, Write"));
    expect(agent.access).toBe("workspace-write");
    expect(renderCodexAgent(agent, CODEX_DEFAULT)).not.toContain("sandbox_mode");
    expect(renderOpenCodeAgent(agent, OPENCODE_DEFAULT)).not.toContain("edit: deny");
    expect(renderOpenCodeAgent(agent, OPENCODE_DEFAULT)).not.toContain("allow");
  });

  it("no OpenCode, ferramenta fora do `tools:` canônico é negada no agente", () => {
    expect(openCodeToolsDenied(["Read", "Grep", "Glob", "Bash"]).sort()).toEqual(["edit", "webfetch", "websearch"]);
    expect(openCodeToolsDenied(["Read", "Grep"]).sort()).toEqual(["bash", "edit", "glob", "list", "webfetch", "websearch"]);
    expect(openCodeToolsDenied([...CLAUDE_AGENT_TOOLS])).toEqual([]);
    for (const file of readdirSync(".claude/agents")) {
      const canonical = parseAgent(file, readFileSync(`.claude/agents/${file}`, "utf8"));
      const frontmatter = splitFrontmatter(readFileSync(`.opencode/agents/${file}`, "utf8")).data as {
        permission?: Record<string, string>;
      };
      for (const tool of openCodeToolsDenied(canonical.tools)) expect(frontmatter.permission?.[tool], `${file}: ${tool}`).toBe("deny");
      expect(Object.values(frontmatter.permission ?? {}).every((decision) => decision === "deny")).toBe(true);
    }
  });

  it.each([
    [AGENT.replace("name: revisor", "name: outro"), 'name precisa ser "revisor"'],
    [AGENT.replace("tools: Read, Grep, Glob, Bash\n", ""), "tools obrigatório"],
    [AGENT.replace("Bash", "Task"), 'ferramenta "Task" desconhecida'],
    [AGENT.replace("tools:", "mode: subagent\ntools:"), 'campo "mode" fora do contrato'],
    [AGENT.replace("description: Revisa o delta.", "description: ''"), "description obrigatória"],
    ["sem frontmatter", "sem frontmatter"],
    ["---\n- lista\n---\ncorpo\n", "frontmatter precisa ser um mapa"],
    [AGENT.replace(/Você revisa[^\n]*/, ""), "prompt vazio"],
    [AGENT.replace("role: reviewer", "role: orquestrador"), "role precisa ser um de"],
    [AGENT.replace("role: reviewer\n", ""), "role precisa ser um de"],
    [AGENT.replace("model: claude-opus-5-5\n", ""), "model obrigatório"],
    [AGENT.replace("effort: high", "effort: ''"), "effort obrigatório"],
  ])("recusa agente fora do contrato (%#)", (source, message) => {
    expect(() => parseAgent("revisor.md", source)).toThrow(message);
  });

  it("recusa prompt com o delimitador do TOML", () => {
    const agent = parseAgent("revisor.md", `${AGENT}'''\n`);
    expect(() => renderCodexAgent(agent, CODEX_DEFAULT)).toThrow("'''");
  });

  it("o .toml real é TOML válido e carrega o prompt inteiro", () => {
    const script = [
      "import glob, json, tomllib",
      "out = {}",
      "for p in sorted(glob.glob('.codex/agents/*.toml')):",
      "    out[p] = tomllib.load(open(p, 'rb'))",
      "print(json.dumps(out))",
    ].join("\n");
    const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Record<string, { name: string; developer_instructions: string }>;
    const names = readdirSync(".claude/agents").map((file) => file.replace(/\.md$/, "")).sort();
    expect(Object.values(parsed).map((agent) => agent.name).sort()).toEqual(names);
    for (const name of names) {
      const canonical = parseAgent(`${name}.md`, readFileSync(`.claude/agents/${name}.md`, "utf8"));
      expect(parsed[`.codex/agents/${name}.toml`]!.developer_instructions).toBe(canonical.body);
    }
  });
});

describe("guarda do Codex", () => {
  const rules = parseRules(REAL_SETTINGS.permissions);

  it("nega o que o Claude Code nega e o que ele perguntaria", () => {
    const bash = (command: string) => judge({ tool_name: "Bash", tool_input: { command } }, rules, context).decision;
    expect(bash("rtk git push origin main")).toBe("deny");
    expect(bash("git push --force origin feat/x")).toBe("ask");
    expect(bash("pnpm check")).toBe("allow");
    expect(bash("docker ps")).toBeNull();
  });

  it("patch que toca arquivo secreto é negado, com o caminho no motivo", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: .env.local\n+X=1\n*** End Patch";
    expect(patchPaths(patch)).toEqual(["src/a.ts", ".env.local"]);
    const verdict = judge({ tool_name: "apply_patch", tool_input: { command: patch }, cwd: "/repo" }, rules, context);
    expect(verdict).toEqual({ decision: "deny", target: ".env.local" });
    const clean = judge({ tool_name: "apply_patch", tool_input: { command: "*** Update File: src/a.ts" } }, rules, context);
    expect(clean.decision).toBeNull();
    const asked = parseRules({ ask: ["Edit(./docs/**)"], deny: ["Edit(./.env)"] });
    const both = "*** Update File: docs/a.md\n*** Delete File: .env\n*** Update File: docs/b.md";
    expect(judge({ tool_name: "apply_patch", tool_input: { command: both } }, asked, context).decision).toBe("deny");
    const onlyAsk = "*** Update File: /repo/docs/a.md";
    expect(judge({ tool_name: "apply_patch", tool_input: { command: onlyAsk } }, asked, context).decision).toBe("ask");
  });

  it("responde no formato do Codex e falha fechado com entrada ou política ilegível", () => {
    const root = mkdtempSync(join(tmpdir(), "guarda-"));
    try {
      mkdirSync(join(root, ".claude"));
      writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(REAL_SETTINGS));
      const denied = JSON.parse(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo ls" } }), root, "/h")!);
      expect(denied.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
      expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("deny");
      const asked = JSON.parse(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm x" } }), root, "/h")!);
      expect(asked.hookSpecificOutput.permissionDecisionReason).toContain("peça à pessoa para rodar");
      expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }), root, "/h")).toBeNull();
      expect(run("não é json", root, "/h")).toContain("guarda sem política legível");
      expect(run("null", root, "/h")).toContain("entrada não é objeto");
      expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rtk sudo ls" } }), root, "/h")).toContain("deny");
      expect(run(JSON.stringify({ tool_name: "Bash", tool_input: {} }), root, "/h")).toContain("sem tool_input.command");
      writeFileSync(join(root, ".claude/settings.json"), "{}");
      expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }), root, "/h")).toContain("sem permissions");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("gate de paridade numa árvore temporária", () => {
  let root: string;
  const write = (path: string, contents: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  const errors = () => checkHarness(root).join("\n");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "paridade-"));
    write(".claude/settings.json", JSON.stringify({ permissions: { deny: ["Bash(sudo *)"] } }));
    write(".claude/agents/revisor.md", AGENT);
    write(".claude/commands/vagas.md", "---\ndescription: Varredura\n---\n\nFaça.\n");
    write("docs/engineering/rules/README.md", "# inventário\n");
    write("docs/engineering/rules/delivery.md", "# entrega\n");
    write("config/model-routing.json", readFileSync("config/model-routing.json", "utf8"));
    syncHarness(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("a árvore sincronizada passa e carrega entrada e regras no OpenCode", () => {
    expect(checkHarness(root)).toEqual([]);
    const config = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")) as { instructions: string[] };
    expect(config.instructions).toEqual(["AGENTS.md", "docs/engineering/rules/delivery.md"]);
  });

  it("reprova espelho editado à mão, ausente ou órfão", () => {
    write(".codex/agents/revisor.toml", "name = \"revisor\"\n");
    rmSync(join(root, ".opencode/agents/revisor.md"));
    write(".opencode/agents/fantasma.md", "---\n---\n");
    const found = errors();
    expect(found).toContain(".codex/agents/revisor.toml: diverge da fonte canônica");
    expect(found).toContain(".opencode/agents/revisor.md: ausente");
    expect(found).toContain(".opencode/agents/fantasma.md: órfão");
  });

  it("reprova permissão nova no Claude Code que não chegou ao OpenCode", () => {
    write(".claude/settings.json", JSON.stringify({ permissions: { deny: ["Bash(sudo *)", "Bash(dd *)"] } }));
    expect(errors()).toContain("opencode.json: diverge da fonte canônica");
  });

  it("reprova agente novo no Claude Code sem os espelhos, e o sync os cria", () => {
    write(".claude/agents/juiz.md", AGENT.replace("revisor", "juiz"));
    expect(errors()).toContain(".codex/agents/juiz.toml: ausente");
    expect(syncHarness(root)).toContain("escrito: .codex/agents/juiz.toml");
    expect(checkHarness(root)).toEqual([]);
  });

  it("reprova agente canônico fora do contrato", () => {
    write(".claude/agents/revisor.md", AGENT.replace("tools:", "mode: subagent\ntools:"));
    expect(errors()).toContain('campo "mode" fora do contrato');
  });

  it("reprova agente cujo modelo diverge da política e política inválida", () => {
    write(".claude/agents/revisor.md", AGENT.replace("model: claude-opus-5-5", "model: claude-haiku-4-5-20251001"));
    expect(errors()).toContain("model/effort claude-haiku-4-5-20251001/high diverge de config/model-routing.json");
    write(".claude/agents/revisor.md", AGENT);
    write("config/model-routing.json", JSON.stringify({ schemaVersion: 1, subscriptionMode: "tudo" }));
    expect(errors()).toContain("subscriptionMode");
  });

  it("muda o modelo na política e o espelho acusa até o sync", () => {
    const routing = JSON.parse(readFileSync(join(root, "config/model-routing.json"), "utf8"));
    routing.providers.openai.roles.reviewer.medium[0].effort = "high";
    write("config/model-routing.json", JSON.stringify(routing));
    expect(errors()).toContain(".codex/agents/revisor.toml: diverge da fonte canônica");
    syncHarness(root);
    expect(readFileSync(join(root, ".codex/agents/revisor.toml"), "utf8")).toContain('model_reasoning_effort = "high"');
  });

  it("reprova `.opencode/agents` como symlink e o sync o troca por diretório", () => {
    rmSync(join(root, ".opencode/agents"), { recursive: true });
    symlinkSync("../.claude/agents", join(root, ".opencode/agents"));
    expect(errors()).toContain(".opencode/agents: é symlink");
    syncHarness(root);
    expect(checkHarness(root)).toEqual([]);
  });

  it("reprova comando com campo que só um harness lê ou sem descrição", () => {
    write(".claude/commands/vagas.md", "---\ndescription: Varredura\nallowed-tools: Bash\n---\n");
    write(".claude/commands/funil.md", "---\n---\n");
    write(".claude/commands/solto.md", "sem frontmatter\n");
    const found = errors();
    expect(found).toContain('vagas.md: campo "allowed-tools"');
    expect(found).toContain("funil.md: description obrigatória");
    expect(found).toContain("solto.md: sem frontmatter");
  });

  it("reprova política sem `permissions`", () => {
    write(".claude/settings.json", "{}");
    expect(errors()).toContain('sem "permissions"');
  });
});

describe("a árvore real e a ligação ao gate", () => {
  it("a árvore do repositório passa", () => {
    expect(checkHarness(process.cwd())).toEqual([]);
  });

  it("os agentes de papel e o fit-analyst existem nos três harnesses", () => {
    for (const name of ["task-analyst", "executor", "fixer", "reviewer", "judge", "fit-analyst"]) {
      for (const path of [`.claude/agents/${name}.md`, `.codex/agents/${name}.toml`, `.opencode/agents/${name}.md`]) {
        expect(readFileSync(path, "utf8").length, path).toBeGreaterThan(0);
      }
    }
  });

  it("o Codex liga a guarda e o hook", () => {
    expect(readFileSync(".codex/config.toml", "utf8")).toMatch(/^\[features\]\n(?:#[^\n]*\n)*hooks = true$/m);
    expect(readFileSync(".codex/hooks.json", "utf8")).toContain("scripts/harness/codex-guard.ts");
    // Saída ≠ 0/2 faz o Codex seguir sem a guarda: a falha do processo precisa bloquear.
    expect(readFileSync(".codex/hooks.json", "utf8")).toMatch(/codex-guard\.ts\\" \|\| \{ [^}]*exit 2; \}/);
    // Fixar aprovação ou sandbox na camada de projeto sobrescreveria também a
    // escolha pessoal mais estrita (`untrusted`, `read-only`).
    const config = readFileSync(".codex/config.toml", "utf8");
    expect(config).not.toMatch(/^\s*(approval_policy|sandbox_mode)\s*=/m);
  });

  it("o comando do hook bloqueia quando a guarda não consegue rodar", () => {
    const command = (JSON.parse(readFileSync(".codex/hooks.json", "utf8")) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    }).hooks.PreToolUse[0]!.hooks[0]!.command.replace("$(git rev-parse --show-toplevel)", "/nao/existe");
    const result = spawnSync("sh", ["-c", command], { input: "{}", encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("comando bloqueado");
  });

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("faz parte do `pnpm check`", () => {
    expect(pkg.scripts["check:harness"]).toContain("scripts/harness/sync.ts");
    expect(pkg.scripts["check:harness"]).not.toContain("--write");
    expect(pkg.scripts.check?.split(" && ")).toContain("pnpm check:harness");
  });

  it("é passo de um job do CI exigido pelo agregador", () => {
    expect(() => gatedJobWithStep(ciWorkflow(), (step) => step.run === "pnpm check:harness")).not.toThrow();
  });
});
