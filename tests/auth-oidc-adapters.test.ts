/**
 * Suíte: adapters OIDC do Google e do LinkedIn (#464, ADR-008).
 *
 * Invariante: erro do provedor é valor (`cancelled`, `provider_error`,
 * `invalid_response`), nunca exceção; só sai sujeito, e-mail e verificação;
 * o ID token é validado por inteiro (assinatura no JWKS, `aud`, `nonce`).
 * Fronteira DENTRO: `oidcProvider`, `googleProvider`, `linkedinProvider` e
 * `configuredOidcProvider`, com o emissor falso de `tests/e2e/fake-oidc.mjs`
 * como `fetch` injetado — e, no IT-100, em servidor de loopback de verdade.
 * Fronteira FORA: Google e LinkedIn reais — nenhum caso sai da máquina.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeOidc, FAKE_CLIENTS, startFakeOidc } from "./e2e/fake-oidc.mjs";
import { googleProvider } from "../src/contexts/auth/infra/oidc/google.ts";
import { LINKEDIN_SCOPES, linkedinProvider } from "../src/contexts/auth/infra/oidc/linkedin.ts";
import { configuredOidcProvider } from "../src/contexts/auth/infra/oidc/providers.ts";
import type { OidcProvider } from "../src/contexts/auth/ports.ts";

const REDIRECT = "http://127.0.0.1:3000/login/oauth/google/callback";
const fake = createFakeOidc();

function settings(provider: "google" | "linkedin") {
  return {
    clientId: FAKE_CLIENTS[provider].id,
    clientSecret: FAKE_CLIENTS[provider].secret,
    issuer: fake.issuer(provider),
    issuerOverridden: true,
  };
}

/** O navegador: segue a URL de autorização e devolve a URL do retorno. */
async function consent(url: string, handle: (request: Request) => Promise<Response> = fake.handle): Promise<URL> {
  const response = await handle(new Request(url));
  const location = response.headers.get("location");
  if (response.status !== 302 || !location) throw new Error(`autorização sem redirecionamento: ${response.status}`);
  return new URL(location);
}

async function roundTrip(provider: OidcProvider, redirectUri = REDIRECT) {
  const started = await provider.start({ redirectUri, intent: "signin", next: null });
  const callbackUrl = await consent(started.url);
  return provider.complete({ redirectUri, callbackUrl, flow: started.flow });
}

beforeEach(() => fake.reset());

