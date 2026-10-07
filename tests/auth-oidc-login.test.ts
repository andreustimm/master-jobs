/**
 * Suíte: login social de ponta a ponta no servidor (#464, US-001–US-003).
 *
 * Invariante: a identidade ligada entra; e-mail verificado igual liga sozinho
 * uma vez só; recusas não criam nada nem revelam conta; o retorno vale uma vez;
 * a janela de tentativas é a mesma da senha.
 * Fronteira DENTRO: `beginSocial`/`finishSocial` com o adapter de verdade
 * (`oauth4webapi`) falando com o emissor falso por `fetch` injetado, o cookie
 * cifrado de verdade e o PostgreSQL com as migrações (`useTestDb`).
 * Fronteira FORA: as rotas do Next (cobertas em `login-oauth-routes.test.ts`)
 * e o navegador (E2E `social-sign-in`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authIdentity, authSession, authSignup, authUser, candidate } from "../src/core/db/schema.ts";
import { clock } from "../src/core/clock.ts";
import { beginSocial, finishSocial, type SocialConfig, type SocialDeps } from "../src/contexts/auth/app/oidc-login.ts";
import * as identities from "../src/contexts/auth/infra/drizzle-identities.ts";
import { createSocialSignup, signupIpHmac, signupTokenHash } from "../src/contexts/auth/infra/drizzle-signups.ts";
import { drizzleAuthRepository, drizzleSessions } from "../src/contexts/auth/infra/drizzle-store.ts";
import { checkCallbackState, flowKey, openFlow, sealFlow } from "../src/contexts/auth/infra/flow-cookie.ts";
import { googleProvider } from "../src/contexts/auth/infra/oidc/google.ts";
import { linkedinProvider } from "../src/contexts/auth/infra/oidc/linkedin.ts";
import { MAX_ATTEMPTS, recentFailures, setPassword, verifyLogin } from "../src/contexts/auth/infra/password-login.ts";
import { fileMailer } from "../src/contexts/auth/infra/resend-mailer.ts";
import type { Session } from "../src/contexts/auth/domain/types.ts";
import { createFakeOidc, FAKE_CLIENTS } from "./e2e/fake-oidc.mjs";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let sink: string;
let offsetMs = 0;
const fake = createFakeOidc();
const key = flowKey("segredo-de-teste-com-mais-de-32-caracteres");
const now = () => new Date(clock().now() + offsetMs);
const ORIGIN = "http://127.0.0.1:3000";
const IP = "203.0.113.9";

function adapter(id: "google" | "linkedin") {
  const settings = {
    clientId: FAKE_CLIENTS[id].id,
    clientSecret: FAKE_CLIENTS[id].secret,
    issuer: fake.issuer(id),
    issuerOverridden: true,
  };
  return id === "google"
    ? googleProvider(settings, { fetchImpl: fake.fetch, now })
    : linkedinProvider(settings, { fetchImpl: fake.fetch, now });
}

const config: SocialConfig = {
  available: ["google", "linkedin"],
  origin: ORIGIN,
  provider: adapter,
  sealFlow: (flow) => sealFlow(flow, key),
  readFlow: (sealed, state) => {
    const check = checkCallbackState(openFlow(sealed, key, now()), state);
    return check.ok ? check.flow : null;
  },
  signupIpSecret: "segredo-do-ip",
};

function deps(): SocialDeps {
  return {
    sessions: drizzleSessions,
    repository: drizzleAuthRepository,
    identities,
    signups: { createSocialSignup, ipHmac: signupIpHmac },
    attempts: { recentFailures, max: MAX_ATTEMPTS },
    mailer: () => fileMailer(sink),
    now,
  };
}

beforeEach(async () => {
  db = await useTestDb();
  sink = mkdtempSync(join(tmpdir(), "jho-oidc-sink-"));
  offsetMs = 0;
  fake.reset();
});

afterEach(async () => {
  rmSync(sink, { recursive: true, force: true });
  await releaseTestDb();
});

async function seedUser(
  email: string,
  options: { roles?: string[]; disabled?: boolean; candidate?: boolean; password?: string } = {},
): Promise<number> {
  const roles = options.roles ?? ["candidate"];
  let candidateId: number | null = null;
  if (options.candidate ?? roles.includes("candidate")) {
    const [row] = await db
      .insert(candidate)
      .values({ slug: `c-${email.replace(/[^a-z0-9]/g, "-")}`, name: email })
      .returning({ id: candidate.id });
    candidateId = row!.id;
  }
  const [user] = await db
    .insert(authUser)
    .values({ email, roles, candidateId, disabledAt: options.disabled ? "2026-01-01T00:00:00.000Z" : null })
    .returning({ id: authUser.id });
  if (options.password) await setPassword(email, options.password);
  return user!.id;
}

async function linkSeed(userId: number, provider: "google" | "linkedin", subject: string) {
  await db.insert(authIdentity).values({ userId, provider, subject, origin: "manual", emailAtLink: null });
}

type Behavior = { sub?: string; email?: string | null; emailVerified?: boolean | string | undefined; mode?: string };

/** O navegador inteiro: início, consentimento no emissor falso e retorno. */
async function signInVia(
  provider: "google" | "linkedin",
  behavior: Behavior,
  options: { next?: string | null; session?: Session | null; intent?: "signin" | "link" } = {},
) {
  fake.setBehavior(provider, behavior);
  const prepared = await prepare(provider, options);
  return prepared.finish();
}

