/**
 * Suíte: as rotas GET do login social (#464, ADR-012).
 *
 * Invariante: fora de produção e local (ou sem credencial) o início volta a
 * `/login` com "não disponível aqui"; nome que não é provedor é 404; o retorno
 * responde 303 como `app/login/callback/route.ts`, inclusive a RSC fetch, e
 * apaga o cookie do fluxo em todo desfecho.
 * Fronteira DENTRO: os Route Handlers com `next/headers` dublado; no início, a
 * composição real de `startSocialSignIn` lendo o ambiente.
 * Fronteira FORA: o serviço do retorno (dublado aqui; coberto em
 * `auth-oidc-login.test.ts`) e o navegador.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  get: vi.fn((_name: string) => undefined as { value: string } | undefined),
  set: vi.fn(),
  delete: vi.fn(),
}));
const finish = vi.hoisted(() => ({ impl: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => jar),
  headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3210", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("../app/auth.ts", () => ({ SESSION_COOKIE: "jho_session", currentSession: vi.fn(async () => null) }));
vi.mock("../src/contexts/auth/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/contexts/auth/index.ts")>()),
  finishSocialSignIn: (...args: unknown[]) => finish.impl(...args),
}));

const start = await import("../app/login/oauth/[provider]/route.ts");
const callback = await import("../app/login/oauth/[provider]/callback/route.ts");

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });
const CONFIGURED = {
  GOOGLE_OIDC_CLIENT_ID: "id-google",
  GOOGLE_OIDC_CLIENT_SECRET: "segredo-google",
  JHO_SESSION_SECRET: "segredo-de-sessao-com-mais-de-32-caracteres",
  JHO_AUTH_MODE: "secure",
};

beforeEach(() => {
  jar.get.mockReset();
  jar.set.mockReset();
  jar.delete.mockReset();
  finish.impl.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubEnv(env: Record<string, string>) {
  for (const name of ["VERCEL", "VERCEL_ENV", "JHO_PUBLIC_URL", "JHO_ENV", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]) {
    vi.stubEnv(name, "");
  }
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

describe("IT-065 início indisponível", () => {
  it("JHO_ENV=preview com credenciais volta a /login com 'não disponível aqui', sem cookie", async () => {
    stubEnv({ ...CONFIGURED, JHO_ENV: "preview", JHO_PUBLIC_URL: "https://preview.example" });
    const response = await start.GET(new NextRequest("http://127.0.0.1:3210/login/oauth/google"), params("google"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=unavailable&provider=google");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("provedor sem credencial também recusa; nome que não é provedor é 404", async () => {
    stubEnv({ ...CONFIGURED, JHO_ENV: "production", JHO_PUBLIC_URL: "https://jobs.mastertimm.com.br" });
    const linkedin = await start.GET(new NextRequest("http://127.0.0.1:3210/login/oauth/linkedin"), params("linkedin"));
    expect(linkedin.status).toBe(303);
    expect(linkedin.headers.get("location")).toBe("/login?error=unavailable&provider=linkedin");

    const unknown = await start.GET(new NextRequest("http://127.0.0.1:3210/login/oauth/github"), params("github"));
    expect(unknown.status).toBe(404);
  });

  it("disponível, o início sai para o provedor com o cookie cifrado do fluxo", async () => {
    stubEnv({ ...CONFIGURED, JHO_ENV: "e2e", JHO_PUBLIC_URL: "http://127.0.0.1:3210" });
    const { createFakeOidc } = await import("./e2e/fake-oidc.mjs");
    const fake = createFakeOidc();
    vi.stubEnv("JHO_OIDC_ISSUER_GOOGLE", fake.issuer("google"));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fake.fetch as typeof fetch;
    try {
      const response = await start.GET(
        new NextRequest("http://127.0.0.1:3210/login/oauth/google?next=%2Fjobs%2F12"),
        params("google"),
      );
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location")!);
      expect(`${location.origin}${location.pathname}`).toBe(`${fake.issuer("google")}/authorize`);
      expect(location.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3210/login/oauth/google/callback");
      expect(jar.set).toHaveBeenCalledWith(
        "jho_oidc_flow",
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/login/oauth", maxAge: 600 }),
      );
      // O cookie é cifrado: nem o verificador PKCE nem o `next` aparecem nele.
      const sealed = jar.set.mock.calls[0]![1] as string;
      expect(sealed).not.toContain("jobs");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("IT-104 retorno responde 303 como o callback do link mágico", () => {
  it("navegação comum: Location relativo, cookie do fluxo apagado", async () => {
    finish.impl.mockResolvedValue({ kind: "redirect", location: "/login?error=expired&provider=google" });
    const response = await callback.GET(
      new NextRequest("http://127.0.0.1:3210/login/oauth/google/callback?state=s&code=c"),
      params("google"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=expired&provider=google");
    expect(jar.delete).toHaveBeenCalledWith({ name: "jho_oidc_flow", path: "/login/oauth" });
  });

  it("RSC fetch: deixa o App Router tratar como navegação interna", async () => {
    finish.impl.mockResolvedValue({ kind: "redirect", location: "/login?error=cancelled&provider=google" });
    const response = await callback.GET(
      new NextRequest("http://127.0.0.1:3210/login/oauth/google/callback?error=access_denied", {
        headers: { RSC: "1" },
      }),
      params("google"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3210/login?error=cancelled&provider=google");
  });

  it("sessão aberta grava o cookie de sessão httpOnly; pendência de cadastro grava o cookie de /signup", async () => {
    finish.impl.mockResolvedValue({
      kind: "session",
      location: "/jobs/12",
      token: "sessao-de-teste",
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    const session = await callback.GET(
      new NextRequest("http://127.0.0.1:3210/login/oauth/google/callback?state=s&code=c"),
      params("google"),
    );
    expect(session.headers.get("location")).toBe("/jobs/12");
    expect(jar.set).toHaveBeenCalledWith(
      "jho_session",
      "sessao-de-teste",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    // O retorno manda ao serviço o IP do cliente e o idioma, nunca o cookie de sessão cru.
    expect(finish.impl.mock.calls[0]![0]).toMatchObject({ provider: "google", clientIp: "203.0.113.9" });

    jar.set.mockReset();
    finish.impl.mockResolvedValue({
      kind: "signup",
      location: "/signup",
      token: "pendencia",
      expiresAt: "2026-11-01T00:15:00.000Z",
    });
    const signup = await callback.GET(
      new NextRequest("http://127.0.0.1:3210/login/oauth/google/callback?state=s&code=c"),
      params("google"),
    );
    expect(signup.headers.get("location")).toBe("/signup");
    expect(jar.set).toHaveBeenCalledWith(
      "jho_signup",
      "pendencia",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/signup" }),
    );
  });

  it("nome que não é provedor é 404 e não toca cookie", async () => {
    finish.impl.mockResolvedValue({ kind: "not_found" });
    const response = await callback.GET(
      new NextRequest("http://127.0.0.1:3210/login/oauth/github/callback"),
      params("github"),
    );
    expect(response.status).toBe(404);
    expect(jar.delete).not.toHaveBeenCalled();
  });
});
