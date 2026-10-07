/**
 * Emissor OpenID Connect falso, só de loopback (#464, ADR-010).
 *
 * Existe para o teste exercitar o fluxo de verdade — redirecionamento,
 * troca do código com PKCE, ID token assinado em RS256 e validado contra o
 * JWKS — sem falar com o Google nem com o LinkedIn. O app só o aceita com
 * `JHO_ENV` `local` ou `e2e`, fora da Vercel (`issuerFor`).
 *
 * Um emissor por provedor, sob o mesmo servidor: `<base>/google` e
 * `<base>/linkedin`. Cada um tem um comportamento ajustável (`setBehavior`, ou
 * `POST <base>/__control/<provedor>` vindo de outro processo):
 *
 *   - `consent`  — consente sozinho e devolve `sub`, `email`, `email_verified`;
 *   - `cancel`   — a pessoa recusou (`?error=access_denied`);
 *   - `error`    — o endpoint de token responde 500;
 *   - `tamper`   — `foreign-key` (chave fora do JWKS), `aud` ou `nonce` errados.
 *
 * `handle(request)` é a mesma lógica sem rede: os testes de unidade a usam
 * como `fetch` injetado.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

export const FAKE_CLIENTS = {
  google: { id: "fake-google-client", secret: "fake-google-secret" },
  linkedin: { id: "fake-linkedin-client", secret: "fake-linkedin-secret" },
};

const PROVIDERS = Object.keys(FAKE_CLIENTS);
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function defaultBehavior(provider) {
  return {
    mode: "consent",
    sub: `fake-${provider}-subject`,
    email: `fake@${provider}.test`,
    emailVerified: true,
    tamper: null,
  };
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function redirectTo(location) {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * A lógica do emissor, sem servidor. `base` é a origem que aparece nas URLs
 * (descoberta, `iss`); `setBase` a troca quando o servidor descobre a porta.
 */