async function prepare(
  provider: "google" | "linkedin",
  options: { next?: string | null; session?: Session | null; intent?: "signin" | "link" } = {},
) {
  const start = await beginSocial(
    { provider, intent: options.intent ?? "signin", next: options.next ?? null, session: options.session ?? null },
    config,
    deps(),
  );
  if (start.kind !== "provider") throw new Error(`início recusado: ${JSON.stringify(start)}`);
  const authorize = await fake.handle(new Request(start.location));
  const callbackUrl = new URL(authorize.headers.get("location")!);
  return {
    callbackUrl,
    sealedFlow: start.sealedFlow,
    finish: () =>
      finishSocial(
        {
          provider,
          callbackUrl,
          sealedFlow: start.sealedFlow,
          session: options.session ?? null,
          clientIp: IP,
          locale: "pt-BR",
        },
        config,
        deps(),
      ),
  };
}

async function events(kind: string) {
  return db.select().from(authEvent).where(eq(authEvent.kind, kind));
}

const sinkMails = () =>
  readdirSync(sink)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as { to: string; subject: string; text: string });

describe("identidade já ligada (US-001)", () => {
  it("IT-001 entra pela identidade: sessão criada e evento oidc_signin", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    const result = await signInVia("google", { sub: "g-ana", email: "ana@x.com" });

    expect(result).toMatchObject({ kind: "session", location: "/" });
    const sessions = await db.select().from(authSession).where(eq(authSession.userId, ana));
    expect(sessions).toHaveLength(1);
    const resolved = await drizzleSessions.resolve((result as { token: string }).token);
    expect(resolved?.userId).toBe(ana);
    const signins = await events("oidc_signin");
    expect(signins).toHaveLength(1);
    expect(signins[0]).toMatchObject({ userId: ana, email: "ana@x.com", detail: "google" });
  });

  it("IT-001 recrutador entra pelo LinkedIn e cai em Vagas", async () => {
    const rec = await seedUser("rec@x.com", { roles: ["recruiter"] });
    await linkSeed(rec, "linkedin", "li-rec");
    await expect(signInVia("linkedin", { sub: "li-rec", email: "rec@x.com" })).resolves.toMatchObject({
      kind: "session",
      location: "/jobs",
    });
  });

  it("IT-002 e-mail trocado no provedor, mesma identidade: mesma conta", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    // Outra conta com o e-mail novo não muda nada: a identidade decide.
    await seedUser("ana.nova@y.com");
    const result = await signInVia("google", { sub: "g-ana", email: "ana.nova@y.com", emailVerified: false });
    expect(result.kind).toBe("session");
    const resolved = await drizzleSessions.resolve((result as { token: string }).token);
    expect(resolved?.userId).toBe(ana);
  });

  it("IT-003 o login atualiza o último uso da identidade", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    const [before] = await db.select().from(authIdentity).where(eq(authIdentity.userId, ana));
    expect(before!.lastUsedAt).toBeNull();
    await signInVia("google", { sub: "g-ana" });
    const [after] = await db.select().from(authIdentity).where(eq(authIdentity.userId, ana));
    expect(after!.lastUsedAt).not.toBeNull();
    expect(Date.parse(after!.lastUsedAt!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("IT-004 conta desabilitada, ligada ou pelo e-mail: sem sessão, sem vínculo, oidc_failed refused", async () => {
    const linked = await seedUser("off@x.com", { disabled: true });
    await linkSeed(linked, "google", "g-off");
    const viaLink = await signInVia("google", { sub: "g-off", email: "off@x.com" });
    expect(viaLink).toEqual({ kind: "redirect", location: "/login?error=refused&provider=google" });

    const byEmail = await seedUser("off2@x.com", { disabled: true });
    const viaEmail = await signInVia("google", { sub: "g-off2", email: "off2@x.com" });
    expect(viaEmail).toEqual(viaLink);

    expect(await db.select().from(authSession)).toHaveLength(0);
    expect(await db.select().from(authIdentity).where(eq(authIdentity.userId, byEmail))).toHaveLength(0);
    const failed = await events("oidc_failed");
    expect(failed.map((event) => event.detail)).toEqual(["google: refused", "google: refused"]);
    const [user] = await db.select().from(authUser).where(eq(authUser.id, byEmail));
    expect(user!.disabledAt).not.toBeNull();
  });
});

describe("retorno vale uma vez (US-001.EC-4, EC-5)", () => {
  it("IT-005 cookie do fluxo vencido: sem sessão, oidc_failed expired", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    fake.setBehavior("google", { sub: "g-ana" });
    const prepared = await prepare("google");
    offsetMs = 10 * 60_000 + 1_000;
    await expect(prepared.finish()).resolves.toEqual({
      kind: "redirect",
      location: "/login?error=expired&provider=google",
    });
    expect(await db.select().from(authSession)).toHaveLength(0);
    expect((await events("oidc_failed")).map((event) => event.detail)).toEqual(["google: expired"]);
  });

  it("IT-005 cookie adulterado ou ausente também expira", async () => {
    fake.setBehavior("google", { sub: "g-ana" });
    const prepared = await prepare("google");
    const base = { provider: "google", callbackUrl: prepared.callbackUrl, session: null, clientIp: IP, locale: "pt-BR" as const };
    const middle = 20;
    const flipped = prepared.sealedFlow[middle] === "A" ? "B" : "A";
    const tampered = `${prepared.sealedFlow.slice(0, middle)}${flipped}${prepared.sealedFlow.slice(middle + 1)}`;
    for (const sealedFlow of [tampered, null]) {
      await expect(finishSocial({ ...base, sealedFlow }, config, deps())).resolves.toEqual({
        kind: "redirect",
        location: "/login?error=expired&provider=google",
      });
    }
  });

  it("IT-006 dois retornos com o mesmo fluxo: o primeiro entra, o segundo expira", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    fake.setBehavior("google", { sub: "g-ana" });
    const prepared = await prepare("google");
    const [first, second] = await Promise.all([prepared.finish(), prepared.finish()]);
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["redirect", "session"]);
    const refused = first.kind === "redirect" ? first : second;
    expect(refused).toEqual({ kind: "redirect", location: "/login?error=expired&provider=google" });
    expect(await db.select().from(authSession)).toHaveLength(1);
  });
});

