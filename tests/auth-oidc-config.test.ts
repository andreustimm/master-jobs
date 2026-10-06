/**
 * Suíte: configuração do login social e do cadastro, lida do ambiente (#464).
 *
 * Fronteira DENTRO: `src/contexts/auth/domain/oidc-config.ts`, função pura
 * sobre o `env` recebido.
 * Fronteira FORA: rede, provedores reais e `process.env` — cada caso monta o
 * próprio ambiente, na forma que a Vercel e o `.env` local cadastram.
 */
import { describe, expect, it } from "vitest";
import {
  availableProviders,
  DEFAULT_ISSUERS,
  issuerFor,
  mailSinkDir,
  parseOidcConfig,
  parseSessionSecret,
  parseSignupLimits,
  socialAvailable,
} from "../src/contexts/auth/domain/oidc-config.ts";

type Env = Record<string, string | undefined>;

const SECRET = "s".repeat(40);
const GOOGLE = { GOOGLE_OIDC_CLIENT_ID: "google-client-id-123", GOOGLE_OIDC_CLIENT_SECRET: "google-secret-456" };
const LINKEDIN = { LINKEDIN_CLIENT_ID: "linkedin-client-id-789", LINKEDIN_CLIENT_SECRET: "linkedin-secret-000" };
const PRODUCTION = { JHO_ENV: "production", JHO_PUBLIC_URL: "https://jobs.mastertimm.com.br" };

describe("limite de cadastros por IP", () => {
  it("UT-001 aceita inteiro positivo e cai em 3 para vazio, zero, negativo, texto ou ausente", () => {
    expect(parseSignupLimits({ JHO_SIGNUP_MAX_PER_IP_HOUR: "7" })).toEqual({ maxPerIpHour: 7 });
    expect(parseSignupLimits({ JHO_SIGNUP_MAX_PER_IP_HOUR: " 7 " })).toEqual({ maxPerIpHour: 7 });
    for (const raw of ["", "0", "-1", "abc", "2.5", "1e3", "   "]) {
      expect(parseSignupLimits({ JHO_SIGNUP_MAX_PER_IP_HOUR: raw }), raw).toEqual({ maxPerIpHour: 3 });
    }
    expect(parseSignupLimits({})).toEqual({ maxPerIpHour: 3 });
  });
});

describe("provedores configurados", () => {
  it("UT-002 sem nenhuma variável de provedor, os dois ficam fora e nenhum botão aparece", () => {
    const env: Env = { ...PRODUCTION, JHO_SESSION_SECRET: SECRET };
    expect(parseOidcConfig(env)).toEqual({
      google: { status: "unconfigured" },
      linkedin: { status: "unconfigured" },
    });
    expect(availableProviders(env)).toEqual([]);
  });

  it("UT-003 só o Google configurado: Google entra com o emissor real, LinkedIn fica fora", () => {
    const env: Env = { ...PRODUCTION, JHO_SESSION_SECRET: SECRET, ...GOOGLE };
    const config = parseOidcConfig(env);
    expect(config.google).toEqual({
      status: "configured",
      settings: {
        clientId: GOOGLE.GOOGLE_OIDC_CLIENT_ID,
        clientSecret: GOOGLE.GOOGLE_OIDC_CLIENT_SECRET,
        issuer: DEFAULT_ISSUERS.google,
        issuerOverridden: false,
      },
    });
    expect(config.linkedin).toEqual({ status: "unconfigured" });
    expect(availableProviders(env)).toEqual(["google"]);
    expect(availableProviders({ ...env, ...LINKEDIN })).toEqual(["google", "linkedin"]);
  });

  it("UT-003 credencial pela metade é inválida e o motivo nomeia a variável, nunca o valor", () => {
    const config = parseOidcConfig({ GOOGLE_OIDC_CLIENT_ID: GOOGLE.GOOGLE_OIDC_CLIENT_ID, LINKEDIN_CLIENT_SECRET: "  " });
    expect(config.google).toEqual({ status: "invalid", reason: "falta GOOGLE_OIDC_CLIENT_SECRET" });
    expect(JSON.stringify(config)).not.toContain(GOOGLE.GOOGLE_OIDC_CLIENT_ID);
    // Só espaço conta como ausente (regra 17): o LinkedIn não está configurado.
    expect(config.linkedin).toEqual({ status: "unconfigured" });
    expect(
      parseOidcConfig({ LINKEDIN_CLIENT_SECRET: LINKEDIN.LINKEDIN_CLIENT_SECRET }).linkedin,
    ).toEqual({ status: "invalid", reason: "falta LINKEDIN_CLIENT_ID" });
  });

  it("UT-003 sem o segredo do cookie do fluxo, nenhum provedor é oferecido", () => {
    const env: Env = { ...PRODUCTION, ...GOOGLE };
    expect(availableProviders(env)).toEqual([]);
    expect(parseSessionSecret({ JHO_SESSION_SECRET: "curto" })).toEqual({
      status: "invalid",
      reason: "JHO_SESSION_SECRET precisa ter ao menos 32 caracteres",
    });
    expect(availableProviders({ ...env, JHO_SESSION_SECRET: "curto" })).toEqual([]);
  });
});