export function createFakeOidc({ base = "http://127.0.0.1:65530" } = {}) {
  let origin = base.replace(/\/+$/, "");
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const foreign = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `fake-${randomBytes(4).toString("hex")}`;
  const behaviors = new Map(PROVIDERS.map((provider) => [provider, defaultBehavior(provider)]));
  const codes = new Map();
  /** O que cada `/authorize` recebeu, para o teste conferir escopo e PKCE. */
  const authorizeRequests = [];

  const issuerOf = (provider) => `${origin}/${provider}`;

  function idToken(provider, grant) {
    const behavior = grant.behavior;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuerOf(provider),
      sub: behavior.sub,
      aud: behavior.tamper === "aud" ? "outro-cliente" : grant.clientId,
      iat: now,
      exp: now + 300,
      nonce: behavior.tamper === "nonce" ? "nonce-errado" : grant.nonce,
    };
    if (behavior.email !== null && behavior.email !== undefined) claims.email = behavior.email;
    // `undefined` omite a afirmação, como o LinkedIn às vezes faz.
    if (behavior.emailVerified !== undefined) claims.email_verified = behavior.emailVerified;
    const foreignKey = behavior.tamper === "foreign-key";
    const header = { alg: "RS256", typ: "JWT", kid: foreignKey ? "chave-fora-do-jwks" : kid };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = sign("RSA-SHA256", Buffer.from(input), foreignKey ? foreign.privateKey : key.privateKey);
    return `${input}.${signature.toString("base64url")}`;
  }

  async function handle(request) {
    const url = new URL(request.url);
    const [, first, ...rest] = url.pathname.split("/");
    const path = rest.join("/");

    if (first === "__control" && request.method === "POST") {
      const provider = rest[0];
      if (!behaviors.has(provider)) return json({ error: "unknown provider" }, 404);
      const body = await request.json();
      behaviors.set(provider, { ...defaultBehavior(provider), ...body });
      return json({ ok: true });
    }

    const provider = first;
    if (!behaviors.has(provider)) return json({ error: "not_found" }, 404);
    const client = FAKE_CLIENTS[provider];

    if (path === ".well-known/openid-configuration") {
      const issuer = issuerOf(provider);
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        scopes_supported: ["openid", "email", "profile"],
      });
    }

    if (path === "jwks") {
      const jwk = key.publicKey.export({ format: "jwk" });
      return json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
    }

    if (path === "authorize") {
      const params = url.searchParams;
      const redirectUri = params.get("redirect_uri");
      const state = params.get("state");
      authorizeRequests.push({ provider, params: Object.fromEntries(params) });
      if (params.get("client_id") !== client.id || !redirectUri) return json({ error: "invalid_client" }, 400);
      if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
        return json({ error: "invalid_request" }, 400);
      }
      const back = new URL(redirectUri);
      if (state !== null) back.searchParams.set("state", state);
      const behavior = behaviors.get(provider);
      if (behavior.mode === "cancel") {
        back.searchParams.set("error", "access_denied");
        return redirectTo(back.toString());
      }
      const code = randomBytes(16).toString("base64url");
      codes.set(code, {
        provider,
        clientId: client.id,
        redirectUri,
        nonce: params.get("nonce"),
        challenge: params.get("code_challenge"),
        behavior: { ...behavior },
        used: false,
      });
      back.searchParams.set("code", code);
      return redirectTo(back.toString());
    }

    if (path === "token" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const grant = codes.get(form.get("code") ?? "");
      if (!grant || grant.used || grant.provider !== provider) return json({ error: "invalid_grant" }, 400);
      grant.used = true;
      if (form.get("client_id") !== client.id || form.get("client_secret") !== client.secret) {
        return json({ error: "invalid_client" }, 401);
      }
      if (form.get("redirect_uri") !== grant.redirectUri) return json({ error: "invalid_grant" }, 400);
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== grant.challenge) {
        return json({ error: "invalid_grant", error_description: "PKCE" }, 400);
      }
      if (grant.behavior.mode === "error") {
        return new Response("emissor falso fora do ar", { status: 500 });
      }
      return json({
        access_token: randomBytes(16).toString("base64url"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken(provider, grant),
      });
    }

    return json({ error: "not_found" }, 404);
  }

  return {
    get url() {
      return origin;
    },
    setBase(next) {
      origin = next.replace(/\/+$/, "");
    },
    issuer: issuerOf,
    handle,
    /** `fetch` sem rede, para injetar no adapter. */
    fetch: (input, init) => handle(new Request(input, init)),
    setBehavior(provider, behavior) {
      behaviors.set(provider, { ...defaultBehavior(provider), ...behavior });
    },
    reset() {
      for (const provider of PROVIDERS) behaviors.set(provider, defaultBehavior(provider));
      codes.clear();
      authorizeRequests.length = 0;
    },
    authorizeRequests,
  };
}

/** Sobe o emissor num servidor HTTP de loopback. Endereço que não é loopback é recusado. */
export async function startFakeOidc({ host = "127.0.0.1", port = 0 } = {}) {
  if (!LOOPBACK.has(host)) throw new Error("o emissor OIDC falso só escuta em loopback");
  const fake = createFakeOidc();
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const request = new Request(`${fake.url}${incoming.url}`, {
        method: incoming.method,
        headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]]),
        body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : body,
      });
      const response = await fake.handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500, { "content-type": "text/plain" });
      outgoing.end(error instanceof Error ? error.message : "erro no emissor falso");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("emissor OIDC falso sem porta");
  fake.setBase(`http://${host === "::1" ? "[::1]" : host}:${address.port}`);
  return {
    ...fake,
    get url() {
      return fake.url;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Ajusta o comportamento de um emissor que roda em outro processo (o do `run-isolated`). */
export async function setRemoteBehavior(base, provider, behavior) {
  const response = await fetch(`${base}/__control/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(behavior),
  });
  if (!response.ok) throw new Error(`emissor falso recusou o ajuste de ${provider}: ${response.status}`);
}
