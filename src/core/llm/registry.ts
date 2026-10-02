/**
 * The administered provider registry (BYOK).
 *
 * `resolveLlm` in `providers.ts` reads the environment and is the zero-config
 * path: set a key, it works. This is the other half — a catalogue the user
 * curates, so a provider or model can be added without a release.
 *
 * The key is never here. A provider row names the environment variable to read
 * it from, which is what keeps "your key stays yours" a structural fact rather
 * than a promise: a database file gets copied, backed up, and opened by other
 * processes, and a key in it would travel with all of that.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
  EFFORT_LEVELS,
  LLM_KINDS,
  llmModel,
  llmProvider,
  type EffortLevel,
  type LlmKind,
} from "../db/schema.ts";
import { RETIRED_MODELS, retirementOf, type RetiredModel, type Retirement } from "./model-retirement.ts";
import { anthropicProvider, openaiProvider } from "./providers.ts";
import { ENV_KEYS, type LlmPort } from "./port.ts";

export type ModelChoice = {
  providerSlug: string;
  providerLabel: string;
  kind: LlmKind;
  baseUrl: string | null;
  apiKeyEnv: string;
  modelId: string;
  modelLabel: string;
  supportsReasoning: boolean;
  effort: EffortLevel | null;
  maxOutputTokens: number;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
  /** False when the env var this provider points at is not set. */
  keyPresent: boolean;
  /** Desligado pelo provedor (#438): listado com a marca, nunca escolhido. */
  retired: Retirement | null;
};

