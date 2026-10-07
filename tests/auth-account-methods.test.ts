/**
 * Suíte: formas de entrar da conta, no servidor (#464, US-008–US-011, US-019).
 *
 * Invariante: nenhuma conta fica sem forma de entrar, nem sob concorrência;
 * desligar grava `identity_unlinked` nomeando quem fez e manda o aviso; a
 * primeira senha não derruba sessão, trocar uma existente derruba; o admin vê
 * os métodos de cada conta e só desliga; sessão emprestada e quem não é admin
 * são negados antes de qualquer efeito.
 * Fronteira DENTRO: as funções compostas de `index.ts`, o store real
 * (`drizzle-identities.ts`, com a trava `FOR UPDATE`) e as Server Actions de
 * `/account` e `/admin/users` com `next/*` dublado; PostgreSQL com as
 * migrações (`useTestDb`); e-mail no sink em arquivo.
 * Fronteira FORA: o vínculo pelo provedor (`auth-oidc-login.test.ts`) e o
 * navegador (E2E `account-methods`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../src/contexts/auth/index.ts";
import {
  accountAccess,
  adminDisconnectProvider,
  beginImpersonation,
  changePasswordForSession,
  createUser,
  disconnectOwnProvider,
  listUsersWithMethods,
  resolveSession,
  setFirstPasswordForSession,
  setPassword,
  verifyLogin,
  type Role,
  type Session,
} from "../src/contexts/auth/index.ts";
import { listMethods } from "../src/contexts/auth/app/account-methods.ts";
import * as identities from "../src/contexts/auth/infra/drizzle-identities.ts";
import { drizzleSessions } from "../src/contexts/auth/infra/drizzle-store.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authIdentity, authSession, authUser } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const boundary = vi.hoisted(() => ({
  token: undefined as string | undefined,
  effects: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    set: (name: string) => void boundary.effects.push(`cookies.set(${name})`),
    delete: (name: string) => void boundary.effects.push(`cookies.delete(${name})`),
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    boundary.effects.push(`redirect(${to})`);
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void boundary.effects.push(`revalidatePath(${path})`),
}));

const { disconnectProviderAction, setOwnPasswordAction } = await import("../app/account/actions.ts");
const { adminDisconnectProviderAction } = await import("../app/admin/actions.ts");

const SENHA = "senha-da-conta-bem-longa";
let db: DB;
let sink: string;
let env: Record<string, string>;

beforeEach(async () => {
  db = await useTestDb();
  sink = mkdtempSync(join(tmpdir(), "jho-methods-sink-"));
  // O sink em arquivo só vale com `JHO_ENV` local ou e2e (ADR-011).
  env = { JHO_ENV: "local", JHO_MAIL_SINK: sink };
  boundary.token = undefined;
  boundary.effects = [];
});

afterEach(async () => {
  rmSync(sink, { recursive: true, force: true });
  await releaseTestDb();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = await run();
    return `executou:${JSON.stringify(result ?? null)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Conta com sessão aberta; `password: false` deixa a conta só com provedor. */
async function account(
  email: string,
  options: { roles?: Role[]; password?: boolean; providers?: Array<"google" | "linkedin"> } = {},
): Promise<{ id: number; token: string; session: Session }> {
  const { id } = await createUser({ email, fullName: email, roles: options.roles ?? ["candidate"] });
  if (options.password !== false) await setPassword(email, SENHA);
  for (const provider of options.providers ?? []) {
    await db.insert(authIdentity).values({
      userId: id,
      provider,
      subject: `${provider}-${email}`,
      emailAtLink: email,
      origin: provider === "google" ? "automatic" : "manual",
      linkedAt: "2026-10-01T10:00:00.000Z",
    });
  }
  const token = await drizzleSessions.create({ userId: id, expiresAt: "2999-01-01T00:00:00.000Z" });
  return { id, token, session: (await resolveSession(token))! };
}

async function providersOf(userId: number) {
  const rows = await db.select({ provider: authIdentity.provider }).from(authIdentity).where(eq(authIdentity.userId, userId));
  return rows.map((row) => row.provider).sort();
}

