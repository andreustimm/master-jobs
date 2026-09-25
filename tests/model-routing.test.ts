// Suite: roteamento de papel × complexidade × modo de assinatura (#318, G86, G87)
// Invariant: a política versionada resolve todo papel em todo modo; o juiz nunca
//   é nenhum dos modelos que escreveram o delta; modo ausente, desconhecido ou
//   incoerente falha fechado, sem rota
// Boundary IN: scripts/routing/{model-routing,route}.ts sobre a política real e
//   sobre cópias com regressões induzidas
// Boundary OUT: disponibilidade real de cota e de modelo nos provedores
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPLEXITIES,
  MODES,
  ROLES,
  agentDefault,
  providerOf,
  resolveRoute,
  validateRouting,
  type Mode,
  type Routing,
} from "../scripts/routing/model-routing.ts";
import { ROUTING_FILE, loadRouting, main, parseArgs } from "../scripts/routing/route.ts";

const RAW = JSON.parse(readFileSync(ROUTING_FILE, "utf8")) as Record<string, unknown>;
const clone = (): Record<string, any> => structuredClone(RAW) as Record<string, any>;
const inMode = (mode: Mode): Routing => validateRouting({ ...clone(), subscriptionMode: mode });

/** Todo modelo que a política pode pôr para escrever um delta. */
function writers(routing: Routing): string[] {
  const models = new Set<string>();
  for (const provider of Object.values(routing.providers)) {
    for (const role of ["executor", "fixer"] as const) {
      for (const complexity of COMPLEXITIES) {
        for (const candidate of provider.roles[role][complexity]) models.add(candidate.model);
      }
    }
  }
  return [...models].sort();
}