export function isEffort(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function isKind(value: string): value is LlmKind {
  return (LLM_KINDS as readonly string[]).includes(value);
}

/**
 * Seeds the providers the project ships knowing about.
 *
 * The model lists are a starting point, not a source of truth — vendors add and
 * retire models faster than any hard-coded list survives. `jho llm add-model`
 * exists so the user is never blocked waiting for a release, and this seed
 * never overwrites what they curated.
 *
 * Costs are per million tokens, and null where the vendor does not publish a
 * simple number. Zero means the free tier genuinely costs nothing.
 *
 * Idempotent, and it never overwrites what the user edited — the whole point of
 * the registry is that their curation survives.
 *
 * Modelo que o provedor desligou não é cadastrado; `retired` devolve os de
 * provedores semeados, para a CLI dizer o que ficou de fora e por quê (#438).
 * Linha antiga desses modelos não é apagada: a leitura a marca (`retired`).
 */
export async function seedProviders(): Promise<{ providers: number; models: number; retired: RetiredModel[] }> {
  const db = getDb();
  const seed: Array<{
    slug: string;
    label: string;
    kind: LlmKind;
    apiKeyEnv: string;
    baseUrl?: string;
    notes?: string;
    models: Array<{
      modelId: string;
      label: string;
      reasoning: boolean;
      effort: EffortLevel | null;
      out: number;
      inCost: number | null;
      outCost: number | null;
    }>;
  }> = [
    {
      slug: "anthropic",
      label: "Anthropic",
      kind: "anthropic",
      apiKeyEnv: ENV_KEYS.anthropic,
      models: [
        { modelId: "claude-opus-5", label: "Opus 5", reasoning: true, effort: "high", out: 8192, inCost: 15, outCost: 75 },
        { modelId: "claude-sonnet-5", label: "Sonnet 5", reasoning: true, effort: "medium", out: 8192, inCost: 3, outCost: 15 },
        { modelId: "claude-haiku-4-5-20251001", label: "Haiku 4.5", reasoning: false, effort: null, out: 4096, inCost: 0.8, outCost: 4 },
      ],
    },
    {
      slug: "openai",
      label: "OpenAI",
      kind: "openai",
      apiKeyEnv: ENV_KEYS.openai,
      models: [
        { modelId: "gpt-5", label: "GPT-5", reasoning: true, effort: "medium", out: 8192, inCost: null, outCost: null },
        { modelId: "gpt-5-mini", label: "GPT-5 mini", reasoning: true, effort: "low", out: 4096, inCost: null, outCost: null },
      ],
    },
    {
      slug: "openrouter",
      label: "OpenRouter",
      kind: "compatible",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api",
      notes: "Roteia para dezenas de provedores com uma chave só.",
      models: [
        { modelId: "anthropic/claude-sonnet-5", label: "Sonnet 5 (via OR)", reasoning: true, effort: "medium", out: 8192, inCost: null, outCost: null },
        { modelId: "deepseek/deepseek-chat", label: "DeepSeek Chat", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
        { modelId: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
      ],
    },
    {
      slug: "nvidia",
      label: "NVIDIA NIM",
      kind: "compatible",
      apiKeyEnv: "NVIDIA_API_KEY",
      baseUrl: "https://integrate.api.nvidia.com",
      notes: "Free tier do NVIDIA Developer Program, ~40 req/min. Chave começa com nvapi-.",
      // Os três modelos que vinham aqui (Llama 3.1 405B, Qwen3 Coder 480B,
      // Kimi K2) foram desligados pelo provedor: estão em `RETIRED_MODELS`,
      // com status e data (#438). Escolher o substituto é de quem paga a
      // chave: `jho llm add-model nvidia <id>`.
      models: [],
    },
    {
      slug: "opencode-zen",
      label: "OpenCode Zen",
      kind: "compatible",
      apiKeyEnv: "OPENCODE_ZEN_API_KEY",
      baseUrl: "https://opencode.ai/zen",
      notes: "Modelos gratuitos, sem cartão. Conta em opencode.ai/auth.",
      models: [
        { modelId: "big-pickle", label: "Big Pickle (free)", reasoning: false, effort: null, out: 4096, inCost: 0, outCost: 0 },
        { modelId: "deepseek-v4-flash", label: "DeepSeek V4 Flash (free)", reasoning: false, effort: null, out: 4096, inCost: 0, outCost: 0 },
        { modelId: "mimo-v2.5", label: "MiMo V2.5 (free)", reasoning: false, effort: null, out: 4096, inCost: 0, outCost: 0 },
        { modelId: "nemotron-3-ultra", label: "Nemotron 3 Ultra (free)", reasoning: false, effort: null, out: 4096, inCost: 0, outCost: 0 },
        { modelId: "north-mini-code", label: "North Mini Code (free)", reasoning: false, effort: null, out: 4096, inCost: 0, outCost: 0 },
      ],
    },
    {
      slug: "opencode-go",
      label: "OpenCode Go",
      kind: "compatible",
      apiKeyEnv: "OPENCODE_API_KEY",
      baseUrl: "https://opencode.ai/zen/go",
      notes: "Plano pago do OpenCode; chave gerada no console do Zen.",
      models: [
        { modelId: "glm-5.1", label: "GLM-5.1", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
        { modelId: "kimi-k2.7-code", label: "Kimi K2.7 Code", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
        { modelId: "deepseek-v4-pro", label: "DeepSeek V4 Pro", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
        { modelId: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", reasoning: false, effort: null, out: 8192, inCost: null, outCost: null },
      ],
    },
  ];

  let providers = 0;
  let models = 0;

  for (const p of seed) {
    await db
      .insert(llmProvider)
      .values({
        slug: p.slug,
        label: p.label,
        kind: p.kind,
        apiKeyEnv: p.apiKeyEnv,
        baseUrl: p.baseUrl ?? null,
        notes: p.notes ?? null,
      })
      .onConflictDoNothing();
    providers++;

    const [row] = await db
      .select({ id: llmProvider.id })
      .from(llmProvider)
      .where(eq(llmProvider.slug, p.slug))
      .limit(1);
    if (!row) continue;

    for (const m of p.models) {
      await db
        .insert(llmModel)
        .values({
          providerId: row.id,
          modelId: m.modelId,
          label: m.label,
          supportsReasoning: m.reasoning,
          defaultEffort: m.effort,
          maxOutputTokens: m.out,
          inputCostPerMTok: m.inCost,
          outputCostPerMTok: m.outCost,
          // Sonnet as the shipped default: reads job ads well and costs a
          // fraction of the top tier, which matters when the user pays.
          isDefault: m.modelId === "claude-sonnet-5",
        })
        .onConflictDoNothing();
      models++;
    }
  }

  const seeded = new Set(seed.map((p) => p.slug));
  return { providers, models, retired: RETIRED_MODELS.filter((m) => seeded.has(m.providerSlug)) };
}

/**
 * A chave da variável de ambiente, aparada; `undefined` quando falta ou só tem
 * espaço. É a mesma leitura de `redactKey` ("(ausente)" para chave só com
 * espaços): sem ela, o banner dizia `ok` e o comando mostrava "(ausente)" e
 * falhava com 401. `keyPresent` e `portFor` leem por aqui, então concordam.
 */
function keyFromEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export async function listModels(onlyEnabled = false): Promise<ModelChoice[]> {
  const db = getDb();
  const rows = await db
    .select({
      providerSlug: llmProvider.slug,
      providerLabel: llmProvider.label,
      kind: llmProvider.kind,
      baseUrl: llmProvider.baseUrl,
      apiKeyEnv: llmProvider.apiKeyEnv,
      providerEnabled: llmProvider.enabled,
      modelId: llmModel.modelId,
      modelLabel: llmModel.label,
      supportsReasoning: llmModel.supportsReasoning,
      defaultEffort: llmModel.defaultEffort,
      maxOutputTokens: llmModel.maxOutputTokens,
      inputCostPerMTok: llmModel.inputCostPerMTok,
      outputCostPerMTok: llmModel.outputCostPerMTok,
      enabled: llmModel.enabled,
      isDefault: llmModel.isDefault,
    })
    .from(llmModel)
    .innerJoin(llmProvider, eq(llmProvider.id, llmModel.providerId));

  return rows
    .filter((r) => (onlyEnabled ? r.enabled && r.providerEnabled : true))
    .map((r) => ({
      providerSlug: r.providerSlug,
      providerLabel: r.providerLabel,
      kind: r.kind as LlmKind,
      baseUrl: r.baseUrl,
      apiKeyEnv: r.apiKeyEnv,
      modelId: r.modelId,
      modelLabel: r.modelLabel,
      supportsReasoning: r.supportsReasoning,
      effort: (r.defaultEffort as EffortLevel | null) ?? null,
      maxOutputTokens: r.maxOutputTokens,
      inputCostPerMTok: r.inputCostPerMTok,
      outputCostPerMTok: r.outputCostPerMTok,
      keyPresent: keyFromEnv(r.apiKeyEnv) !== undefined,
      retired: retirementOf(r.providerSlug, r.modelId),
    }))
    .sort((a, b) => Number(b.keyPresent) - Number(a.keyPresent) || a.modelLabel.localeCompare(b.modelLabel));
}

const matches = (m: ModelChoice, explicit: string) => m.modelId === explicit || m.modelLabel === explicit;

/**
 * The model a command should use.
 *
 * Order: an explicit `--model`, then the row marked default, then any enabled
 * model whose key is actually present. A model whose key is missing is never
 * chosen silently — that would fail at the API with an opaque 401 instead of
 * here with an explanation.
 *
 * Modelo desligado pelo provedor nunca é escolhido, nem pedido pelo nome nem
 * marcado como padrão num cadastro antigo (#438): ele falharia sempre, como
 * `provider_error`, depois de a pessoa esperar. `explainNoModel` diz por quê.
 */
export async function chooseModel(explicit?: string): Promise<ModelChoice | null> {
  const models = (await listModels(true)).filter((m) => m.retired === null);
  if (models.length === 0) return null;

  if (explicit) {
    const found = models.find((m) => matches(m, explicit));
    return found ?? null;
  }

  const db = getDb();
  const [defaultRow] = await db
    .select({ modelId: llmModel.modelId, providerSlug: llmProvider.slug })
    .from(llmModel)
    .innerJoin(llmProvider, eq(llmProvider.id, llmModel.providerId))
    .where(and(eq(llmModel.isDefault, true), eq(llmModel.enabled, true)))
    .limit(1);

  // O mesmo id pode existir em dois provedores: o padrão é a linha, não o id.
  const preferred = defaultRow
    ? models.find((m) => m.modelId === defaultRow.modelId && m.providerSlug === defaultRow.providerSlug)
    : undefined;
  if (preferred?.keyPresent) return preferred;

  return models.find((m) => m.keyPresent) ?? null;
}

export type NoModelReason =
  /** `--model` pediu um modelo que o provedor desligou. */
  | { kind: "retired"; model: ModelChoice; retirement: Retirement }
  /** `--model` pediu um modelo que não está cadastrado (ou está desabilitado). */
  | { kind: "unknown_model"; explicit: string }
  /** Há chave, mas só para modelos desligados: o caso do cadastro NIM antigo. */
  | { kind: "only_retired"; retired: Array<{ model: ModelChoice; retirement: Retirement }> }
  /** Nenhum modelo habilitado tem a chave no ambiente. */
  | { kind: "no_key" };

/**
 * Por que `chooseModel` não devolveu nada — para a CLI dizer "nenhum modelo
 * disponível: escolha um" com o motivo, em vez de deixar a pessoa descobrir
 * por um `provider_error` (#438).
 */
export async function explainNoModel(explicit?: string): Promise<NoModelReason> {
  const models = await listModels(true);
  if (explicit) {
    const asked = models.find((m) => matches(m, explicit));
    return asked?.retired ? { kind: "retired", model: asked, retirement: asked.retired } : { kind: "unknown_model", explicit };
  }
  const retired = models.flatMap((model) => (model.retired && model.keyPresent ? [{ model, retirement: model.retired }] : []));
  return retired.length > 0 ? { kind: "only_retired", retired } : { kind: "no_key" };
}

/** Builds the port for a chosen model. Throws when the key is absent. */
export function portFor(choice: ModelChoice): LlmPort {
  const key = keyFromEnv(choice.apiKeyEnv);
  if (!key) {
    throw new Error(
      `${choice.providerLabel} está cadastrado, mas ${choice.apiKeyEnv} não está definida no .env.`,
    );
  }
  // "compatible" speaks the OpenAI wire shape, which most services do.
  return choice.kind === "anthropic"
    ? anthropicProvider(key, choice.modelId)
    : openaiProvider(key, choice.modelId, choice.baseUrl ?? undefined);
}

/**
 * Exactly one default, enforced on write rather than hoped for on read.
 *
 * Recusa (`retired`) tornar padrão um modelo que o provedor desligou: o
 * padrão seria inalcançável, e o atual fica como está (#438).
 *
 * O mesmo id pode existir em dois provedores — desligado num, vivo noutro.
 * Sem `providerSlug`, id que casa com mais de uma linha é `ambiguous`: escolher
 * uma ao acaso recusaria o vivo ou marcaria a linha errada.
 */
export async function setDefaultModel(
  modelId: string,
  providerSlug?: string,
): Promise<"ok" | "not_found" | "retired" | "ambiguous"> {
  const db = getDb();
  const rows = await db
    .select({ id: llmModel.id, providerSlug: llmProvider.slug })
    .from(llmModel)
    .innerJoin(llmProvider, eq(llmProvider.id, llmModel.providerId))
    .where(providerSlug ? and(eq(llmModel.modelId, modelId), eq(llmProvider.slug, providerSlug)) : eq(llmModel.modelId, modelId));
  const [target] = rows;
  if (!target) return "not_found";
  if (rows.length > 1) return "ambiguous";
  if (retirementOf(target.providerSlug, modelId)) return "retired";

  await db.update(llmModel).set({ isDefault: false });
  await db.update(llmModel).set({ isDefault: true, enabled: true }).where(eq(llmModel.id, target.id));
  return "ok";
}