async function events(kind: string, userId?: number) {
  const rows = await db.select().from(authEvent).where(eq(authEvent.kind, kind));
  return userId === undefined ? rows : rows.filter((row) => row.userId === userId);
}

const sinkMails = () =>
  readdirSync(sink)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as { to: string; subject: string; text: string });

describe("sessão emprestada e quem não é admin (US-007.EC-5, US-008.EC-3, US-011.EC-2/EC-3)", () => {
  it("IT-045 sessão emprestada nega desligar, definir senha, ligar e desligar como admin — antes de qualquer efeito", async () => {
    const admin = await account("admin@x.com", { roles: ["admin"] });
    const otherAdmin = await account("admin2@x.com", { roles: ["admin", "candidate"], providers: ["google"] });
    const ana = await account("ana@x.com", { password: false, providers: ["google", "linkedin"] });

    for (const target of [ana, otherAdmin]) {
      const borrowed = await beginImpersonation(admin.session, target.id);
      if (!borrowed.ok) throw new Error(borrowed.reason);
      const session = (await resolveSession(borrowed.token))!;
      expect(session.impersonatedBy).toBe(admin.id);
      boundary.token = borrowed.token;
      boundary.effects = [];

      expect(await outcome(() => disconnectProviderAction(form({ provider: "google" })))).toMatch(
        /^negado: account:manage-methods/,
      );
      expect(
        await outcome(() => setOwnPasswordAction(form({ newPassword: "senha-nova-bem-longa", confirmPassword: "senha-nova-bem-longa" }))),
      ).toMatch(/^negado: account:manage-methods/);
      // Admin assumindo outro admin também não administra (o caso do bloco).
      expect(
        await outcome(() => adminDisconnectProviderAction(form({ userId: String(ana.id), provider: "linkedin" }))),
      ).toMatch(/^negado: user:manage/);
      expect(boundary.effects).toEqual([]);

      // Segunda barreira: a função composta também recusa a sessão emprestada.
      expect(() => disconnectOwnProvider(session, "google", env)).toThrow(/sessão emprestada/);
      expect(() => setFirstPasswordForSession(session, "senha-nova-bem-longa")).toThrow(/sessão emprestada/);

      // E o início do vínculo manda entrar de novo, sem cookie de fluxo.
      const start = await auth.startSocialSignIn(
        { provider: "google", intent: "link", next: null, session, request: { host: "127.0.0.1:3000", proto: "http" } },
        {
          JHO_ENV: "local",
          JHO_SESSION_SECRET: "segredo-de-teste-com-mais-de-32-caracteres",
          GOOGLE_OIDC_CLIENT_ID: "id",
          GOOGLE_OIDC_CLIENT_SECRET: "segredo",
        },
      );
      expect(start).toEqual({ kind: "redirect", location: "/login?next=%2Faccount" });
    }

    expect(await providersOf(ana.id)).toEqual(["google", "linkedin"]);
    expect(await providersOf(otherAdmin.id)).toEqual(["google"]);
    const [row] = await db.select({ hash: authUser.passwordHash }).from(authUser).where(eq(authUser.id, ana.id));
    expect(row!.hash).toBeNull();
    expect(await events("identity_unlinked")).toHaveLength(0);
    expect(await events("password_set")).toHaveLength(0);
    expect(sinkMails()).toEqual([]);
  });
});

