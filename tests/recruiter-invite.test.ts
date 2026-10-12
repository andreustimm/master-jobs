/**
 * Suíte: o convite de recrutador do link até o acesso (#465, task_03;
 * `_tests.md` IT-079 – IT-102, ADR-018).
 *
 * Invariante: o acesso só alcança o endereço que o candidato digitou, provado
 * pela conta de recrutador; link morto de qualquer tipo dá a mesma página; o
 * convite queima antes de a concessão nascer; o token cru vive só no cookie
 * `httpOnly` e no e-mail.
 * Fronteira DENTRO: a página `/signup/invite`, as actions dela, do cadastro e
 * do login por senha, `app/auth.ts` e `app/invite-arrival.ts` reais; a
 * composição de `src/contexts/auth/index.ts` com o PostgreSQL de teste; o
 * login social de verdade contra o emissor falso; o sink de e-mail em
 * diretório temporário.
 * Fronteira FORA: a borda do Next (cookie, cabeçalho, navegação, cache) e,
 * na renderização, os componentes de `@/components/ui`.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type HTMLAttributes, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVITE_COOKIE,
  SIGNUP_COOKIE,
  createUser,
  finishLogin,
  setPassword,
  setUserDisabled,
  startLogin,
  type Role,
} from "../src/contexts/auth/index.ts";
import {
  cancelInvite,
  completeInvitesForAccount,
  grantAccess,
  resendInvite,
  type RecruiterAccessDeps,
} from "../src/contexts/auth/app/recruiter-access.ts";
import { beginSocial, finishSocial, type SocialConfig, type SocialDeps } from "../src/contexts/auth/app/oidc-login.ts";
import * as identities from "../src/contexts/auth/infra/drizzle-identities.ts";
import { drizzleRecruiterAccess } from "../src/contexts/auth/infra/drizzle-recruiter-access.ts";
import { createSocialSignup, signupIpHmac } from "../src/contexts/auth/infra/drizzle-signups.ts";
import { drizzleAuthRepository, drizzleSessions, hashToken } from "../src/contexts/auth/infra/drizzle-store.ts";
import { checkCallbackState, flowKey, openFlow, sealFlow } from "../src/contexts/auth/infra/flow-cookie.ts";
import { googleProvider } from "../src/contexts/auth/infra/oidc/google.ts";
import { linkedinProvider } from "../src/contexts/auth/infra/oidc/linkedin.ts";
import { MAX_ATTEMPTS, recentFailures } from "../src/contexts/auth/infra/password-login.ts";
import { fileMailer } from "../src/contexts/auth/infra/resend-mailer.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import { clock, fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  authEvent,
  authSignup,
  authUser,
  candidate,
  recruiterAccessEvent,
  recruiterGrant,
  recruiterInvite,
} from "../src/core/db/schema.ts";
import { translator } from "../src/core/i18n/index.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import { createFakeOidc, FAKE_CLIENTS } from "./e2e/fake-oidc.mjs";
import { discoverEntries, exportedBindings, guardComesFirst, UNGUARDED_BY_DESIGN } from "./support/entry-inventory.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

type CookieSet = { name: string; value: string; options: Record<string, unknown> };

const boundary = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; options: Record<string, unknown> }[],
  deletes: [] as string[],
  ip: "203.0.113.10",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (boundary.jar.has(name) ? { name, value: boundary.jar.get(name) } : undefined),
    getAll: () => [...boundary.jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => boundary.jar.has(name),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      boundary.jar.set(name, value);
      boundary.sets.push({ name, value, options });
    },
    delete: (target: string | { name: string }) => {
      const name = typeof target === "string" ? target : target.name;
      boundary.jar.delete(name);
      boundary.deletes.push(name);
    },
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000", "x-forwarded-for": boundary.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("@/components/ui/card", () => {
  const box = (props: HTMLAttributes<HTMLElement>) => createElement("div", props);
  return { Card: box, CardContent: box, CardHeader: box, CardTitle: box };
});
vi.mock("@/components/ui/button", () => ({
  Button: (props: HTMLAttributes<HTMLElement> & { size?: string }) => {
    const { size: _size, ...rest } = props;
    return createElement("button", rest);
  },
  buttonVariants: () => "",
}));
vi.mock("../app/transition-link.tsx", () => ({
  TransitionLink: (props: HTMLAttributes<HTMLElement> & { href: string }) => createElement("a", props),
}));
vi.mock("../app/score-queue-drain", () => ({ scoreAfterResponse: () => {} }));

const { default: SignupInvitePage } = await import("../app/signup/invite/page.tsx");
const { startInvitedSignup, acceptInviteAction } = await import("../app/signup/invite/actions.ts");
const { completeSocialSignup, startManualSignup, confirmSignupCode } = await import("../app/signup/actions.ts");
const { passwordLoginAction } = await import("../app/login/actions.ts");

const t = translator("pt-BR").t;
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "senha-do-convite-de-teste-42";
const fake = createFakeOidc();
const key = flowKey("segredo-de-teste-com-mais-de-32-caracteres");

let db: DB;
let sink: string;
let time: ReturnType<typeof fixedClock>;
let seven: number;
let eight: number;
let ana: number;
let bruno: number;

/* -------------------------------- Ferramentas ------------------------------- */

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value));
  return data;
}

