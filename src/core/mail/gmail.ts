/**
 * Gmail as a mail source (F-01).
 *
 * Implements OAuth and message fetching against the Gmail REST API directly,
 * with `fetch`. The official `googleapis` package pulls a very large dependency
 * tree to wrap four HTTP calls, and this project has a standing rule against
 * weight it does not need.
 *
 * Three deliberate constraints:
 *
 *  - **Read-only scope.** `gmail.readonly` cannot send, delete or modify. Even
 *    a total compromise of the stored token cannot touch the mailbox. Per
 *    ADR 0008 mail is a sourcing signal, never an action trigger — the scope
 *    makes that structural rather than a promise.
 *  - **Loopback redirect.** The out-of-band flow ("copy this code") is
 *    deprecated and phishable. The consent response comes back to a server on
 *    127.0.0.1 that exists for the seconds the flow takes.
 *  - **Fetch writes `.eml` files; it does not import.** The existing MIME
 *    parser and classifier already handle a directory, so downloading produces
 *    files the user can read before anything touches the database. It also
 *    means `jho mail import --dry-run` still works unchanged.
 */
import { createServer } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Read-only. Cannot send, delete, or modify anything. */
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const TOKEN_FILE = ".gmail.token.json";

export type StoredToken = {
  refresh_token: string;
  access_token?: string;
  /** Epoch millis. */
  expires_at?: number;
};

export type GmailCredentials = { clientId: string; clientSecret: string };

