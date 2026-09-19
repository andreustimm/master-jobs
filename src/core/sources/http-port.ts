/**
 * HTTP as a port (MIGRATION passo 3).
 *
 * The thirteen source adapters were untestable for one reason: they called the
 * network directly, so verifying "Lever returns an empty string for
 * descriptionPlain" required Lever to be up, reachable, and unchanged. That is
 * how the `??`-versus-empty-string bug survived long enough to blank 4.538
 * descriptions — no test could have caught it.
 *
 * The injection is module-scoped rather than threaded through every adapter
 * signature. That is a deliberate compromise and worth naming: passing `deps`
 * into thirteen `fetchJobs` calls would be the purer shape, but it changes
 * thirteen files, their registry, and every call site, to buy a property that
 * one swappable module already provides. ADR 0007 rejects ceremony that buys
 * nothing — the boundary is what matters, not the plumbing style.
 *
 * The rule that keeps this honest: **nothing outside this file and `http.ts`
 * may call `fetch` for a source**, enforced by an architecture test.
 */

export type HttpPort = {
  /** Returns parsed JSON, or throws for a non-retryable failure. */
  json<T = unknown>(url: string, opts?: HttpOptions): Promise<T>;
  /** Returns body text, or null when the page could not be read. */
  text(url: string, opts?: HttpOptions): Promise<string | null>;
};

export type HttpOptions = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
};

/**
 * A non-2xx answer. Lives beside the port so the test double throws exactly
 * what the network does: callers branch on `status` (429 spends the day's
 * quota, 404 means the endpoint is gone), not on message text.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

let current: HttpPort | null = null;

/** The port in force. Falls back to the real implementation. */
export function http(): HttpPort {
  if (current) return current;
  throw new Error("HTTP port não inicializada — importe src/core/sources/http.ts");
}

export function setHttpPort(port: HttpPort): void {
  current = port;
}

export function resetHttpPort(): void {
  current = realPort;
}

let realPort: HttpPort | null = null;

/** Called once by `http.ts`, which owns the real implementation. */
export function registerRealPort(port: HttpPort): void {
  realPort = port;
  if (!current) current = port;
}

/* ------------------------------- Test double ------------------------------ */

export type Fixture = string | object | { status: number; body?: string | object };

/**
 * An HTTP port backed by a map of URL to canned response.
 *
 * Matching is by substring so a test can key on the distinctive part of an
 * endpoint without reproducing every query parameter the adapter appends.
 */
export function fixtureHttp(
  fixtures: Record<string, Fixture>,
): HttpPort & { calls: string[]; options: Array<HttpOptions | undefined> } {
  const calls: string[] = [];
  const options: Array<HttpOptions | undefined> = [];

  function find(url: string): Fixture | undefined {
    if (fixtures[url] !== undefined) return fixtures[url];
    for (const [key, value] of Object.entries(fixtures)) {
      if (url.includes(key)) return value;
    }
    return undefined;
  }

  return {
    calls,
    options,
    async json<T>(url: string, opts?: HttpOptions): Promise<T> {
      calls.push(url);
      options.push(opts);
      const fixture = find(url);
      if (fixture === undefined) throw new Error(`Sem fixture para ${url}`);
      if (typeof fixture === "object" && fixture !== null && "status" in fixture) {
        const typed = fixture as { status: number; body?: string | object };
        if (typed.status >= 400) throw new HttpError(typed.status, url, `HTTP ${typed.status} em ${url}`);
        return (typeof typed.body === "string" ? JSON.parse(typed.body) : typed.body) as T;
      }
      return (typeof fixture === "string" ? JSON.parse(fixture) : fixture) as T;
    },
    async text(url: string, opts?: HttpOptions): Promise<string | null> {
      calls.push(url);
      options.push(opts);
      const fixture = find(url);
      if (fixture === undefined) return null;
      if (typeof fixture === "object" && fixture !== null && "status" in fixture) {
        const typed = fixture as { status: number; body?: string | object };
        if (typed.status >= 400) return null;
        return typeof typed.body === "string" ? typed.body : JSON.stringify(typed.body);
      }
      return typeof fixture === "string" ? fixture : JSON.stringify(fixture);
    },
  };
}