/** O desfecho de uma action: o destino do `redirect`, a mensagem do erro, ou o valor. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    const value = await run();
    return `valor:${JSON.stringify(value)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function accessDeps(over: Partial<RecruiterAccessDeps> = {}): RecruiterAccessDeps {
  return {
    store: drizzleRecruiterAccess,
    mailer: () => fileMailer(sink),
    audit: drizzleAuthRepository,
    now: () => clock().now(),
    origin: ORIGIN,
    newToken: () => {
      const token = randomBytes(32).toString("base64url");
      return { token, hash: hashToken(token) };
    },
    hashToken,
    ...over,
  };
}

/** O candidato convida pelo caso de uso de verdade; devolve o token que foi no e-mail. */
async function invite(
  email: string,
  over: { candidateId?: number; actorUserId?: number; endDate?: string; tz?: string } = {},
): Promise<string> {
  let token = "";
  const result = await grantAccess(
    {
      candidateId: over.candidateId ?? seven,
      actorUserId: over.actorUserId ?? ana,
      email,
      endDate: over.endDate ?? "",
      tz: over.tz ?? "",
    },
    accessDeps({
      newToken: () => {
        token = randomBytes(32).toString("base64url");
        return { token, hash: hashToken(token) };
      },
    }),
  );
  expect(result).toEqual({ ok: true, kind: "invite" });
  return token;
}

async function inviteRow(email: string, candidateId = seven) {
  const [row] = await db
    .select()
    .from(recruiterInvite)
    .where(and(eq(recruiterInvite.email, email), eq(recruiterInvite.candidateId, candidateId)))
    .orderBy(sql`${recruiterInvite.id} desc`)
    .limit(1);
  return row!;
}

async function grants() {
  return db.select().from(recruiterGrant).orderBy(recruiterGrant.id);
}

async function historyOf(candidateId = seven) {
  return db
    .select({ kind: recruiterAccessEvent.kind, actor: recruiterAccessEvent.actor })
    .from(recruiterAccessEvent)
    .where(eq(recruiterAccessEvent.candidateId, candidateId))
    .orderBy(recruiterAccessEvent.id);
}

async function userByEmail(email: string) {
  const [row] = await db.select().from(authUser).where(eq(authUser.email, email));
  return row ?? null;
}

type Mail = { to: string; subject: string; text: string };
const mails = (): Mail[] =>
  readdirSync(sink)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as Mail);
const grantedMails = (to: string) => mails().filter((mail) => mail.to === to && mail.subject.includes("deu acesso"));

async function account(
  email: string,
  roles: Role[],
  options: { verified?: boolean; disabled?: boolean; password?: boolean; candidateId?: number | null } = {},
): Promise<number> {
  const { id } = await createUser({ email, fullName: email, roles, candidateId: options.candidateId ?? null });
  await db
    .update(authUser)
    .set({
      emailVerifiedAt: options.verified === false ? null : "2026-01-01T00:00:00.000Z",
      disabledAt: options.disabled ? "2026-01-01T00:00:00.000Z" : null,
    })
    .where(eq(authUser.id, id));
  if (options.password) await setPassword(email, PASSWORD);
  return id;
}

/** Sessão aberta e posta no cookie deste "navegador". */
async function signedIn(email: string): Promise<void> {
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  boundary.jar.set("jho_session", result.token);
}