export function credentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GmailCredentials | null {
  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function tokenPath(root = process.cwd()): string {
  return resolve(root, TOKEN_FILE);
}

export async function readToken(root = process.cwd()): Promise<StoredToken | null> {
  try {
    return JSON.parse(await readFile(tokenPath(root), "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

async function writeToken(token: StoredToken, root = process.cwd()): Promise<void> {
  const path = tokenPath(root);
  await writeFile(path, JSON.stringify(token, null, 2));
  // A refresh token is a long-lived credential to a mailbox. Default file mode
  // would leave it readable by every account on the machine.
  await chmod(path, 0o600);
}

/* --------------------------------- PKCE ---------------------------------- */

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * PKCE, even though this is a confidential client with a secret.
 *
 * The redirect lands on a loopback port that any local process could race for.
 * Without a verifier, an intercepted authorization code is enough to obtain a
 * token; with one, the code is useless to anybody who did not start the flow.
 */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(
  creds: GmailCredentials,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // Required to receive a refresh token at all.
    access_type: "offline",
    // Without this, a second authorization returns no refresh token and the
    // stored one silently becomes the only copy.
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/* ------------------------------ Token exchange ---------------------------- */

async function postForm(body: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `Google recusou (${res.status}): ${json.error_description ?? json.error ?? "sem detalhe"}`,
    );
  }
  return json;
}

export async function exchangeCode(
  creds: GmailCredentials,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<StoredToken> {
  const json = await postForm(
    new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  );
  if (typeof json.refresh_token !== "string") {
    throw new Error(
      "Google não devolveu refresh_token. Revogue o acesso em myaccount.google.com/permissions e autorize de novo.",
    );
  }
  return {
    refresh_token: json.refresh_token,
    access_token: typeof json.access_token === "string" ? json.access_token : undefined,
    expires_at: Date.now() + Number(json.expires_in ?? 0) * 1000,
  };
}

export async function accessToken(
  creds: GmailCredentials,
  stored: StoredToken,
  root = process.cwd(),
  now = Date.now(),
): Promise<string> {
  // 60s of slack so a token does not expire mid-run.
  if (stored.access_token && stored.expires_at && stored.expires_at - 60_000 > now) {
    return stored.access_token;
  }
  const json = await postForm(
    new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: "refresh_token",
    }),
  );
  const token = String(json.access_token);
  await writeToken(
    { ...stored, access_token: token, expires_at: now + Number(json.expires_in ?? 0) * 1000 },
    root,
  );
  return token;
}

/* ------------------------------ Consent flow ------------------------------ */

export type AuthResult = { email?: string; savedTo: string };

/**
 * Runs the consent flow, printing the URL through `onUrl`.
 *
 * The loopback server binds to 127.0.0.1 explicitly — `localhost` can resolve
 * to a public interface in unusual setups, and this endpoint briefly receives
 * an authorization code.
 */
export async function authorize(
  creds: GmailCredentials,
  onUrl: (url: string) => void,
  root = process.cwd(),
): Promise<AuthResult> {
  const { verifier, challenge } = createPkce();
  const state = base64url(randomBytes(16));

  // The redirect URI must be byte-identical between the authorization request
  // and the token exchange, so the port the OS hands us is captured here.
  let redirectUri = "";

  const code = await new Promise<string>((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const respond = (message: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">
          <p>${message}</p><p style="color:#636363">Pode fechar esta aba e voltar ao terminal.</p>`);
      };

      const error = url.searchParams.get("error");
      if (error) {
        respond("Autorização negada.");
        server.close();
        rejectPromise(new Error(`Autorização negada: ${error}`));
        return;
      }
      // Rejecting a mismatched state is what stops another local process from
      // completing a flow it did not start.
      if (url.searchParams.get("state") !== state) {
        respond("Estado inválido.");
        server.close();
        rejectPromise(new Error("state inválido — fluxo abortado"));
        return;
      }
      const received = url.searchParams.get("code");
      if (!received) {
        respond("Sem código.");
        server.close();
        rejectPromise(new Error("Google não devolveu code"));
        return;
      }
      respond("Autorizado. Gmail conectado em modo somente leitura.");
      server.close();
      resolvePromise(received);
    });

    server.on("error", rejectPromise);
    // Port 0 = the OS picks a free one, so nothing collides with the dashboard.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("não foi possível abrir a porta de callback"));
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}/callback`;
      onUrl(buildAuthUrl(creds, redirectUri, challenge, state));
    });
  });

  const token = await exchangeCode(creds, code, redirectUri, verifier);
  await writeToken(token, root);

  // Confirms the token works and tells the user which mailbox they just linked
  // — mistaking the account is an easy and confusing error.
  let email: string | undefined;
  try {
    const res = await fetch(`${API}/profile`, {
      headers: { authorization: `Bearer ${token.access_token ?? ""}` },
    });
    if (res.ok) {
      const profile = (await res.json()) as { emailAddress?: string };
      email = profile.emailAddress;
    }
  } catch {
    // Not fatal: the token is already saved and usable.
  }

  return { email, savedTo: tokenPath(root) };
}

/* -------------------------------- Fetching -------------------------------- */

export type FetchOptions = {
  /** Gmail search syntax. Defaults to job alerts in the last 30 days. */
  query?: string;
  max?: number;
  outDir?: string;
};

export const DEFAULT_QUERY =
  'newer_than:30d (from:jobalerts-noreply@linkedin.com OR from:jobs-noreply@linkedin.com ' +
  'OR subject:("job alert" OR "vagas" OR "oportunidade") OR category:updates)';

export type FetchResult = { found: number; written: number; dir: string; skipped: number };

export async function fetchToDir(
  creds: GmailCredentials,
  stored: StoredToken,
  opts: FetchOptions = {},
  root = process.cwd(),
): Promise<FetchResult> {
  const token = await accessToken(creds, stored, root);
  const dir = resolve(root, opts.outDir ?? "data/mail");
  await mkdir(dir, { recursive: true });

  const max = opts.max ?? 100;
  const query = opts.query ?? DEFAULT_QUERY;

  const listUrl = new URL(`${API}/messages`);
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(Math.min(max, 500)));

  const listRes = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
  if (!listRes.ok) {
    throw new Error(`Gmail respondeu ${listRes.status} ao listar mensagens`);
  }
  const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const ids = (list.messages ?? []).slice(0, max);

  let written = 0;
  let skipped = 0;

  for (const { id } of ids) {
    const path = join(dir, `${id}.eml`);
    // Already downloaded: the importer dedupes too, but not re-fetching keeps
    // the run cheap and keeps us well inside Gmail's quota.
    try {
      await readFile(path);
      skipped++;
      continue;
    } catch {
      // not present, carry on
    }

    // `format=raw` returns the original MIME, which is exactly what the
    // existing parser reads. No second parsing path.
    const res = await fetch(`${API}/messages/${id}?format=raw`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const msg = (await res.json()) as { raw?: string };
    if (!msg.raw) continue;

    await writeFile(path, Buffer.from(msg.raw, "base64url").toString("utf8"));
    written++;
  }

  return { found: ids.length, written, skipped, dir };
}
