import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { llmModel, llmProvider } from "../src/core/db/schema.ts";
import {
  chooseModel,
  explainNoModel,
  isEffort,
  isKind,
  listModels,
  portFor,
  seedProviders,
  setDefaultModel,
} from "../src/core/llm/registry.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

/**
 * Every key a seeded provider might read.
 *
 * Cleared wholesale rather than one by one: the developer's own machine may
 * legitimately have any of these set, and a test whose result depends on which
 * ones happen to be exported is a test that passes for the wrong reason — or
 * fails for one, which is how this list got written.
 */
const KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "NVIDIA_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_API_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  db = await useTestDb();
  saved = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
  for (const k of KEY_VARS) delete process.env[k];
});

afterEach(async () => {
  await releaseTestDb();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("validators", () => {
  it("accepts the documented effort levels and nothing else", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      expect(isEffort(level), level).toBe(true);
    }
    expect(isEffort("turbo")).toBe(false);
  });

  it("accepts the three wire protocols", () => {
    expect(isKind("compatible")).toBe(true);
    expect(isKind("gemini")).toBe(false);
  });
});

describe("seedProviders", () => {
  it("registers every shipped provider with its models", async () => {
    await seedProviders();
    const models = await listModels();
    const providers = new Set(models.map((m) => m.providerSlug));
    expect(providers).toEqual(new Set(["anthropic", "openai", "openrouter", "opencode-zen", "opencode-go"]));
    // NVIDIA entra como provedor, mas os três modelos que a semente trazia
    // foram desligados pelo provedor (#438): nenhum deles é cadastrado.
    const slugs = (await db.select({ slug: llmProvider.slug }).from(llmProvider)).map((p) => p.slug);
    expect(slugs).toContain("nvidia");
    expect(models.some((m) => m.modelId === "claude-sonnet-5")).toBe(true);
  });

  it("records the base URL for OpenAI-compatible services", async () => {
    // Without it the adapter would call api.openai.com with someone else's key.
    await seedProviders();
    const models = await listModels();
    const openrouter = models.find((m) => m.providerSlug === "openrouter")!;
    expect(openrouter.baseUrl).toBe("https://openrouter.ai/api");
    expect(openrouter.kind).toBe("compatible");
    // O provedor NVIDIA continua cadastrado, com a base URL, mesmo sem modelo vivo.
    const [nvidia] = await db.select().from(llmProvider).where(eq(llmProvider.slug, "nvidia"));
    expect(nvidia!.baseUrl).toBe("https://integrate.api.nvidia.com");
  });

  it("marks free tiers as costing zero, not unknown", async () => {
    // Null means "not published"; zero means free. Collapsing them would hide
    // the cheapest options from someone paying their own bill.
    await seedProviders();
    const models = await listModels();
    const free = models.filter((m) => m.providerSlug === "opencode-zen");
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((m) => m.inputCostPerMTok === 0)).toBe(true);
  });

  it("never stores an API key, only the variable name", async () => {
    // The structural half of "your key stays yours": a database file gets
    // copied, backed up and opened by other processes.
    await seedProviders();
    const rows = await db.select().from(llmProvider);
    for (const row of rows) {
      expect(row.apiKeyEnv).toMatch(/_API_KEY$/);
      expect(JSON.stringify(row)).not.toMatch(/sk-[a-z]/i);
    }
    // And there is no column that could hold one.
    expect(Object.keys(rows[0]!)).not.toContain("apiKey");
  });

  it("is idempotent and does not overwrite curation", async () => {
    await seedProviders();
    await db.update(llmModel).set({ label: "Meu apelido" }).where(eq(llmModel.modelId, "claude-sonnet-5"));

    await seedProviders();

    const [row] = await db.select().from(llmModel).where(eq(llmModel.modelId, "claude-sonnet-5"));
    expect(row!.label).toBe("Meu apelido");
  });

  it("records reasoning support and effort per model", async () => {
    await seedProviders();
    const models = await listModels();
    const opus = models.find((m) => m.modelId === "claude-opus-5")!;
    const haiku = models.find((m) => m.modelId === "claude-haiku-4-5-20251001")!;
    expect(opus.supportsReasoning).toBe(true);
    expect(opus.effort).toBe("high");
    expect(haiku.supportsReasoning).toBe(false);
    expect(haiku.effort).toBeNull();
  });
});

describe("chooseModel", () => {
  it("returns nothing when no key is present", async () => {
    // A model whose key is missing must never be chosen silently — that fails
    // later at the API with an opaque 401 instead of here with an explanation.
    await seedProviders();
    expect(await chooseModel()).toBeNull();
  });

  it("picks the default when its key is available", async () => {
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await chooseModel())!.modelId).toBe("claude-sonnet-5");
  });

  it("falls back to a model whose key exists", async () => {
    // Default is Anthropic; only the OpenAI key is set.
    await seedProviders();
    process.env.OPENAI_API_KEY = "sk-test";
    const chosen = await chooseModel();
    expect(chosen!.providerSlug).toBe("openai");
  });

  it("honours an explicit model", async () => {
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await chooseModel("claude-opus-5"))!.modelLabel).toBe("Opus 5");
  });

  it("ignores a disabled model", async () => {
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await db.update(llmModel).set({ enabled: false });
    expect(await chooseModel()).toBeNull();
  });
});