async function renderInvite(token: string | null): Promise<string> {
  const element = (await SignupInvitePage({ searchParams: Promise.resolve(token === null ? {} : { token }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";

/* --------------------- O retorno do provedor (emissor falso) --------------------- */

function adapter(id: "google" | "linkedin") {
  const settings = { clientId: FAKE_CLIENTS[id].id, clientSecret: FAKE_CLIENTS[id].secret, issuer: fake.issuer(id), issuerOverridden: true };
  const now = () => new Date(clock().now());
  return id === "google" ? googleProvider(settings, { fetchImpl: fake.fetch, now }) : linkedinProvider(settings, { fetchImpl: fake.fetch, now });
}

const socialConfig: SocialConfig = {
  available: ["google", "linkedin"],
  origin: ORIGIN,
  provider: adapter,
  sealFlow: (flow) => sealFlow(flow, key),
  readFlow: (sealed, state) => {
    const check = checkCallbackState(openFlow(sealed, key, new Date(clock().now())), state);
    return check.ok ? check.flow : null;
  },
  signupIpSecret: "segredo-do-ip-do-retorno",
};

function socialDeps(): SocialDeps {
  return {
    sessions: drizzleSessions,
    repository: drizzleAuthRepository,
    identities,
    signups: { createSocialSignup, ipHmac: signupIpHmac },
    attempts: { recentFailures, max: MAX_ATTEMPTS },
    mailer: () => fileMailer(sink),
    now: () => new Date(clock().now()),
  };
}

/** Início, consentimento no emissor falso e retorno: o que o navegador faz até voltar a `/signup`. */
async function viaProvider(
  provider: "google" | "linkedin",
  behavior: { sub: string; email: string; emailVerified?: boolean | undefined },
) {
  fake.setBehavior(provider, behavior);
  const start = await beginSocial({ provider, intent: "signin", next: null, session: null }, socialConfig, socialDeps());
  if (start.kind !== "provider") throw new Error(`início recusado: ${JSON.stringify(start)}`);
  const authorize = await fake.handle(new Request(start.location));
  return finishSocial(
    {
      provider,
      callbackUrl: new URL(authorize.headers.get("location")!),
      sealedFlow: start.sealedFlow,
      session: null,
      clientIp: boundary.ip,
      locale: "pt-BR",
    },
    socialConfig,
    socialDeps(),
  );
}

/** Cadastro social de recrutador pela tela: retorno do provedor e envio do formulário. */
async function socialSignup(email: string, sub = `sub-${email.trim()}`): Promise<string> {
  const back = await viaProvider("google", { sub, email });
  if (back.kind !== "signup") throw new Error(`retorno sem cadastro: ${JSON.stringify(back)}`);
  boundary.jar.set(SIGNUP_COOKIE, back.token);
  return outcome(() => completeSocialSignup(form({ role: "recruiter", name: "Bia Recrutadora", terms: "on" })));
}

/** Cadastro manual de recrutador pela tela: formulário, código do sink e confirmação. */
async function manualSignup(email: string): Promise<string> {
  const started = await outcome(() =>
    startManualSignup(form({ role: "recruiter", name: "Bia Manual", email, password: PASSWORD, terms: "on" })),
  );
  expect(started).toBe("NEXT_REDIRECT;/signup/verify");
  const normalized = email.trim().toLowerCase();
  const codeMail = mails().filter((mail) => mail.to === normalized && mail.subject === ptBR.email.codeSubject).at(-1);
  const code = /\b(\d{6})\b/.exec(codeMail?.text ?? "")?.[1] ?? "000000";
  return outcome(() => confirmSignupCode(form({ code })));
}

/** "Criar conta de recrutador" na página do convite: grava o cookie deste navegador. */
async function startFromLink(token: string): Promise<string> {
  return outcome(() => startInvitedSignup(form({ token })));
}

/** Abre as conexões do pool antes de uma corrida, para ela acontecer de fato. */
async function warmPool(): Promise<void> {
  await Promise.all([1, 2, 3].map(() => db.execute(sql`select pg_sleep(0.05)`)));
}

beforeAll(() => {
  process.env.JHO_SIGNUP_IP_SECRET = "segredo-do-ip-de-teste";
});

afterAll(() => {
  delete process.env.JHO_SIGNUP_IP_SECRET;
  delete process.env.JHO_MAIL_SINK;
});

beforeEach(async () => {
  db = await useTestDb();
  // Relógio parado no instante real: o código decide pelo `clock()`, e a
  // política confere a sessão contra `Date.now()`.
  time = fixedClock(new Date().toISOString());
  setClock(time);
  sink = mkdtempSync(join(tmpdir(), "jho-recruiter-invite-"));
  process.env.JHO_MAIL_SINK = sink;
  boundary.jar = new Map();
  boundary.sets = [];
  boundary.deletes = [];
  boundary.ip = `203.0.113.${10 + Math.floor(Math.random() * 200)}`;
  fake.reset();
  seven = await ensureCandidate({ slug: "ana", name: "Ana" });
  eight = await ensureCandidate({ slug: "bruno", name: "Bruno" });
  ana = (await createUser({ email: "ana@x.com", fullName: "Ana", roles: ["candidate"], candidateId: seven })).id;
  bruno = (await createUser({ email: "bruno@x.com", fullName: "Bruno", roles: ["candidate"], candidateId: eight })).id;
});

afterEach(async () => {
  resetClock();
  rmSync(sink, { recursive: true, force: true });
  await releaseTestDb();
});

/* ------------------------------ Página e cookie ------------------------------ */

describe("página do convite e cookie (IT-079 – IT-082)", () => {
  it("IT-079 link válido sem sessão: nome da candidata, endereço mascarado e os dois caminhos", async () => {
    const token = await invite("alice@x.com");
    const html = await renderInvite(token);
    expect(html).toContain('data-testid="invite-anonymous"');
    expect(html).toMatch(/data-testid="invite-candidate"[^>]*>Ana</);
    expect(html).toMatch(/data-testid="invite-expected-email"[^>]*>a•••@x\.com</);
    expect(html).toContain('data-testid="invite-create-account"');
    expect(html).toContain(t("recruiterInvite.createAccount"));
    expect(html).toContain('data-testid="invite-sign-in"');
    expect(html).toContain(t("recruiterInvite.haveAccount"));
    expect(html).not.toContain("alice@x.com");
  });

  it("IT-080 vencido, aceito, substituído, cancelado e token inventado: o mesmo <main>, byte a byte", async () => {
    const expired = await invite("vencido@y.com");
    await db.update(recruiterInvite).set({ expiresAt: new Date(time.now() - 1).toISOString() }).where(eq(recruiterInvite.email, "vencido@y.com"));

    const accepted = await invite("bia@y.com");
    const bia = await account("bia@y.com", ["recruiter"]);
    expect(await completeInvitesForAccount({ userId: bia, token: accepted }, accessDeps())).toEqual({ outcome: "completed", candidateId: seven });

    const superseded = await invite("caio@y.com");
    expect(await resendInvite({ inviteId: (await inviteRow("caio@y.com")).id, candidateId: seven, actorUserId: ana }, accessDeps())).toEqual({ ok: true });

    const cancelled = await invite("dani@y.com");
    expect(
      await cancelInvite({ inviteId: (await inviteRow("dani@y.com")).id, candidateId: seven, actor: "candidate", actorUserId: ana }, accessDeps()),
    ).toEqual({ ok: true });

    const random = randomBytes(32).toString("base64url");
    expect(random).toHaveLength(43);

    const bodies = await Promise.all([expired, accepted, superseded, cancelled, random, null].map(async (token) => mainOf(await renderInvite(token))));
    expect(bodies[0]).toContain('data-testid="invite-neutral"');
    expect(bodies[0]).toContain(t("recruiterInvite.neutralTitle"));
    expect(new Set(bodies).size).toBe(1);
  });

  it("IT-081 link válido de candidata desabilitada ou apagada: a página neutra", async () => {
    const neutral = mainOf(await renderInvite(null));
    const token = await invite("bia@y.com");
    await setUserDisabled(ana, true);
    expect(mainOf(await renderInvite(token))).toBe(neutral);

    const other = await invite("caio@y.com", { candidateId: eight, actorUserId: bruno });
    expect(mainOf(await renderInvite(other))).not.toBe(neutral);
    await db.delete(candidate).where(eq(candidate.id, eight));
    expect(mainOf(await renderInvite(other))).toBe(neutral);
  });

  it("IT-082 'Criar conta' grava jho_invite httpOnly, Lax, até o fim do link, e leva a /signup?role=recruiter; nada mais nasce", async () => {
    const token = await invite("bia@y.com");
    expect(await startFromLink(token)).toBe("NEXT_REDIRECT;/signup?role=recruiter");
    const cookie = boundary.sets.find((set: CookieSet) => set.name === INVITE_COOKIE)!;
    expect(cookie.value).toBe(token);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const remaining = (Date.parse((await inviteRow("bia@y.com")).expiresAt) - time.now()) / 1000;
    expect(cookie.options.maxAge).toBeGreaterThan(0);
    expect(cookie.options.maxAge as number).toBeLessThanOrEqual(remaining);

    expect(await userByEmail("bia@y.com")).toBeNull();
    expect(await grants()).toEqual([]);
    expect((await inviteRow("bia@y.com")).status).toBe("pending");

    // Link morto não grava cookie: volta à página neutra, sem o token.
    boundary.sets = [];
    expect(await startFromLink("x".repeat(43))).toBe("NEXT_REDIRECT;/signup/invite");
    expect(boundary.sets).toEqual([]);
  });
});

/* --------------------------- Conclusão no cadastro --------------------------- */

describe("conclusão no cadastro (IT-083 – IT-088)", () => {
  it("IT-083 cadastro social com o e-mail convidado e o cookie: convite queimado, concessão, histórico, e-mail e destino", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    expect(await socialSignup("bia@y.com")).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);

    const bia = (await userByEmail("bia@y.com"))!;
    expect(bia.roles).toEqual(["recruiter"]);
    const row = await inviteRow("bia@y.com");
    expect(row).toMatchObject({ status: "accepted", acceptedUserId: bia.id });
    expect(await grants()).toEqual([
      expect.objectContaining({ candidateId: seven, recruiterUserId: bia.id, status: "active", inviteId: row.id }),
    ]);
    expect((await historyOf()).map((event) => event.kind)).toEqual(["invite_sent", "invite_accepted", "grant_created"]);
    const granted = grantedMails("bia@y.com");
    expect(granted).toHaveLength(1);
    expect(granted[0]!.subject).toBe(ptBR.email.recruiterGrantedSubject.replace("{candidate}", "Ana"));
    expect(granted[0]!.text).toContain(`${ORIGIN}/recruiter/${seven}`);
    expect(boundary.deletes).toContain(INVITE_COOKIE);
    expect(boundary.jar.has(INVITE_COOKIE)).toBe(false);
  });

  it("IT-084 cadastro manual com o código confirmado e o cookie: o mesmo resultado", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    expect(await manualSignup("bia@y.com")).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);
    const bia = (await userByEmail("bia@y.com"))!;
    expect(bia.emailVerifiedAt).not.toBeNull();
    expect(await inviteRow("bia@y.com")).toMatchObject({ status: "accepted", acceptedUserId: bia.id });
    expect((await grants()).map((grant) => [grant.candidateId, grant.recruiterUserId, grant.status])).toEqual([[seven, bia.id, "active"]]);
    expect((await historyOf()).map((event) => event.kind)).toEqual(["invite_sent", "invite_accepted", "grant_created"]);
    expect(grantedMails("bia@y.com")).toHaveLength(1);
    expect(boundary.jar.has(INVITE_COOKIE)).toBe(false);
  });

  it("IT-085 cadastro pelo link com outro e-mail: conta criada, nenhum acesso, convite pendente, aviso e evento sem dado da candidata", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    expect(await socialSignup("carla@z.com")).toBe("NEXT_REDIRECT;/recruiter?invite=mismatch");
    const carla = (await userByEmail("carla@z.com"))!;
    expect(carla.roles).toEqual(["recruiter"]);
    expect(await grants()).toEqual([]);
    expect((await inviteRow("bia@y.com")).status).toBe("pending");
    const mismatch = await db.select().from(authEvent).where(eq(authEvent.kind, "invite_mismatch"));
    expect(mismatch).toEqual([expect.objectContaining({ userId: carla.id, email: "carla@z.com", detail: null })]);
    expect(JSON.stringify(mismatch)).not.toMatch(/Ana|bia@y\.com/);
  });

  it("IT-086 convite a bia@y.com e cadastro como ' Bia@Y.com': conclui", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    expect(await manualSignup(" Bia@Y.com")).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);
    expect((await inviteRow("bia@y.com")).status).toBe("accepted");
    expect(await grants()).toHaveLength(1);
  });

  it("IT-087 convite a ab@gmail.com e cadastro como a.b+x@gmail.com: descompasso, sem acesso", async () => {
    const token = await invite("ab@gmail.com");
    await startFromLink(token);
    expect(await socialSignup("a.b+x@gmail.com")).toBe("NEXT_REDIRECT;/recruiter?invite=mismatch");
    expect(await grants()).toEqual([]);
    expect((await inviteRow("ab@gmail.com")).status).toBe("pending");
  });

  it("IT-088 dois candidatos convidaram bia@y.com; ela se cadastra sem cookie: os dois convites, duas concessões, dois e-mails", async () => {
    await invite("bia@y.com");
    await invite("bia@y.com", { candidateId: eight, actorUserId: bruno });
    expect(await socialSignup("bia@y.com")).toBe("NEXT_REDIRECT;/recruiter");
    expect((await inviteRow("bia@y.com", seven)).status).toBe("accepted");
    expect((await inviteRow("bia@y.com", eight)).status).toBe("accepted");
    expect((await grants()).map((grant) => grant.candidateId).sort()).toEqual([seven, eight].sort());
    expect(grantedMails("bia@y.com")).toHaveLength(2);
  });
});