describe("desligar (US-008)", () => {
  it("IT-046 com senha definida: identidade some, identity_unlinked (self) e aviso por e-mail", async () => {
    const ana = await account("ana@x.com", { providers: ["google"] });
    await expect(disconnectOwnProvider(ana.session, "google", env)).resolves.toEqual({ ok: true });

    expect(await providersOf(ana.id)).toEqual([]);
    const unlinked = await events("identity_unlinked", ana.id);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ email: "ana@x.com", detail: "google: self" });
    const mails = sinkMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "ana@x.com", subject: "Google foi desligado da sua conta do Master Jobs" });
    expect(mails[0]!.text).toContain("por você, na tela da conta");
    // Entrar com o Google de novo não chega mais à conta pela identidade.
    await expect(identities.findLinkedUser("google", "google-ana@x.com")).resolves.toBeNull();
  });

  it("IT-046 pela action: volta à conta com ?unlinked= e revalida a página", async () => {
    const ana = await account("ana@x.com", { providers: ["linkedin"] });
    boundary.token = ana.token;
    expect(await outcome(() => disconnectProviderAction(form({ provider: "linkedin" })))).toBe(
      "NEXT_REDIRECT;/account?unlinked=linkedin",
    );
    expect(boundary.effects).toContain("revalidatePath(/account)");
    expect(await providersOf(ana.id)).toEqual([]);
  });

  it("IT-047 último método, pela dona ou pelo admin: last_method e nada muda", async () => {
    const admin = await account("admin@x.com", { roles: ["admin"] });
    const ana = await account("ana@x.com", { password: false, providers: ["linkedin"] });

    await expect(disconnectOwnProvider(ana.session, "linkedin", env)).resolves.toEqual({ ok: false, error: "last_method" });
    await expect(adminDisconnectProvider(admin.session, ana.id, "linkedin", env)).resolves.toEqual({
      ok: false,
      error: "last_method",
    });

    boundary.token = ana.token;
    expect(await outcome(() => disconnectProviderAction(form({ provider: "linkedin" })))).toBe(
      "NEXT_REDIRECT;/account?status=unlink-last_method",
    );
    boundary.token = admin.token;
    expect(
      await outcome(() => adminDisconnectProviderAction(form({ userId: String(ana.id), provider: "linkedin" }))),
    ).toBe('executou:{"ok":false,"code":"last_method"}');

    expect(await providersOf(ana.id)).toEqual(["linkedin"]);
    expect(await events("identity_unlinked")).toHaveLength(0);
    expect(sinkMails()).toEqual([]);
  });

  it("IT-047 provedor não ligado ou nome inventado: nada a desligar", async () => {
    const ana = await account("ana@x.com", { providers: ["google"] });
    await expect(disconnectOwnProvider(ana.session, "linkedin", env)).resolves.toEqual({ ok: false, error: "not_linked" });
    boundary.token = ana.token;
    expect(await outcome(() => disconnectProviderAction(form({ provider: "github" })))).toBe(
      "NEXT_REDIRECT;/account?status=unlink-not_linked",
    );
    expect(await providersOf(ana.id)).toEqual(["google"]);
  });

  it("IT-048 dois desligamentos simultâneos que zerariam a conta: um passa, o outro é last_method", async () => {
    const ana = await account("ana@x.com", { password: false, providers: ["google", "linkedin"] });
    const results = await Promise.all([
      disconnectOwnProvider(ana.session, "google", env),
      disconnectOwnProvider(ana.session, "linkedin", env),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "last_method" }]);
    expect(await providersOf(ana.id)).toHaveLength(1);
    expect(await events("identity_unlinked", ana.id)).toHaveLength(1);
  });

  it("IT-048 com um desligamento em voo (linha travada, ainda sem commit), o segundo espera e vê o último método", async () => {
    // O `Promise.all` acima pode serializar por sorte. Aqui a intercalação é
    // forçada: a transação T1 faz o que um desligamento faz — trava a conta e
    // apaga o Google — e segura o commit enquanto o desligamento real do
    // LinkedIn começa. Sem a trava `FOR UPDATE`, ele leria os dois provedores
    // ainda gravados e apagaria o seu, e a conta ficaria sem porta.
    const ana = await account("ana@x.com", { password: false, providers: ["google", "linkedin"] });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));

    const first = db.transaction(async (tx) => {
      await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, ana.id)).for("update");
      await tx.delete(authIdentity).where(and(eq(authIdentity.userId, ana.id), eq(authIdentity.provider, "google")));
      locked();
      await held;
    });
    await lockTaken;
    const second = disconnectOwnProvider(ana.session, "linkedin", env);
    // Tempo para a segunda chegar ao `SELECT … FOR UPDATE` e ficar esperando.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await first;

    await expect(second).resolves.toEqual({ ok: false, error: "last_method" });
    expect(await providersOf(ana.id)).toEqual(["linkedin"]);
  });
});

