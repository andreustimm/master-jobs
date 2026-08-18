/**
 * Shared fetch wrapper for public job endpoints.
 *
 * These are other people's free services. Identify ourselves, keep timeouts
 * tight, retry only on transient failures, and never hammer on a 4xx.
 */
const DEFAULT_TIMEOUT_MS = 20_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

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

function userAgent(): string {
  return (
    process.env.JHO_USER_AGENT ??
    "job-hunt-os/0.1 (personal job search)"
  );
}

export async function getJson<T = unknown>(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": userAgent(),
          ...opts.headers,
        },
      });

      if (!res.ok) {
        const err = new HttpError(res.status, url, `GET ${url} -> ${res.status}`);
        // A 404 means the board handle is wrong; retrying just wastes time.
        if (!RETRYABLE.has(res.status)) throw err;
        lastError = err;
      } else {
        return (await res.json()) as T;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * First value that is actually present.
 *
 * Exists because `??` only falls through on null/undefined, and several job
 * APIs return an EMPTY STRING for a field they did not populate. Lever is the
 * worst offender: `descriptionPlain` came back as "" on 4.538 postings while
 * the real content sat in `description`, so `a ?? b` silently kept the empty
 * string and the keyword scorer read nothing at all.
 */
export function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** Cheap HTML -> text. Good enough for keyword scoring, not for rendering. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // An empty result must be null, not "", or it defeats every ?? downstream.
  return text.length > 0 ? text : null;
}