/* ------------------- Convite morto, prazo, data e duas abas ------------------- */

describe("convite morto, prazo encerrado, data copiada e duas abas (IT-089 – IT-092)", () => {
  it("IT-089 cancelado entre o 'Criar conta' e o fim do cadastro: conta criada, sem acesso, aviso de convite inválido", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    await cancelInvite({ inviteId: (await inviteRow("bia@y.com")).id, candidateId: seven, actor: "candidate", actorUserId: ana }, accessDeps());
    expect(await socialSignup("bia@y.com")).toBe("NEXT_REDIRECT;/recruiter?invite=invalid");
    expect(await userByEmail("bia@y.com")).not.toBeNull();
    expect(await grants()).toEqual([]);
    expect((await historyOf()).map((event) => event.kind)).toEqual(["invite_sent", "invite_cancelled"]);
  });

  it("IT-089 o link venceu durante o cadastro: o mesmo desfecho", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    await db.update(recruiterInvite).set({ expiresAt: new Date(time.now() - 1).toISOString() });
    expect(await socialSignup("bia@y.com")).toBe("NEXT_REDIRECT;/recruiter?invite=invalid");
    expect(await userByEmail("bia@y.com")).not.toBeNull();
    expect(await grants()).toEqual([]);
    expect((await historyOf()).map((event) => event.kind)).not.toContain("invite_accepted");
  });

  it("IT-090 o prazo de acesso do convite passou antes da conclusão: convite expirado, sem acesso, aviso de prazo", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    await db.update(recruiterInvite).set({ accessExpiresAt: new Date(time.now() - 1).toISOString(), expiryTz: "UTC" });
    expect(await socialSignup("bia@y.com")).toBe("NEXT_REDIRECT;/recruiter?invite=period_over");
    expect(await grants()).toEqual([]);
    expect((await inviteRow("bia@y.com")).status).toBe("expired");
    expect((await historyOf()).map((event) => event.kind)).toEqual(["invite_sent", "invite_expired"]);
  });

  it("IT-091 a data de fim escolhida no convite vira a da concessão, com o fuso", async () => {
    const day = new Date(time.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const token = await invite("bia@y.com", { endDate: day, tz: "America/Sao_Paulo" });
    const row = await inviteRow("bia@y.com");
    expect(row.accessExpiresAt).toMatch(/T02:59:59\.999Z$/);
    await startFromLink(token);
    await socialSignup("bia@y.com");
    const [grant] = await grants();
    expect(grant).toMatchObject({ expiresAt: row.accessExpiresAt, expiryTz: "America/Sao_Paulo" });
  });

  it("IT-092 duas conclusões simultâneas com o mesmo token: uma concessão; a segunda vê o link usado", async () => {
    const token = await invite("bia@y.com");
    const bia = await account("bia@y.com", ["recruiter"]);
    await warmPool();
    const results = await Promise.all([
      completeInvitesForAccount({ userId: bia, token }, accessDeps()),
      completeInvitesForAccount({ userId: bia, token }, accessDeps()),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["completed", "invalid"]);
    expect(await grants()).toHaveLength(1);
    expect(grantedMails("bia@y.com")).toHaveLength(1);
  });
});

