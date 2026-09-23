// Suite: gate estrutural da fonte canônica das instruções (#203, V09-01, V09-02)
// Invariant: harness lê a entrada e as skills por symlink, nunca por cópia; todo
//   link, âncora e ID de regra da entrada, das regras e das skills chega ao destino
// Boundary IN: scripts/rules/check-instructions.ts sobre uma árvore temporária com
//   regressões induzidas, a árvore real e a ligação ao `pnpm check` e ao CI
// Boundary OUT: o conteúdo das regras — o gate não julga texto, só ponteiros
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInstructions, headingSlug } from "../scripts/rules/check-instructions.ts";
import { ciWorkflow, gatedJobWithStep } from "./support/ci-workflow.ts";

let root: string;

function write(path: string, contents: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), contents);
}

function link(path: string, target: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  symlinkSync(target, join(root, path));
}

const ENTRY = [
  "# Entrada",
  "",
  "Regra: [G43](docs/engineering/rules/delivery.md#g43), detalhe em",
  "[promoção](docs/engineering/rules/delivery.md#branches-e-promoção) e [site](https://example.com).",
  "",
  "```",
  "[exemplo que não é link](nao-existe.md)",
  "```",
  "",
  "Código em linha não conta: `[x](tambem-nao-existe.md)`.",
  "",
].join("\n");

const INVENTORY = [
  "# Regras",
  "",
  "| ID | Obrigação | Destino |",
  "|---|---|---|",
  "| G43 | Worktree de dev | [delivery](delivery.md#g43) |",
  "| G44 | Preservar WIP | [delivery](delivery.md#g44) |",
  "",
].join("\n");

const DELIVERY = [
  "# Entrega",
  "",
  "## Branches e promoção",
  "",
  '<a id="g43"></a>',
  "### G43 — Worktree de dev",
  "",
  '<a id="g44"></a>',
  "### G44 — Preservar WIP",
  "",
].join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "instrucoes-"));
  write("AGENTS.md", ENTRY);
  link("CLAUDE.md", "AGENTS.md");
  write(".claude/skills/demo/SKILL.md", "Política em [G43](../../../docs/engineering/rules/delivery.md#g43).\n");
  write(".claude/agents/revisor.md", "agente\n");
  write(".claude/commands/vagas.md", "comando\n");
  link(".codex/skills", "../.claude/skills");
  link(".opencode/skills", "../.claude/skills");
  link(".opencode/agents", "../.claude/agents");
  link(".opencode/commands", "../.claude/commands");
  write("docs/engineering/rules/README.md", INVENTORY);
  write("docs/engineering/rules/delivery.md", DELIVERY);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const errors = () => checkInstructions(root).join("\n");

describe("V09-01 — symlink dos harnesses, nunca cópia", () => {
  it("aceita a árvore com os symlinks canônicos, links externos e exemplos em código", () => {
    expect(checkInstructions(root)).toEqual([]);
  });

  it("reprova CLAUDE.md trocado por cópia idêntica da entrada", () => {
    unlinkSync(join(root, "CLAUDE.md"));
    write("CLAUDE.md", ENTRY);
    expect(errors()).toContain("CLAUDE.md: é cópia, não symlink");
  });

  it("reprova as skills de um harness copiadas em vez de ligadas", () => {
    unlinkSync(join(root, ".codex/skills"));
    cpSync(join(root, ".claude/skills"), join(root, ".codex/skills"), { recursive: true });
    expect(errors()).toContain(".codex/skills: é cópia, não symlink");
  });

  it("reprova symlink para o destino errado, quebrado ou ausente", () => {
    unlinkSync(join(root, ".opencode/skills"));
    link(".opencode/skills", "../.claude/agents");
    rmSync(join(root, ".claude/commands"), { recursive: true });
    unlinkSync(join(root, ".opencode/agents"));
    const found = errors();
    expect(found).toContain(".opencode/skills: aponta para ../.claude/agents; esperado ../.claude/skills");
    expect(found).toContain(".opencode/commands: symlink quebrado");
    expect(found).toContain(".opencode/agents: ausente");
  });

  it("reprova instrução duplicada por harness e aceita o ponteiro legítimo", () => {
    write(".codex/AGENTS.md", ENTRY);
    expect(errors()).toContain(".codex/AGENTS.md: instrução duplicada por harness");
    unlinkSync(join(root, ".codex/AGENTS.md"));
    link(".codex/AGENTS.md", "../AGENTS.md");
    expect(checkInstructions(root)).toEqual([]);
  });
});

