/**
 * BYOK — bring your own key.
 *
 * The user supplies an API key; this project never ships one, never proxies a
 * request through anything, and never stores a key anywhere but the `.env` the
 * user already controls.
 *
 * Two properties matter more than which provider wins:
 *
 *  1. **The key stays the user's.** Read from the environment at call time,
 *     never written to the database, never printed, never included in an error
 *     message. `redactKey` exists because the easiest way to leak a credential
 *     is an exception handler that echoes the request.
 *
 *  2. **Sending data off the machine is a visible act.** Everything else in
 *     this system runs locally against a local database. The moment an LLM is
 *     involved, the job description — and, for tailoring, the CV — leaves. That
 *     is a legitimate trade the user can make, but it must be a decision, not a
 *     side effect. Every entry point says what will be sent before sending it.
 */

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Reasoning effort, for models that expose it.
   *
   * Each vendor spells this differently — Anthropic takes a thinking token
   * budget, OpenAI takes a named level — so the port carries the intent and
   * each adapter translates. Ignored by models that do not support it, rather
   * than erroring: a request that works on one model should not break when the
   * user switches to another.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export type LlmResponse = {
  text: string;
  /** For cost reporting. Null when the provider does not report usage. */
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
};

export type LlmPort = {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
};

/** Providers supported, in the order they are auto-detected. */
export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ENV_KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Masks a key for display.
 *
 * Never log a raw key, including on the error path — an API that rejects a key
 * often echoes it back, and a stack trace in a terminal is a stack trace in
 * someone's scrollback.
 */
export function redactKey(key: string | undefined): string {
  if (!key) return "(ausente)";
  if (key.length <= 12) return "***";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/** Strips anything that looks like a key out of arbitrary text. */
export function redactText(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-***");
}

export class LlmError extends Error {
  readonly status: number;
  readonly provider: string;

  constructor(provider: string, status: number, message: string) {
    // Redacted before it becomes an Error, so no call site can leak it.
    super(redactText(message));
    this.name = "LlmError";
    this.provider = provider;
    this.status = status;
  }
}