/* ---------------------- Conta existente e estados com sessão ---------------------- */

describe("conta existente e estados com sessão (IT-093 – IT-097)", () => {
  it("IT-093 recrutadora com conta confirmada entra pelo 'Já tenho conta': o login conclui, e a página leva à candidata", async () => {
    const token = await invite("bia@y.com");
    await account("bia@y.com", ["recruiter"], { password: true });
    const next = `/signup/invite?token=${token}`;
    expect(await outcome(() => passwordLoginAction(form({ email: "bia@y.com", password: PASSWORD, next })))).toBe(`NEXT_REDIRECT;${next}`);
    expect((await inviteRow("bia@y.com")).status).toBe("accepted");
    expect(await grants()).toHaveLength(1);
    expect(await outcome(() => renderInvite(token))).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);
  });

  it("IT-094 recrutadora com sessão e e-mail ainda não confirmado: 'Aceitar e abrir' conclui e confirma o e-mail", async () => {
    const token = await invite("bia@y.com");
    const bia = await account("bia@y.com", ["recruiter"], { verified: false });
    await signedIn("bia@y.com");
    expect(await renderInvite(token)).toContain('data-testid="invite-accept"');
    expect(await outcome(() => acceptInviteAction(form({ token })))).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);
    expect(await grants()).toEqual([expect.objectContaining({ candidateId: seven, recruiterUserId: bia, status: "active" })]);
    expect((await userByEmail("bia@y.com"))!.emailVerifiedAt).not.toBeNull();
  });

  it("IT-095 sessão de outro endereço: 'Este convite é para b•••@y.com', nada da candidata, nada muda", async () => {
    const token = await invite("bia@y.com");
    await account("carla@z.com", ["recruiter"]);
    await signedIn("carla@z.com");
    const before = { grants: await grants(), invite: await inviteRow("bia@y.com") };
    const html = await renderInvite(token);
    expect(html).toContain(`${t("recruiterInvite.otherEmail")} <strong data-user-content="true">b•••@y.com</strong>.`);
    expect(html).toContain(t("recruiterInvite.signOutToContinue"));
    expect(html).not.toContain("Ana");
    expect(html).not.toContain("invite-accept");
    expect({ grants: await grants(), invite: await inviteRow("bia@y.com") }).toEqual(before);
  });

  it("IT-096 sessão com o e-mail convidado mas só candidata: 'precisa de conta de recrutador', sem acesso, convite pendente na lista", async () => {
    const token = await invite("bia@y.com");
    const own = await ensureCandidate({ slug: "bia", name: "Bia" });
    await account("bia@y.com", ["candidate"], { candidateId: own });
    await signedIn("bia@y.com");
    const html = await renderInvite(token);
    expect(html).toContain(t("recruiterInvite.needsRecruiter"));
    expect(html).not.toContain("invite-accept");
    // A action forjada também recusa, antes de qualquer efeito.
    expect(await outcome(() => acceptInviteAction(form({ token })))).toMatch(/^negado: account:read — requer papel recruiter/);
    expect(await grants()).toEqual([]);
    const listed = await drizzleRecruiterAccess.invitesOf(seven, clock().iso());
    expect(listed).toEqual([expect.objectContaining({ email: "bia@y.com", status: "pending" })]);
  });

  it("IT-097 a candidata foi desabilitada depois do convite: o cadastro conclui sem acesso, desfecho inválido", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    await setUserDisabled(ana, true);
    expect(await socialSignup("bia@y.com")).toBe("NEXT_REDIRECT;/recruiter?invite=invalid");
    expect(await grants()).toEqual([]);
  });
});