describe("a política versionada", () => {
  it("é válida e o modo ativo é um dos três", () => {
    expect(MODES).toContain(loadRouting(process.cwd()).subscriptionMode);
  });

  it.each(MODES)("o modo %s resolve todos os papéis em todas as complexidades", (mode) => {
    const routing = inMode(mode);
    for (const role of ROLES) {
      for (const complexity of COMPLEXITIES) {
        const authors = role === "judge" ? [writers(routing)[0]!] : undefined;
        const route = resolveRoute(routing, { role, complexity, authors });
        expect(routing.modes[mode]).toContain(route.provider);
        expect(route.model).not.toBe("");
      }
    }
  });

  it.each(MODES)("no modo %s o juiz nunca é o modelo do autor, nem de nenhum coautor", (mode) => {
    const routing = inMode(mode);
    const all = writers(routing);
    for (const author of all) {
      for (const complexity of COMPLEXITIES) {
        expect(resolveRoute(routing, { role: "judge", complexity, authors: [author] }).model).not.toBe(author);
        for (const coauthor of all) {
          const judge = resolveRoute(routing, { role: "judge", complexity, authors: [author, coauthor] }).model;
          expect([author, coauthor]).not.toContain(judge);
        }
      }
    }
  });

  it("modos de um harness só não saem dele", () => {
    for (const role of ROLES) {
      for (const complexity of COMPLEXITIES) {
        const claude = resolveRoute(inMode("claude_only"), { role, complexity, authors: ["gpt-5.6-luna"] });
        expect(claude.harness).toBe("claude");
        const codex = resolveRoute(inMode("codex_only"), { role, complexity, authors: ["claude-sonnet-5"] });
        expect(codex.harness).toBe("codex");
      }
    }
  });

  it("multi_provider segue a ladder e manda o juiz para outro provedor", () => {
    const routing = inMode("multi_provider");
    expect(routing.modes.multi_provider).toEqual(["anthropic", "openai", "opencode"]);
    expect(resolveRoute(routing, { role: "executor", complexity: "medium" }).provider).toBe("anthropic");
    expect(resolveRoute(routing, { role: "executor", complexity: "medium", unavailable: ["anthropic"] }).provider).toBe("openai");
    expect(resolveRoute(routing, { role: "judge", complexity: "high", authors: ["claude-opus-5-5"] }).provider).toBe("openai");
    expect(resolveRoute(routing, { role: "judge", complexity: "high", authors: ["gpt-5.6-luna"] }).provider).toBe("anthropic");
    const both = resolveRoute(routing, { role: "judge", complexity: "low", authors: ["claude-sonnet-5", "gpt-5.6-luna"] });
    expect(both.provider).toBe("opencode");
  });

  it("a sessão só delega a agentes do próprio harness; o juiz pode ir a outro", () => {
    const routing = inMode("multi_provider");
    expect(resolveRoute(routing, { role: "executor", complexity: "medium", session: "codex" })).toMatchObject({
      provider: "openai",
      harness: "codex",
    });
    expect(resolveRoute(routing, { role: "reviewer", complexity: "low", session: "opencode" }).harness).toBe("opencode");
    const judge = resolveRoute(routing, { role: "judge", complexity: "high", authors: ["gpt-5.6-luna"], session: "codex" });
    expect(judge.harness).toBe("claude");
    expect(() => resolveRoute(inMode("claude_only"), { role: "executor", complexity: "low", session: "codex" })).toThrow(
      "não tem provedor disponível para a sessão codex",
    );
    expect(() => resolveRoute(routing, { role: "executor", complexity: "low", session: "cursor" })).toThrow('sessão "cursor"');
  });

  it("em modo de um provedor, o juiz troca de modelo dentro dele", () => {
    const routing = inMode("claude_only");
    const judge = resolveRoute(routing, { role: "judge", complexity: "high", authors: ["claude-fable-5-1"] });
    expect(judge).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    const codex = resolveRoute(inMode("codex_only"), { role: "judge", complexity: "medium", authors: ["gpt-5.6-terra"] });
    expect(codex.model).toBe("gpt-5.6-sol");
  });

  it("a rota traz modelo, effort e o campo da chamada; OpenCode sem effort", () => {
    expect(resolveRoute(inMode("claude_only"), { role: "executor", complexity: "high" })).toEqual({
      mode: "claude_only",
      role: "executor",
      complexity: "high",
      provider: "anthropic",
      harness: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh",
      agentModel: "opus",
    });
    const codex = resolveRoute(inMode("codex_only"), { role: "executor", complexity: "low" });
    expect(codex.agentModel).toBe(codex.model);
    const opencode = resolveRoute(inMode("multi_provider"), {
      role: "reviewer",
      complexity: "low",
      unavailable: ["anthropic", "openai"],
    });
    expect(opencode).toMatchObject({ harness: "opencode", effort: null });
  });

  it("o padrão do agente é o candidato medium do provedor do harness", () => {
    const routing = inMode("claude_only");
    expect(agentDefault(routing, "claude", "executor")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      effort: "high",
    });
    expect(agentDefault(routing, "claude", "judge").model).toBe("claude-fable-5-1");
    expect(agentDefault(routing, "codex", "judge").model).toBe("gpt-5.6-terra");
    expect(agentDefault(routing, "opencode", "analyst").effort).toBeNull();
    const twoCodex = clone();
    twoCodex.providers.outro = structuredClone(twoCodex.providers.openai);
    for (const role of ROLES) {
      for (const complexity of COMPLEXITIES) {
        for (const candidate of twoCodex.providers.outro.roles[role][complexity]) candidate.model = `outro-${candidate.model}`;
      }
    }
    expect(() => agentDefault(validateRouting(twoCodex), "codex", "executor")).toThrow("esperado um provedor");
  });

  it("identifica o provedor de cada modelo registrado", () => {
    const routing = inMode("multi_provider");
    expect(providerOf(routing, "claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(providerOf(routing, "gpt-6-astra")).toBe("openai");
    expect(providerOf(routing, "opencode-go/kimi-k2.7-code")).toBe("opencode");
    expect(providerOf(routing, "nao-existe")).toBeNull();
  });
});

describe("falha fechado", () => {
  const invalid = (mutate: (raw: Record<string, any>) => void) => {
    const raw = clone();
    mutate(raw);
    return () => validateRouting(raw);
  };

  it.each([
    ["modo ausente", (raw: Record<string, any>) => delete raw.subscriptionMode, "subscriptionMode"],
    ["modo desconhecido", (raw: Record<string, any>) => (raw.subscriptionMode = "anthropic_only"), "ausente ou desconhecido"],
    ["modo com hífen", (raw: Record<string, any>) => (raw.subscriptionMode = "codex-only"), "ausente ou desconhecido"],
    ["versão de esquema", (raw: Record<string, any>) => (raw.schemaVersion = 2), "schemaVersion"],
    ["papel sem célula", (raw: Record<string, any>) => delete raw.providers.openai.roles.fixer, "roles.fixer ausente"],
    ["complexidade vazia", (raw: Record<string, any>) => (raw.providers.anthropic.roles.analyst.high = []), "sem candidato"],
    ["candidato sem modelo", (raw: Record<string, any>) => (raw.providers.anthropic.roles.analyst.high = [{ effort: "high" }]), "candidato sem model"],
    ["juiz com candidato quebrado", (raw: Record<string, any>) => (raw.providers.anthropic.roles.judge.low = [null, 1]), "candidato sem model"],
    ["effort fora da lista", (raw: Record<string, any>) => (raw.providers.anthropic.roles.executor.low[0].effort = "turbo"), 'effort "turbo"'],
    ["effort em provedor sem effort", (raw: Record<string, any>) => (raw.providers.opencode.roles.executor.low[0].effort = "high"), "(use null)"],
    ["juiz com um modelo só", (raw: Record<string, any>) => raw.providers.anthropic.roles.judge.low.pop(), "pelo menos dois modelos"],
    [
      "juiz só com modelos que escrevem",
      (raw: Record<string, any>) =>
        (raw.providers.anthropic.roles.judge.low = [
          { model: "claude-sonnet-5", effort: "medium" },
          { model: "claude-opus-5-5", effort: "medium" },
        ]),
      "judge.low: precisa de um candidato que não seja executor nem corretor",
    ],
    ["modelo em dois provedores", (raw: Record<string, any>) => (raw.providers.opencode.roles.fixer.low[0].model = "claude-sonnet-5"), "já pertence a"],
    ["harness desconhecido", (raw: Record<string, any>) => (raw.providers.opencode.harness = "cursor"), "harness desconhecido"],
    ["efforts inválido", (raw: Record<string, any>) => (raw.providers.opencode.efforts = "nenhum"), "efforts precisa ser lista"],
    ["modelo do Claude sem apelido", (raw: Record<string, any>) => delete raw.providers.anthropic.agentAliases["claude-sonnet-5"], "claude-sonnet-5 sem apelido"],
    ["apelido inválido", (raw: Record<string, any>) => (raw.providers.anthropic.agentAliases["claude-opus-5-5"] = "claude-opus-5-5"), "claude-opus-5-5 sem apelido"],
    ["apelido fora do Claude", (raw: Record<string, any>) => (raw.providers.openai.agentAliases = {}), "só o provedor do Claude Code"],
    ["provedor não objeto", (raw: Record<string, any>) => (raw.providers.extra = 1), "providers.extra: precisa ser um objeto"],
    ["sem providers", (raw: Record<string, any>) => delete raw.providers, "providers ausente"],
    ["sem modes", (raw: Record<string, any>) => delete raw.modes, "modes ausente"],
    ["modo sem ladder", (raw: Record<string, any>) => (raw.modes.codex_only = []), "ladder de provedores ausente"],
    ["provedor inexistente na ladder", (raw: Record<string, any>) => raw.modes.multi_provider.push("google"), "provedor google desconhecido"],
    ["modo extra", (raw: Record<string, any>) => (raw.modes.tudo = ["anthropic"]), "modes.tudo: modo desconhecido"],
    ["claude_only com provedor do Codex", (raw: Record<string, any>) => raw.modes.claude_only.push("openai"), "fora de claude"],
    ["ladder repetida", (raw: Record<string, any>) => raw.modes.multi_provider.push("openai"), "provedor repetido"],
  ])("recusa %s", (_, mutate, message) => {
    expect(invalid(mutate)).toThrow(message);
  });

  it("recusa arquivo que não é objeto", () => {
    expect(() => validateRouting([])).toThrow("precisa ser um objeto");
  });

  it("recusa papel, complexidade, autor, provedor e juiz impossíveis", () => {
    const routing = inMode("codex_only");
    expect(() => resolveRoute(routing, { role: "orquestrador", complexity: "low" })).toThrow('papel "orquestrador"');
    expect(() => resolveRoute(routing, { role: "executor", complexity: "extrema" })).toThrow('complexidade "extrema"');
    expect(() => resolveRoute(routing, { role: "judge", complexity: "low" })).toThrow("exige --author");
    expect(() => resolveRoute(routing, { role: "judge", complexity: "low", authors: ["gpt-4"] })).toThrow("não está no registro");
    expect(() => resolveRoute(routing, { role: "executor", complexity: "low", unavailable: ["openia"] })).toThrow(
      'provedor "openia" desconhecido',
    );
    expect(() => resolveRoute(routing, { role: "executor", complexity: "low", unavailable: ["openai"] })).toThrow(
      "nenhum provedor disponível no modo codex_only",
    );
    expect(() =>
      resolveRoute(routing, { role: "judge", complexity: "medium", authors: ["gpt-5.6-terra", "gpt-5.6-sol"] }),
    ).toThrow("nenhum juiz diferente de gpt-5.6-terra, gpt-5.6-sol");
  });
});

describe("CLI `pnpm route`", () => {
  it("lê argumentos e opções", () => {
    expect(
      parseArgs(["judge", "high", "--author", "gpt-5.6-luna", "--author", "claude-sonnet-5", "--unavailable", "anthropic,openai", "--session", "codex"]),
    ).toEqual({
      role: "judge",
      complexity: "high",
      authors: ["gpt-5.6-luna", "claude-sonnet-5"],
      unavailable: ["anthropic", "openai"],
      session: "codex",
    });
    expect(() => parseArgs(["executor"])).toThrow("uso:");
    expect(() => parseArgs(["executor", "low", "--author"])).toThrow("--author exige um valor");
    expect(() => parseArgs(["executor", "low", "--modo", "x"])).toThrow("opção desconhecida");
  });

  it("resolve com a política real do repositório", () => {
    const route = main(["reviewer", "medium"], process.cwd());
    expect(route.mode).toBe(loadRouting(process.cwd()).subscriptionMode);
  });

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  it("está exposta como script", () => {
    expect(pkg.scripts.route).toContain("scripts/routing/route.ts");
  });
});