describe("V09-02 — links, âncoras e IDs de regra", () => {
  it("reprova link para arquivo inexistente, com arquivo e linha", () => {
    write("AGENTS.md", `${ENTRY}Leia [o roteiro](docs/engineering/workflow.md).\n`);
    expect(errors()).toMatch(/AGENTS\.md:\d+: link para "docs\/engineering\/workflow\.md"/);
  });

  it("reprova âncora de regra inexistente na entrada e na skill", () => {
    write("AGENTS.md", `${ENTRY}[G99](docs/engineering/rules/delivery.md#g99)\n`);
    write(".claude/skills/demo/SKILL.md", "[G43](../../../docs/engineering/rules/delivery.md#g43-antiga)\n");
    const found = errors();
    expect(found).toContain('âncora "#g99" não existe em docs/engineering/rules/delivery.md');
    expect(found).toMatch(/\.claude\/skills\/demo\/SKILL\.md:1: âncora "#g43-antiga"/);
  });

  it("reprova rótulo de ID que aponta para outra regra ou para nenhuma âncora", () => {
    write("AGENTS.md", `${ENTRY}[G44](docs/engineering/rules/delivery.md#g43) e [G43](docs/engineering/rules/delivery.md)\n`);
    const found = errors();
    expect(found).toContain('[G44] aponta para "#g43" — o rótulo e a âncora precisam ser o mesmo ID');
    expect(found).toContain("[G43] aponta para");
    expect(found).toContain("sem âncora do ID");
  });

  it("aceita âncora de título acentuado, sufixo de título repetido e âncora local", () => {
    write("docs/engineering/rules/delivery.md", `${DELIVERY}## Notas\n\n## Notas\n\nVolte a [G43](#g43).\n`);
    write("AGENTS.md", `${ENTRY}[notas](docs/engineering/rules/delivery.md#notas-1) e [cópia](docs/engineering/rules/delivery.md#branches-e-promo%C3%A7%C3%A3o)\n`);
    expect(checkInstructions(root)).toEqual([]);
  });

  it("resolve título com código em linha como o GitHub, com o texto do código", () => {
    write("docs/engineering/rules/delivery.md", `${DELIVERY}## Base \`dev\` e \`main\`\n`);
    write("AGENTS.md", `${ENTRY}[base](docs/engineering/rules/delivery.md#base-dev-e-main)\n`);
    expect(checkInstructions(root)).toEqual([]);
    write("AGENTS.md", `${ENTRY}[base](docs/engineering/rules/delivery.md#base--e-)\n`);
    expect(errors()).toContain('âncora "#base--e-" não existe');
  });

  it("reprova linha do inventário que aponta para outra âncora ou se repete", () => {
    write("docs/engineering/rules/README.md", `${INVENTORY}| G44 | Outra vez | [delivery](delivery.md#g43) |\n`);
    const found = errors();
    expect(found).toContain("G44 repetido no inventário");
    expect(found).toContain("a linha de G44 precisa apontar para a âncora #g44");
  });

  it("reprova regra sem linha no inventário e regra com dois destinos primários", () => {
    write("docs/engineering/rules/delivery.md", `${DELIVERY}<a id="g50"></a>\n### G50 — Limpar\n`);
    write("docs/engineering/rules/security.md", '# Segurança\n\n<a id="g43"></a>\n### G43 — De novo\n');
    const found = errors();
    expect(found).toContain("G50 não tem linha no inventário");
    expect(found).toContain("G43 já é definida em docs/engineering/rules/delivery.md");
  });
});

describe("slug de título", () => {
  it("segue o GitHub: minúsculas, acento preservado, pontuação removida, espaço vira hífen", () => {
    expect(headingSlug("G43 — Tarefa nasce em worktree a partir de `dev`; PR aponta para `dev` (regra 18)"))
      .toBe("g43--tarefa-nasce-em-worktree-a-partir-de-dev-pr-aponta-para-dev-regra-18");
    expect(headingSlug("Evidência e limites")).toBe("evidência-e-limites");
    expect(headingSlug("Ver [o roteiro](workflow.md)")).toBe("ver-o-roteiro");
  });
});

describe("a árvore real e a ligação ao gate", () => {
  it("a árvore do repositório passa", () => {
    expect(checkInstructions(process.cwd())).toEqual([]);
  });

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("faz parte do `pnpm check`", () => {
    expect(pkg.scripts["check:instructions"]).toContain("scripts/rules/check-instructions.ts");
    expect(pkg.scripts.check?.split(" && ")).toContain("pnpm check:instructions");
  });

  it("é passo de um job do CI exigido pelo agregador", () => {
    expect(() => gatedJobWithStep(ciWorkflow(), (step) => step.run === "pnpm check:instructions")).not.toThrow();
  });
});