describe("janela de tentativas compartilhada (US-001.EC-7)", () => {
  it("IT-007 falhas de senha bloqueiam o login social, e recusas sociais bloqueiam a senha", async () => {
    const ana = await seedUser("ana@x.com", { password: "senha-certa-da-ana" });
    await linkSeed(ana, "google", "g-ana");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await verifyLogin("ana@x.com", "senha-errada-123");
    await expect(signInVia("google", { sub: "g-ana", email: "ana@x.com" })).resolves.toEqual({
      kind: "redirect",
      location: "/login?error=rate_limited&provider=google",
    });
    expect(await db.select().from(authSession)).toHaveLength(0);

    // O contrário: conflitos repetidos para a conta da Bia gastam a mesma janela.
    const bia = await seedUser("bia@x.com", { password: "senha-certa-da-bia" });
    await linkSeed(bia, "google", "g-bia-A");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await expect(signInVia("google", { sub: "g-bia-B", email: "bia@x.com" })).resolves.toMatchObject({
        location: "/login?error=conflict&provider=google",
      });
    }
    expect(await recentFailures("bia@x.com")).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
    await expect(verifyLogin("bia@x.com", "senha-certa-da-bia")).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("vínculo automático (US-002)", () => {
  it("IT-008 conta sem Google e e-mail verificado igual: identidade automatic e sessão", async () => {
    const ana = await seedUser("ana@x.com");
    const result = await signInVia("google", { sub: "g-ana", email: " Ana@X.com ", emailVerified: true });
    expect(result).toMatchObject({ kind: "session", location: "/" });
    const rows = await db.select().from(authIdentity).where(eq(authIdentity.userId, ana));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "google", subject: "g-ana", origin: "automatic", emailAtLink: "ana@x.com" });
    expect(rows[0]!.lastUsedAt).not.toBeNull();
    const signin = await events("oidc_signin");
    expect(signin[0]!.detail).toBe("google (vínculo automático)");
  });

  it("IT-009 o vínculo automático registra identity_linked e manda o aviso", async () => {
    const ana = await seedUser("ana@x.com");
    await signInVia("google", { sub: "g-ana", email: "ana@x.com" });
    const linked = await events("identity_linked");
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ userId: ana, email: "ana@x.com", detail: "google: automatic" });
    const mails = sinkMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("ana@x.com");
    expect(mails[0]!.subject).toContain("Google");
    // O aviso não traz token, sujeito nem e-mail do provedor.
    expect(mails[0]!.text).not.toContain("g-ana");
  });

  it("IT-010 conta ligada ao sujeito A, login com o sujeito B do mesmo e-mail: conflito, nada muda", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-A");
    const result = await signInVia("google", { sub: "g-B", email: "ana@x.com" });
    expect(result).toEqual({ kind: "redirect", location: "/login?error=conflict&provider=google" });
    const rows = await db.select().from(authIdentity);
    expect(rows.map((row) => row.subject)).toEqual(["g-A"]);
    expect(await db.select().from(authSession)).toHaveLength(0);
  });

  it("IT-011 dois vínculos automáticos simultâneos: uma linha só, e cada tentativa entra ou expira", async () => {
    const ana = await seedUser("ana@x.com");
    fake.setBehavior("google", { sub: "g-ana", email: "ana@x.com" });
    const [one, two] = await Promise.all([prepare("google"), prepare("google")]);
    const results = await Promise.all([one.finish(), two.finish()]);
    const rows = await db.select().from(authIdentity).where(eq(authIdentity.userId, ana));
    expect(rows).toHaveLength(1);
    for (const result of results) {
      expect(
        result.kind === "session" ||
          (result.kind === "redirect" && result.location === "/login?error=expired&provider=google"),
      ).toBe(true);
    }
    expect(results.some((result) => result.kind === "session")).toBe(true);
    expect(await events("identity_linked")).toHaveLength(1);
  });

  it("IT-012 depois do vínculo automático a senha continua valendo", async () => {
    await seedUser("ana@x.com", { password: "senha-certa-da-ana" });
    await signInVia("google", { sub: "g-ana", email: "ana@x.com" });
    const login = await verifyLogin("ana@x.com", "senha-certa-da-ana");
    expect(login.ok).toBe(true);
  });

  it("IT-055 conta admin liga sozinha, entra e mantém os papéis", async () => {
    const admin = await seedUser("admin@x.com", { roles: ["admin"] });
    const result = await signInVia("google", { sub: "g-admin", email: "admin@x.com" });
    expect(result).toMatchObject({ kind: "session", location: "/jobs" });
    const session = await drizzleSessions.resolve((result as { token: string }).token);
    expect(session).toMatchObject({ userId: admin, roles: ["admin"], impersonatedBy: null });
    const [user] = await db.select().from(authUser).where(eq(authUser.id, admin));
    expect(user!.roles).toEqual(["admin"]);
  });
});