describe("ambientes em que o login social existe (ADR-005)", () => {
  it("UT-004 Preview com credenciais recusa; produção com origem fixa aceita; local aceita", () => {
    expect(socialAvailable({ JHO_ENV: "preview", VERCEL: "1", VERCEL_ENV: "preview", ...GOOGLE })).toBe(false);
    // Mesmo com JHO_PUBLIC_URL cadastrada por engano no Preview.
    expect(socialAvailable({ JHO_ENV: "preview", JHO_PUBLIC_URL: "https://x.vercel.app" })).toBe(false);
    expect(socialAvailable({ JHO_ENV: "staging", JHO_PUBLIC_URL: "https://x.test" })).toBe(false);

    expect(socialAvailable(PRODUCTION)).toBe(true);
    expect(socialAvailable({ JHO_ENV: "local" })).toBe(true);
    expect(availableProviders({ JHO_ENV: "preview", VERCEL: "1", VERCEL_ENV: "preview", JHO_SESSION_SECRET: SECRET, ...GOOGLE })).toEqual([]);
  });

  it("UT-004 na Vercel, só Production com origem resolvível; fora dela, só com JHO_PUBLIC_URL válida", () => {
    expect(socialAvailable({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "jobs.mastertimm.com.br" })).toBe(true);
    expect(socialAvailable({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    // `JHO_ENV=local` num deployment não o transforma em máquina local.
    expect(socialAvailable({ JHO_ENV: "local", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app" })).toBe(false);
    // Processo que não declara ambiente nem origem fixa: recusa (#378).
    expect(socialAvailable({})).toBe(false);
    expect(socialAvailable({ JHO_PUBLIC_URL: "javascript:alert(1)" })).toBe(false);
    // O E2E isolado declara só a origem fixa de loopback.
    expect(socialAvailable({ JHO_PUBLIC_URL: "http://127.0.0.1:3201" })).toBe(true);
  });
});

describe("desvios de teste nunca valem em produção", () => {
  it("UT-005 JHO_MAIL_SINK é ignorada em produção e na Vercel, e vale localmente", () => {
    expect(mailSinkDir({ JHO_MAIL_SINK: "/tmp/x", JHO_ENV: "production" })).toBeNull();
    expect(mailSinkDir({ JHO_MAIL_SINK: "/tmp/x", JHO_ENV: " Production " })).toBeNull();
    expect(mailSinkDir({ JHO_MAIL_SINK: "/tmp/x", VERCEL: "1", VERCEL_ENV: "preview" })).toBeNull();
    expect(mailSinkDir({ JHO_MAIL_SINK: "/tmp/x", JHO_ENV: "local" })).toBe("/tmp/x");
    expect(mailSinkDir({ JHO_MAIL_SINK: "/tmp/x" })).toBe("/tmp/x");
    expect(mailSinkDir({ JHO_MAIL_SINK: "  ", JHO_ENV: "local" })).toBeNull();
    expect(mailSinkDir({ JHO_ENV: "local" })).toBeNull();
  });

  it("UT-006 o emissor falso é ignorado em produção e o erro nomeia a variável, nunca o valor", () => {
    const fake = "http://127.0.0.1:9";
    expect(issuerFor("google", { JHO_OIDC_ISSUER_GOOGLE: fake, JHO_ENV: "production" })).toEqual({
      ok: true,
      issuer: "https://accounts.google.com",
      overridden: false,
    });
    expect(issuerFor("google", { JHO_OIDC_ISSUER_GOOGLE: fake, VERCEL: "1", VERCEL_ENV: "production" })).toEqual({
      ok: true,
      issuer: "https://accounts.google.com",
      overridden: false,
    });
    expect(issuerFor("linkedin", { JHO_OIDC_ISSUER_LINKEDIN: `${fake}/linkedin/`, JHO_ENV: "local" })).toEqual({
      ok: true,
      issuer: `${fake}/linkedin`,
      overridden: true,
    });

    const secretLooking = "ftp://user:pa55word@evil.test";
    const broken = issuerFor("google", { JHO_OIDC_ISSUER_GOOGLE: secretLooking, JHO_ENV: "local" });
    expect(broken).toEqual({ ok: false, reason: "JHO_OIDC_ISSUER_GOOGLE precisa ser uma URL http(s)" });
    const config = parseOidcConfig({ ...GOOGLE, JHO_OIDC_ISSUER_GOOGLE: secretLooking, JHO_ENV: "local" });
    expect(config.google.status).toBe("invalid");
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("pa55word");
    expect(serialized).not.toContain(GOOGLE.GOOGLE_OIDC_CLIENT_SECRET);
  });
});
