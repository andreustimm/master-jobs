import { describe, expect, it } from "vitest";
import { ENV_KEYS, LlmError, redactKey, redactSecret, redactText } from "../src/core/llm/port.ts";
import { resolveLlm } from "../src/core/llm/providers.ts";
import { buildAnalysisInput, loadSystemPrompt } from "../src/core/llm/analyze.ts";
import type { Dossier } from "../src/core/apply/dossier.ts";

/**
 * Parte secreta sintética, feita só de maiúsculas: nenhuma delas aparece no
 * molde da máscara (`… (N caracteres)`), então qualquer uma na saída é
 * caractere do segredo que vazou (#441, regra 16).
 */
const SEGREDO = "QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIOPASDFGHJKLZXCVBNMQWERTY";

function caracteresDoSegredo(shown: string, prefixo: string): string[] {
  const resto = shown.startsWith(prefixo) ? shown.slice(prefixo.length) : shown;
  return [...resto].filter((ch) => SEGREDO.includes(ch));
}

describe("key handling", () => {
  it("never shows a whole key", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const shown = redactKey(key);
    expect(shown).not.toContain("abcdefghij");
    expect(shown).toContain("…");
  });

  it.each([
    ["nvapi-", `nvapi-${SEGREDO}`],
    ["sk-ant-", `sk-ant-${SEGREDO}`],
    ["sk-", `sk-${SEGREDO}`],
  ])("mostra só o prefixo %s e o comprimento, nenhum caractere do segredo (#441)", (prefixo, key) => {
    const shown = redactKey(key);
    expect(shown).toBe(`${prefixo}… (${key.length} caracteres)`);
    expect(caracteresDoSegredo(shown, prefixo)).toEqual([]);
  });

  it("formato desconhecido não mostra prefixo nenhum, só o comprimento", () => {
    const key = `opencode-${SEGREDO}`;
    const shown = redactKey(key);
    expect(shown).toBe(`*** (${key.length} caracteres)`);
    expect(shown).not.toContain("opencode");
    expect(caracteresDoSegredo(shown, "")).toEqual([]);
  });

  it("espaço ou quebra de linha do .env não muda o prefixo nem o comprimento", () => {
    const key = `nvapi-${SEGREDO}`;
    expect(redactKey(`  ${key}\n`)).toBe(`nvapi-… (${key.length} caracteres)`);
  });

  it("masks a short key entirely rather than revealing most of it", () => {
    expect(redactKey("sk-ant-1234")).toBe("***");
  });

  it("says so when there is no key", () => {
    expect(redactKey(undefined)).toBe("(ausente)");
  });

  it("strips keys out of arbitrary text", () => {
    // The easiest way to leak a credential is an error handler echoing the
    // request that failed.
    const leaked = "request failed with key sk-ant-api03-SECRETVALUE12345678";
    expect(redactText(leaked)).not.toContain("SECRETVALUE");
    expect(redactText(leaked)).toContain("sk-ant-***");
  });

  it("redacts inside the error type itself, not at the call site", () => {
    // So no caller can forget.
    const err = new LlmError("anthropic", 401, "invalid key sk-ant-api03-LEAKED0000000000");
    expect(err.message).not.toContain("LEAKED");
  });

  it("redactSecret segue apagando pelo valor uma chave nvapi- ecoada no erro", () => {
    const key = `nvapi-${SEGREDO}`;
    const limpo = redactSecret(`401 Unauthorized: bad key ${key}`, key);
    expect(limpo).toBe("401 Unauthorized: bad key ***");
  });
});

describe("resolveLlm", () => {
  it("returns null when no key is present", () => {
    // Every LLM feature is optional and must degrade to "off", never break a
    // command that would otherwise work offline.
    expect(resolveLlm({})).toBeNull();
  });

  it("picks whichever provider has a key", () => {
    expect(resolveLlm({ [ENV_KEYS.openai]: "sk-x" })!.provider).toBe("openai");
    expect(resolveLlm({ [ENV_KEYS.anthropic]: "sk-ant-x" })!.provider).toBe("anthropic");
  });

  it("honours an explicit choice over auto-detection", () => {
    const both = { [ENV_KEYS.anthropic]: "a", [ENV_KEYS.openai]: "b", JHO_LLM_PROVIDER: "openai" };
    expect(resolveLlm(both)!.provider).toBe("openai");
  });

  it("returns null when the explicit provider has no key", () => {
    expect(resolveLlm({ [ENV_KEYS.anthropic]: "a", JHO_LLM_PROVIDER: "openai" })).toBeNull();
  });
});

describe("loadSystemPrompt", () => {
  it("reads the prompt from the documented markdown", async () => {
    // The prompt lives in docs/ so a user can adjust it without editing
    // TypeScript. This asserts that path actually works.
    const prompt = await loadSystemPrompt("job-analysis");
    expect(prompt).toContain("recrutador sênior");
    expect(prompt).toContain("ELEGIBILIDADE");
    // The prose around the block must not leak into the prompt.
    expect(prompt).not.toContain("## System prompt");
  });

  it("fails loudly for a prompt that does not exist", async () => {
    await expect(loadSystemPrompt("nao-existe")).rejects.toThrow();
  });
});

const dossier = {
  job: {
    id: 1,
    title: "Staff AI Engineer",
    companyName: "Acme",
    url: "https://x.test",
    applyUrl: null,
    locationRaw: "Remote — LATAM",
    ageDays: 4,
  },
  requirements: ["Oito anos construindo sistemas distribuídos em produção"],
} as unknown as Dossier;

describe("buildAnalysisInput", () => {
  it("sends the posting and nothing about the candidate", () => {
    // The privacy promise the command prints: the CV, the profile and the
    // funnel never leave the machine for this feature.
    const input = buildAnalysisInput(dossier, "Descrição da vaga.");
    expect(input).toContain("Staff AI Engineer");
    expect(input).toContain("Descrição da vaga.");
    expect(input).not.toContain("evidence");
    expect(input).not.toContain("profile");
  });

  it("includes the extracted requirements", () => {
    expect(buildAnalysisInput(dossier, "x")).toContain("Oito anos construindo");
  });

  it("omits fields that are absent instead of writing null", () => {
    const bare = { job: { ...dossier.job, locationRaw: null, ageDays: null }, requirements: [] } as unknown as Dossier;
    const input = buildAnalysisInput(bare, "x");
    expect(input).not.toContain("null");
    expect(input).not.toContain("LOCAL DECLARADO");
  });
});