describe("falhas viram valor", () => {
  it("UT-040 retorno com ?error=access_denied é cancelamento, sem consultar o provedor", async () => {
    let calls = 0;
    const provider = googleProvider(settings("google"), {
      fetchImpl: async (...args) => {
        calls += 1;
        return fake.fetch(...args);
      },
    });
    const started = await provider.start({ redirectUri: REDIRECT, intent: "signin", next: null });
    calls = 0;
    const callbackUrl = new URL(`${REDIRECT}?error=access_denied&state=${started.flow.state}`);
    await expect(provider.complete({ redirectUri: REDIRECT, callbackUrl, flow: started.flow })).resolves.toEqual({
      ok: false,
      reason: "cancelled",
    });
    expect(calls).toBe(0);

    // A recusa vinda do emissor falso, pelo caminho inteiro, também.
    fake.setBehavior("google", { mode: "cancel" });
    await expect(roundTrip(provider)).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("UT-041 endpoint de token respondendo 500 é erro do provedor", async () => {
    fake.setBehavior("google", { mode: "error" });
    const provider = googleProvider(settings("google"), { fetchImpl: fake.fetch });
    await expect(roundTrip(provider)).resolves.toEqual({ ok: false, reason: "provider_error" });
  });

  it("UT-042 descoberta que não responde é erro do provedor no retorno, e exceção no início", async () => {
    const provider = googleProvider(settings("google"), { fetchImpl: fake.fetch });
    const started = await provider.start({ redirectUri: REDIRECT, intent: "signin", next: null });
    const callbackUrl = await consent(started.url);

    const offline = googleProvider(settings("google"), {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.complete({ redirectUri: REDIRECT, callbackUrl, flow: started.flow })).resolves.toEqual({
      ok: false,
      reason: "provider_error",
    });
    // No início não há cookie a proteger: quem chama recebe a exceção e
    // responde "não conseguimos falar com o Google".
    await expect(offline.start({ redirectUri: REDIRECT, intent: "signin", next: null })).rejects.toThrow();
  });

  it.each([
    ["UT-043", "assinado por chave fora do JWKS", "foreign-key"],
    ["UT-044", "com `aud` de outro cliente", "aud"],
    ["UT-045", "com `nonce` errado", "nonce"],
  ])("%s ID token %s é resposta inválida", async (_id, _label, tamper) => {
    fake.setBehavior("google", { tamper });
    const provider = googleProvider(settings("google"), { fetchImpl: fake.fetch });
    await expect(roundTrip(provider)).resolves.toEqual({ ok: false, reason: "invalid_response" });
  });
});

describe("o que sai do token", () => {
  it("UT-046 afirmações do Google viram só sujeito, e-mail e verificação", async () => {
    fake.setBehavior("google", { sub: "1", email: "a@x.com", emailVerified: true });
    const provider = googleProvider(settings("google"), { fetchImpl: fake.fetch });
    const result = await roundTrip(provider);
    expect(result).toEqual({
      ok: true,
      identity: { provider: "google", subject: "1", email: "a@x.com", emailVerified: true },
    });
  });

  it("UT-047 LinkedIn sem `email_verified` é não verificado; escopos exatamente `openid profile email`", async () => {
    fake.setBehavior("linkedin", { sub: "li-9", email: "Ana@X.com", emailVerified: undefined });
    const provider = linkedinProvider(settings("linkedin"), { fetchImpl: fake.fetch });
    const redirectUri = "http://127.0.0.1:3000/login/oauth/linkedin/callback";
    const started = await provider.start({ redirectUri, intent: "signin", next: "/jobs/1" });

    const scope = new URL(started.url).searchParams.get("scope");
    expect(scope).toBe("openid profile email");
    expect(scope).toBe(LINKEDIN_SCOPES);
    expect(scope).not.toContain("w_member_social");
    // PKCE S256, `state` e `nonce` sempre presentes.
    const params = new URL(started.url).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("state")).toBe(started.flow.state);
    expect(params.get("nonce")).toBe(started.flow.nonce);
    expect(started.flow).toMatchObject({ provider: "linkedin", intent: "signin", next: "/jobs/1" });

    const callbackUrl = await consent(started.url);
    await expect(provider.complete({ redirectUri, callbackUrl, flow: started.flow })).resolves.toEqual({
      ok: true,
      identity: { provider: "linkedin", subject: "li-9", email: "ana@x.com", emailVerified: false },
    });
  });

  it("UT-047 `email_verified` em texto 'true' conta; qualquer outro valor não", async () => {
    const provider = linkedinProvider(settings("linkedin"), { fetchImpl: fake.fetch });
    fake.setBehavior("linkedin", { emailVerified: "true" });
    const yes = await roundTrip(provider, "http://127.0.0.1:3000/login/oauth/linkedin/callback");
    expect(yes.ok && yes.identity.emailVerified).toBe(true);
    fake.setBehavior("linkedin", { emailVerified: "sim" });
    const no = await roundTrip(provider, "http://127.0.0.1:3000/login/oauth/linkedin/callback");
    expect(no.ok && no.identity.emailVerified).toBe(false);
  });
});

describe("IT-105 desvio de emissor ignorado em produção", () => {
  it("com JHO_ENV=production, JHO_OIDC_ISSUER_GOOGLE não muda o emissor composto", async () => {
    const asked: string[] = [];
    const recording: typeof fetch = async (input) => {
      asked.push(String(input));
      throw new TypeError("sem rede no teste");
    };
    const env = {
      JHO_ENV: "production",
      JHO_PUBLIC_URL: "https://jobs.mastertimm.com.br",
      GOOGLE_OIDC_CLIENT_ID: "id",
      GOOGLE_OIDC_CLIENT_SECRET: "segredo",
      JHO_OIDC_ISSUER_GOOGLE: "http://127.0.0.1:9",
    };
    const provider = configuredOidcProvider("google", env, { fetchImpl: recording });
    expect(provider).not.toBeNull();
    await expect(provider!.start({ redirectUri: REDIRECT, intent: "signin", next: null })).rejects.toThrow();
    expect(asked).toEqual(["https://accounts.google.com/.well-known/openid-configuration"]);

    // E no ambiente do E2E o mesmo desvio vale.
    asked.length = 0;
    const e2e = configuredOidcProvider("google", { ...env, JHO_ENV: "e2e" }, { fetchImpl: recording });
    await expect(e2e!.start({ redirectUri: REDIRECT, intent: "signin", next: null })).rejects.toThrow();
    expect(asked).toEqual(["http://127.0.0.1:9/.well-known/openid-configuration"]);
  });

  it("sem credencial não há adapter", () => {
    expect(configuredOidcProvider("linkedin", { JHO_ENV: "e2e" })).toBeNull();
  });
});

describe("IT-100 adapter do Google contra o emissor falso em loopback", () => {
  let server: Awaited<ReturnType<typeof startFakeOidc>>;
  beforeAll(async () => {
    server = await startFakeOidc();
  });
  afterAll(async () => {
    await server.close();
  });

  it("conclui o fluxo pela rede e valida um ID token assinado de verdade", async () => {
    server.setBehavior("google", { sub: "loop-1", email: "loop@x.com", emailVerified: true });
    const provider = googleProvider({
      clientId: FAKE_CLIENTS.google.id,
      clientSecret: FAKE_CLIENTS.google.secret,
      issuer: server.issuer("google"),
      issuerOverridden: true,
    });
    const started = await provider.start({ redirectUri: REDIRECT, intent: "signin", next: null });
    expect(started.url.startsWith(`${server.url}/google/authorize?`)).toBe(true);
    const authorize = await fetch(started.url, { redirect: "manual" });
    const callbackUrl = new URL(authorize.headers.get("location")!);
    await expect(provider.complete({ redirectUri: REDIRECT, callbackUrl, flow: started.flow })).resolves.toEqual({
      ok: true,
      identity: { provider: "google", subject: "loop-1", email: "loop@x.com", emailVerified: true },
    });
    // O código vale uma vez no emissor: repetir a troca é recusado pelo provedor.
    await expect(provider.complete({ redirectUri: REDIRECT, callbackUrl, flow: started.flow })).resolves.toEqual({
      ok: false,
      reason: "provider_error",
    });
  });

  it("sem o desvio aceito, HTTP sem TLS é recusado", async () => {
    const provider = googleProvider({
      clientId: FAKE_CLIENTS.google.id,
      clientSecret: FAKE_CLIENTS.google.secret,
      issuer: server.issuer("google"),
      issuerOverridden: false,
    });
    await expect(provider.start({ redirectUri: REDIRECT, intent: "signin", next: null })).rejects.toThrow();
  });
});