describe("e-mail não verificado (US-003)", () => {
  it("IT-013 resposta idêntica com e sem conta; nada criado; repetir não muda nada", async () => {
    await seedUser("ana@x.com");
    const usersBefore = await db.select().from(authUser);
    const withAccount = await signInVia("linkedin", { sub: "li-1", email: "ana@x.com", emailVerified: false });
    const withoutAccount = await signInVia("linkedin", { sub: "li-2", email: "ninguem@x.com", emailVerified: false });
    const again = await signInVia("linkedin", { sub: "li-1", email: "ana@x.com", emailVerified: false });
    const noEmail = await signInVia("linkedin", { sub: "li-3", email: null, emailVerified: undefined });

    const expected = { kind: "redirect", location: "/login?error=unverified&provider=linkedin" };
    expect(withAccount).toEqual(expected);
    expect(withoutAccount).toEqual(expected);
    expect(again).toEqual(expected);
    expect(noEmail).toEqual(expected);
    expect(await db.select().from(authUser)).toEqual(usersBefore);
    expect(await db.select().from(authIdentity)).toHaveLength(0);
    expect(await db.select().from(authSignup)).toHaveLength(0);
    expect(await db.select().from(authSession)).toHaveLength(0);
  });
});

describe("pendência de cadastro social (US-004, requisito 4 da task_02)", () => {
  it("e-mail verificado sem conta grava auth_signup(kind=social) e manda a /signup, sem criar conta", async () => {
    const result = await signInVia("google", { sub: "g-nova", email: "Nova@X.com" });
    expect(result).toMatchObject({ kind: "signup", location: "/signup" });
    const token = (result as { token: string }).token;
    const [pending] = await db.select().from(authSignup);
    expect(pending).toMatchObject({
      kind: "social",
      email: "nova@x.com",
      provider: "google",
      subject: "g-nova",
      locale: "pt-BR",
      tokenHash: signupTokenHash(token),
      completedAt: null,
      userId: null,
    });
    // IP só em HMAC; o token só em hash.
    expect(pending!.ipHmac).toBe(signupIpHmac(IP, "segredo-do-ip"));
    expect(JSON.stringify(pending)).not.toContain(IP);
    expect(JSON.stringify(pending)).not.toContain(token);
    expect(Date.parse(pending!.expiresAt) - Date.parse(pending!.createdAt)).toBe(15 * 60_000);
    expect(await db.select().from(authUser)).toHaveLength(0);
    expect(await events("signup_started")).toHaveLength(1);
  });

  it("sem JHO_SIGNUP_IP_SECRET o cadastro fica fechado e nada é gravado", async () => {
    const closed = { ...config, signupIpSecret: null };
    fake.setBehavior("google", { sub: "g-nova", email: "nova@x.com" });
    const start = await beginSocial({ provider: "google", intent: "signin", next: null, session: null }, closed, deps());
    if (start.kind !== "provider") throw new Error("início recusado");
    const callbackUrl = new URL((await fake.handle(new Request(start.location))).headers.get("location")!);
    await expect(
      finishSocial(
        { provider: "google", callbackUrl, sealedFlow: start.sealedFlow, session: null, clientIp: IP, locale: "pt-BR" },
        closed,
        deps(),
      ),
    ).resolves.toEqual({ kind: "redirect", location: "/login?error=unavailable&provider=google" });
    expect(await db.select().from(authSignup)).toHaveLength(0);
  });
});

