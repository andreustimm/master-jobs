/**
 * Provider adapters. Plain `fetch` against each REST API.
 *
 * No SDK: both are a single POST, and an SDK here would add a large dependency
 * tree plus its own opinions about retries and telemetry — the latter being
 * exactly what should not be added to something handling a user's key.
 */
import {
  ENV_KEYS,
  LlmError,
  type LlmPort,
  type LlmRequest,
  type LlmResponse,
  type Provider,
} from "./port.ts";

const TIMEOUT_MS = 120_000;

/**
 * Thinking budget per effort level, in tokens.
 *
 * Anthropic bills thinking tokens as output, so these are the user's money —
 * chosen to be useful rather than maximal. `max` is deliberately not unbounded.
 */
const THINKING_BUDGET: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 12_000,
  xhigh: 24_000,
  max: 32_000,
};

/** OpenAI takes a named level and has no equivalent for the top two. */
const OPENAI_EFFORT: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

/** Defaults chosen for cost, not ceiling: this reads job ads, not research. */
const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5-mini",
};

export function anthropicProvider(apiKey: string, model?: string, baseUrl?: string): LlmPort {
  const chosen = model ?? process.env.JHO_LLM_MODEL ?? DEFAULT_MODEL.anthropic;
  const endpoint = `${(baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`;

  return {
    name: "anthropic",
    model: chosen,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: chosen,
          max_tokens: req.maxTokens ?? 2000,
          // Temperature and extended thinking are mutually exclusive on this
          // API; sending both is a 400.
          ...(req.effort
            ? { thinking: { type: "enabled", budget_tokens: THINKING_BUDGET[req.effort] ?? 4096 } }
            : { temperature: req.temperature ?? 0.2 }),
          system: req.system,
          messages: req.messages,
        }),
      });

      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const error = json.error as { message?: string } | undefined;
        throw new LlmError("anthropic", res.status, error?.message ?? `HTTP ${res.status}`);
      }

      // With thinking enabled the response carries thinking blocks too; only
      // the text blocks are the answer.
      const content = (json.content ?? []) as Array<{ type: string; text?: string }>;
      const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };

      return {
        text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        model: String(json.model ?? chosen),
      };
    },
  };
}

/**
 * Also serves every "OpenAI-compatible" service — Groq, Together, OpenRouter,
 * Ollama — which is why `baseUrl` is a parameter rather than a constant. The
 * wire shape is the same; only the host changes.
 */
export function openaiProvider(apiKey: string, model?: string, baseUrl?: string): LlmPort {
  const chosen = model ?? process.env.JHO_LLM_MODEL ?? DEFAULT_MODEL.openai;
  const endpoint = `${(baseUrl ?? "https://api.openai.com").replace(/\/$/, "")}/v1/chat/completions`;

  return {
    name: "openai",
    model: chosen,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: chosen,
          max_completion_tokens: req.maxTokens ?? 2000,
          ...(req.effort ? { reasoning_effort: OPENAI_EFFORT[req.effort] ?? "medium" } : {}),
          messages: [{ role: "system", content: req.system }, ...req.messages],
        }),
      });

      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const error = json.error as { message?: string } | undefined;
        throw new LlmError("openai", res.status, error?.message ?? `HTTP ${res.status}`);
      }

      const choices = (json.choices ?? []) as Array<{ message?: { content?: string } }>;
      const usage = (json.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };

      return {
        text: choices[0]?.message?.content ?? "",
        inputTokens: usage.prompt_tokens ?? null,
        outputTokens: usage.completion_tokens ?? null,
        model: String(json.model ?? chosen),
      };
    },
  };
}

export type ResolvedLlm = { port: LlmPort; provider: Provider };

/**
 * Picks a provider from whichever key is present.
 *
 * Returns null rather than throwing: every LLM feature here is optional, and a
 * missing key must degrade to "this feature is off", never break a command that
 * would otherwise work offline.
 */
export function resolveLlm(env: Record<string, string | undefined> = process.env): ResolvedLlm | null {
  const explicit = env.JHO_LLM_PROVIDER as Provider | undefined;
  const order: Provider[] = explicit ? [explicit] : ["anthropic", "openai"];

  for (const provider of order) {
    const key = env[ENV_KEYS[provider]];
    if (!key) continue;
    const port = provider === "anthropic" ? anthropicProvider(key) : openaiProvider(key);
    return { port, provider };
  }
  return null;
}