/* ------------- Token fora do log, limites da #464, reativação, inventário ------------- */

describe("token, limites, reativação e inventário (IT-098 – IT-102)", () => {
  it("IT-098 a página, o 'Criar conta' e o cadastro não escrevem o token cru no console nem no banco", async () => {
    const written: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg))).join(" "));
      }),
    );
    try {
      const token = await invite("bia@y.com");
      await renderInvite(token);
      await startFromLink(token);
      await socialSignup("bia@y.com");
      await renderInvite(token);
      expect(written.filter((line) => line.includes(token))).toEqual([]);
      const tables = await Promise.all([
        db.select().from(recruiterInvite),
        db.select().from(authEvent),
        db.select().from(recruiterAccessEvent),
        db.select().from(recruiterGrant),
        db.select().from(authSignup),
      ]);
      expect(JSON.stringify(tables)).not.toContain(token);
      expect((await inviteRow("bia@y.com")).tokenHash).toBe(hashToken(token));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("IT-099 o limite por IP do cadastro recusa a conta; o convite segue pendente e conclui no cadastro seguinte", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    // Três cadastros concluídos deste IP na última hora, como o servidor grava.
    const ipHmac = signupIpHmac(boundary.ip, process.env.JHO_SIGNUP_IP_SECRET!);
    const at = new Date(time.now() - 60_000).toISOString();
    for (let i = 0; i < 3; i += 1) {
      await db.insert(authSignup).values({
        kind: "social",
        tokenHash: `limite-${i}-${randomBytes(4).toString("hex")}`,
        email: `limite${i}@y.com`,
        locale: "pt-BR",
        ipHmac,
        createdAt: at,
        expiresAt: at,
        completedAt: at,
      });
    }
    expect(await socialSignup("bia@y.com")).toBe('valor:{"ok":false,"code":"ip_cap"}');
    expect(await userByEmail("bia@y.com")).toBeNull();
    expect((await inviteRow("bia@y.com")).status).toBe("pending");

    boundary.ip = "198.51.100.99";
    expect(await socialSignup("bia@y.com", "sub-bia-de-novo")).toBe(`NEXT_REDIRECT;/recruiter/${seven}`);
    expect((await inviteRow("bia@y.com")).status).toBe("accepted");
  });

  it("IT-100 convite feito com a conta do Rui desabilitada; o admin reabilita e ele entra: concessão criada", async () => {
    const rui = await account("rui@x.com", ["recruiter"], { disabled: true, password: true });
    await invite("rui@x.com");
    expect(await grants()).toEqual([]);
    await setUserDisabled(rui, false);
    expect(await outcome(() => passwordLoginAction(form({ email: "rui@x.com", password: PASSWORD })))).toBe("NEXT_REDIRECT;/jobs");
    expect(await grants()).toEqual([expect.objectContaining({ candidateId: seven, recruiterUserId: rui, status: "active" })]);
    expect((await inviteRow("rui@x.com")).status).toBe("accepted");
  });

  it("IT-101 LinkedIn sem email_verified: o cadastro recusa, nenhuma conta, convite pendente", async () => {
    const token = await invite("bia@y.com");
    await startFromLink(token);
    const back = await viaProvider("linkedin", { sub: "li-bia", email: "bia@y.com", emailVerified: undefined });
    expect(back).toEqual({ kind: "redirect", location: "/login?error=unverified&provider=linkedin" });
    expect(await userByEmail("bia@y.com")).toBeNull();
    expect((await inviteRow("bia@y.com")).status).toBe("pending");
  });

  it("IT-102 inventário: página pública no proxy e na política, startInvitedSignup registrada, acceptInviteAction guardada, rota medida", async () => {
    const { pages, serverModules } = discoverEntries();
    expect(pages).toContain("app/signup/invite/page.tsx");
    expect(readFileSync("tests/architecture.test.ts", "utf8")).toContain('"app/signup/invite/page.tsx": {');

    // Sem sessão, o proxy deixa passar `/signup/invite`; outra rota vai ao login.
    const { proxy } = await import("../proxy.ts");
    const { NextRequest } = await import("next/server");
    const open = proxy(new NextRequest("http://127.0.0.1:3000/signup/invite?token=abc"));
    expect(open.headers.get("location")).toBeNull();
    const closed = proxy(new NextRequest("http://127.0.0.1:3000/recruiter"));
    expect(closed.headers.get("location")).toContain("/login");

    const file = "app/signup/invite/actions.ts";
    expect(serverModules).toContain(file);
    expect(UNGUARDED_BY_DESIGN.get("startInvitedSignup")).toEqual({ file, why: expect.stringContaining("token de uso único por hash") });
    const source = readFileSync(file, "utf8");
    expect(exportedBindings(source).map((binding) => binding.exported).sort()).toEqual(["acceptInviteAction", "startInvitedSignup"]);
    expect(guardComesFirst(source, "acceptInviteAction")).toEqual({ ok: true });
    expect(UNGUARDED_BY_DESIGN.has("acceptInviteAction")).toBe(false);

    const { ENGLISH_ANONYMOUS_SWEEP, UNMEASURED_PAGES } = await import("./e2e/routes.mjs");
    const measured = ENGLISH_ANONYMOUS_SWEEP.some((path: string) => path.startsWith("/signup/invite?"));
    expect(measured || "app/signup/invite/page.tsx" in UNMEASURED_PAGES).toBe(true);
  });
});