describe("início do fluxo (US-001.EC-8, US-014)", () => {
  it("o `next` relativo viaja no fluxo e decide o destino; absoluto é descartado", async () => {
    const ana = await seedUser("ana@x.com");
    await linkSeed(ana, "google", "g-ana");
    await expect(signInVia("google", { sub: "g-ana" }, { next: "/jobs/12" })).resolves.toMatchObject({
      kind: "session",
      location: "/jobs/12",
    });
    await expect(signInVia("google", { sub: "g-ana" }, { next: "https://evil.test/x" })).resolves.toMatchObject({
      kind: "session",
      location: "/",
    });
  });

  it("provedor fora da lista do ambiente recusa no início e no retorno; nome desconhecido é 404", async () => {
    const off = { ...config, available: ["linkedin"] as const };
    await expect(
      beginSocial({ provider: "google", intent: "signin", next: null, session: null }, off, deps()),
    ).resolves.toEqual({ kind: "redirect", location: "/login?error=unavailable&provider=google" });
    await expect(
      beginSocial({ provider: "github", intent: "signin", next: null, session: null }, config, deps()),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(
      finishSocial(
        { provider: "google", callbackUrl: new URL(`${ORIGIN}/x?state=s&code=c`), sealedFlow: null, session: null, clientIp: IP, locale: "pt-BR" },
        off,
        deps(),
      ),
    ).resolves.toEqual({ kind: "redirect", location: "/login?error=unavailable&provider=google" });
  });

  it("provedor fora do ar no início volta com 'não conseguimos falar com o provedor'", async () => {
    const offline: SocialConfig = {
      ...config,
      provider: (id) =>
        googleProvider(
          { clientId: FAKE_CLIENTS[id].id, clientSecret: "x", issuer: fake.issuer(id), issuerOverridden: true },
          { fetchImpl: async () => { throw new TypeError("fetch failed"); } },
        ),
    };
    await expect(
      beginSocial({ provider: "google", intent: "signin", next: null, session: null }, offline, deps()),
    ).resolves.toEqual({ kind: "redirect", location: "/login?error=provider&provider=google" });
  });
});

describe("ligar pela conta (US-007, base para a task_04)", () => {
  async function sessionOf(userId: number, impersonatedBy: number | null = null): Promise<Session> {
    const token = await drizzleSessions.create({
      userId,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      impersonatedBy,
    });
    return (await drizzleSessions.resolve(token))!;
  }

  it("sessão própria liga com origem manual, mesmo sem e-mail verificado, e volta à conta", async () => {
    const ana = await seedUser("ana@x.com");
    const session = await sessionOf(ana);
    const result = await signInVia(
      "linkedin",
      { sub: "li-ana", email: "outra@y.com", emailVerified: false },
      { intent: "link", session },
    );
    expect(result).toEqual({ kind: "redirect", location: "/account?linked=linkedin" });
    const [row] = await db.select().from(authIdentity);
    expect(row).toMatchObject({ userId: ana, provider: "linkedin", origin: "manual" });
    const [user] = await db.select().from(authUser).where(eq(authUser.id, ana));
    expect(user!.email).toBe("ana@x.com");
  });

  it("sem sessão o início manda entrar; sessão emprestada não liga", async () => {
    await expect(
      beginSocial({ provider: "google", intent: "link", next: null, session: null }, config, deps()),
    ).resolves.toEqual({ kind: "redirect", location: "/login?next=%2Faccount" });

    const admin = await seedUser("admin@x.com", { roles: ["admin"] });
    const ana = await seedUser("ana@x.com");
    const borrowed = await sessionOf(ana, admin);
    await expect(
      beginSocial({ provider: "google", intent: "link", next: null, session: borrowed }, config, deps()),
    ).resolves.toEqual({ kind: "redirect", location: "/login?next=%2Faccount" });
    expect(await db.select().from(authIdentity)).toHaveLength(0);
  });
});