describe("primeira senha (US-009)", () => {
  it("IT-049 conta só social define senha de 12 caracteres e passa a entrar com ela", async () => {
    const ana = await account("ana@x.com", { password: false, providers: ["google"] });
    expect((await verifyLogin("ana@x.com", "doze-chars-1")).ok).toBe(false);

    await expect(setFirstPasswordForSession(ana.session, "doze-chars-1")).resolves.toEqual({ ok: true });
    expect((await verifyLogin("ana@x.com", "doze-chars-1")).ok).toBe(true);
    expect(await events("password_set", ana.id)).toHaveLength(1);

    // A action: curta volta com a mensagem de sempre; a conta já com senha não
    // define outra por este caminho.
    boundary.token = ana.token;
    expect(
      await outcome(() => setOwnPasswordAction(form({ newPassword: "curta", confirmPassword: "curta" }))),
    ).toBe("NEXT_REDIRECT;/account?status=first-password-weak_password");
    expect(
      await outcome(() =>
        setOwnPasswordAction(form({ newPassword: "outra-senha-longa", confirmPassword: "outra-senha-longa" })),
      ),
    ).toBe("NEXT_REDIRECT;/account?status=first-password-has_password");
    expect(
      await outcome(() =>
        setOwnPasswordAction(form({ newPassword: "outra-senha-longa", confirmPassword: "diferente-longa" })),
      ),
    ).toBe("NEXT_REDIRECT;/account?status=password-mismatch");
    expect((await verifyLogin("ana@x.com", "doze-chars-1")).ok).toBe(true);
  });

  it("IT-050 a primeira senha mantém as outras sessões; trocar uma existente encerra as outras", async () => {
    const ana = await account("ana@x.com", { password: false, providers: ["google"] });
    const other = await drizzleSessions.create({ userId: ana.id, expiresAt: "2999-01-01T00:00:00.000Z" });

    boundary.token = ana.token;
    expect(
      await outcome(() =>
        setOwnPasswordAction(form({ newPassword: "primeira-senha-da-ana", confirmPassword: "primeira-senha-da-ana" })),
      ),
    ).toBe("NEXT_REDIRECT;/account?status=first-password-set");
    expect(await resolveSession(ana.token)).not.toBeNull();
    expect(await resolveSession(other)).not.toBeNull();

    const changed = await changePasswordForSession(ana.session, "primeira-senha-da-ana", "segunda-senha-da-ana");
    expect(changed.ok).toBe(true);
    expect(await resolveSession(ana.token)).toBeNull();
    expect(await resolveSession(other)).toBeNull();
  });
});

describe("listar (US-010)", () => {
  it("IT-051 listMethods traz a senha, os provedores com datas e origem, e os termos aceitos", async () => {
    const ana = await account("ana@x.com", { providers: ["google", "linkedin"] });
    await db
      .update(authIdentity)
      .set({ lastUsedAt: "2026-10-05T09:00:00.000Z" })
      .where(and(eq(authIdentity.userId, ana.id), eq(authIdentity.provider, "google")));
    await db
      .update(authUser)
      .set({ termsVersion: "2026-10-06", privacyVersion: "2026-10-06", termsAcceptedAt: "2026-10-06T08:00:00.000Z" })
      .where(eq(authUser.id, ana.id));

    const access = await listMethods(ana.id, { store: identities, available: () => ["google"] });
    expect(access).toEqual({
      methods: {
        password: true,
        providers: [
          {
            provider: "google",
            linked: true,
            origin: "automatic",
            linkedAt: "2026-10-01T10:00:00.000Z",
            lastUsed: "2026-10-05T09:00:00.000Z",
            availableHere: true,
          },
          {
            provider: "linkedin",
            linked: true,
            origin: "manual",
            linkedAt: "2026-10-01T10:00:00.000Z",
            lastUsed: "never",
            availableHere: false,
          },
        ],
      },
      terms: { termsVersion: "2026-10-06", privacyVersion: "2026-10-06", acceptedAt: "2026-10-06T08:00:00.000Z" },
    });
    // A composição de `index.ts` lê a mesma coisa para a conta DA SESSÃO.
    const own = await accountAccess(ana.session, {});
    expect(own?.methods.providers.map((item) => item.provider)).toEqual(["google", "linkedin"]);
    await expect(listMethods(999_999, { store: identities, available: () => [] })).resolves.toBeNull();
  });
});