/**
 * Cadastro antigo: a semente de antes de #438 gravou os modelos NIM, com
 * `enabled` verdadeiro. É o estado das máquinas que já rodaram `jho llm seed`.
 */
async function cadastroAntigoComKimiPadrao(): Promise<void> {
  const [nvidia] = await db.select({ id: llmProvider.id }).from(llmProvider).where(eq(llmProvider.slug, "nvidia"));
  await db.update(llmModel).set({ isDefault: false });
  await db.insert(llmModel).values([
    { providerId: nvidia!.id, modelId: "moonshotai/kimi-k2-instruct", label: "Kimi K2", isDefault: true },
    { providerId: nvidia!.id, modelId: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
  ]);
}

describe("modelos desligados pelo provedor (#438)", () => {
  it("a semente não cadastra modelo desligado e diz quais pulou, com status e data", async () => {
    const r = await seedProviders();

    expect((await db.select().from(llmModel)).map((m) => m.modelId)).not.toContain("moonshotai/kimi-k2-instruct");
    expect(r.retired.map((m) => [m.modelId, m.httpStatus, m.endOfLife])).toEqual([
      ["moonshotai/kimi-k2-instruct", 410, "2026-05-12"],
      ["qwen/qwen3-coder-480b-a35b-instruct", 410, "2026-06-11"],
      ["meta/llama-3.1-405b-instruct", 404, null],
    ]);
  });

  it("cadastro antigo: a lista sinaliza o desligado e a escolha nunca o devolve", async () => {
    await seedProviders();
    await cadastroAntigoComKimiPadrao();
    process.env.NVIDIA_API_KEY = "nvapi-sintetica-de-teste";

    const kimi = (await listModels(true)).find((m) => m.modelId === "moonshotai/kimi-k2-instruct")!;
    expect(kimi.retired).toEqual({ httpStatus: 410, endOfLife: "2026-05-12", observedOn: "2026-10-01" });
    // O padrão gravado é o Kimi, e a chave da NVIDIA está lá: antes, era ele
    // que rodava e voltava `provider_error`.
    expect(await chooseModel()).toBeNull();
    expect(await chooseModel("moonshotai/kimi-k2-instruct")).toBeNull();
    expect(await chooseModel("Kimi K2")).toBeNull();
  });

  it("sem modelo vivo com chave, explica que os com chave foram desligados", async () => {
    await seedProviders();
    await cadastroAntigoComKimiPadrao();
    process.env.NVIDIA_API_KEY = "nvapi-sintetica-de-teste";

    const motivo = await explainNoModel();
    expect(motivo.kind).toBe("only_retired");
    expect(motivo.kind === "only_retired" && motivo.retired.map((m) => m.model.modelId).sort()).toEqual([
      "meta/llama-3.1-405b-instruct",
      "moonshotai/kimi-k2-instruct",
    ]);
    const pedido = await explainNoModel("moonshotai/kimi-k2-instruct");
    expect(pedido).toMatchObject({
      kind: "retired",
      model: { modelId: "moonshotai/kimi-k2-instruct" },
      retirement: { httpStatus: 410, endOfLife: "2026-05-12" },
    });
    expect(await explainNoModel("modelo-inventado")).toEqual({ kind: "unknown_model", explicit: "modelo-inventado" });
  });

  it("sem chave nenhuma, o motivo é a chave, não o desligamento", async () => {
    await seedProviders();
    await cadastroAntigoComKimiPadrao();
    expect(await explainNoModel()).toEqual({ kind: "no_key" });
  });

  it("um modelo vivo com chave vence o padrão desligado", async () => {
    await seedProviders();
    await cadastroAntigoComKimiPadrao();
    process.env.NVIDIA_API_KEY = "nvapi-sintetica-de-teste";
    process.env.OPENROUTER_API_KEY = "sk-or-sintetica";

    expect((await chooseModel())!.providerSlug).toBe("openrouter");
  });

  it("`use` recusa tornar padrão um modelo desligado e não mexe no padrão atual", async () => {
    await seedProviders();
    await cadastroAntigoComKimiPadrao();
    await db.update(llmModel).set({ isDefault: false });
    await db.update(llmModel).set({ isDefault: true }).where(eq(llmModel.modelId, "claude-sonnet-5"));

    expect(await setDefaultModel("moonshotai/kimi-k2-instruct")).toBe("retired");

    const defaults = (await db.select().from(llmModel)).filter((m) => m.isDefault).map((m) => m.modelId);
    expect(defaults).toEqual(["claude-sonnet-5"]);
  });
});

describe("setDefaultModel", () => {
  it("moves the default and leaves exactly one", async () => {
    await seedProviders();
    expect(await setDefaultModel("claude-opus-5")).toBe("ok");

    const defaults = (await db.select().from(llmModel)).filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.modelId).toBe("claude-opus-5");
  });

  it("reports an unknown model instead of silently doing nothing", async () => {
    await seedProviders();
    expect(await setDefaultModel("nao-existe")).toBe("not_found");
  });
});

describe("portFor", () => {
  it("explains which variable is missing rather than failing at the API", async () => {
    await seedProviders();
    const models = await listModels();
    const model = models.find((m) => m.providerSlug === "anthropic")!;
    expect(() => portFor(model)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("builds a port when the key is there", async () => {
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const model = (await listModels()).find((m) => m.providerSlug === "anthropic")!;
    const port = portFor(model);
    expect(port.name).toBe("anthropic");
  });
});