describe("administração (US-011)", () => {
  it("IT-052 a lista do admin traz provedores e senha de cada conta", async () => {
    await account("admin@x.com", { roles: ["admin"] });
    const ana = await account("ana@x.com", { password: false, providers: ["linkedin", "google"] });
    const bia = await account("bia@x.com");
    const users = await listUsersWithMethods();
    const byEmail = new Map(users.map((user) => [user.email, user]));
    expect(byEmail.get("ana@x.com")).toMatchObject({ id: ana.id, hasPassword: false, providers: ["google", "linkedin"] });
    expect(byEmail.get("bia@x.com")).toMatchObject({ id: bia.id, hasPassword: true, providers: [] });
    // Nada do provedor além do nome: nem sujeito, nem e-mail do provedor.
    expect(JSON.stringify(users)).not.toContain("google-ana@x.com");
  });

  it("IT-053 o admin desliga: o evento nomeia o admin e o aviso diz 'um administrador'", async () => {
    const admin = await account("admin@x.com", { roles: ["admin"] });
    const ana = await account("ana@x.com", { providers: ["google"] });
    boundary.token = admin.token;
    expect(
      await outcome(() => adminDisconnectProviderAction(form({ userId: String(ana.id), provider: "google" }))),
    ).toBe('executou:{"ok":true,"code":"unlinked"}');
    expect(await providersOf(ana.id)).toEqual([]);
    expect(boundary.effects).toContain("revalidatePath(/admin/users)");

    const unlinked = await events("identity_unlinked", ana.id);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]!.detail).toBe(`google: admin admin@x.com (#${admin.id})`);
    // O aviso vai pelo mailer do processo na action; pela função composta, pelo sink.
    const bia = await account("bia@x.com", { providers: ["linkedin"] });
    await adminDisconnectProvider(admin.session, bia.id, "linkedin", env);
    const mails = sinkMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "bia@x.com" });
    expect(mails[0]!.text).toContain("por um administrador");
    expect(mails[0]!.text).not.toContain("admin@x.com");
  });

  it("IT-054 nenhum caminho liga provedor para outra conta; quem não é admin não desliga a de ninguém", async () => {
    // O contexto não exporta função de ligar fora do fluxo do provedor, que
    // liga sempre à conta da sessão.
    // ("unlink" é o contrário, e existe de propósito.)
    const linkers = Object.keys(auth).filter(
      (name) => /provider|identity/i.test(name) && /link/i.test(name.replace(/unlink/gi, "")),
    );
    expect(linkers).toEqual([]);
    expect(Object.keys(auth)).toContain("cliUnlinkProvider");

    const ana = await account("ana@x.com", { providers: ["google"] });
    const bia = await account("bia@x.com", { roles: ["recruiter"] });
    expect(() => adminDisconnectProvider(bia.session, ana.id, "google", env)).toThrow(/negado: user:manage/);
    expect(() => adminDisconnectProvider(null, ana.id, "google", env)).toThrow(/negado: user:manage/);

    for (const token of [bia.token, ana.token, undefined]) {
      boundary.token = token;
      boundary.effects = [];
      expect(
        await outcome(() => adminDisconnectProviderAction(form({ userId: String(ana.id), provider: "google" }))),
      ).toMatch(/^negado: user:manage/);
      expect(boundary.effects).toEqual([]);
    }
    expect(await providersOf(ana.id)).toEqual(["google"]);
    expect(await db.select().from(authSession).where(eq(authSession.userId, ana.id))).toHaveLength(1);
  });
});
