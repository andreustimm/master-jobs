/**
 * Suíte: as Server Actions e a seção de acesso de recrutador (#465, task_02;
 * `_tests.md` IT-024, IT-070 – IT-073, IT-075 – IT-078).
 *
 * Fronteira DENTRO: `app/account/recruiter-access-actions.ts`,
 * `app/admin/actions.ts` e `app/auth.ts` reais, com a sessão resolvida contra
 * o PostgreSQL de teste — o mesmo arranjo de `tests/entry-denial.test.ts`.
 * Fronteira FORA: a borda do Next (cookie, cabeçalho, navegação, cache), o
 * sink de e-mail em diretório temporário e, na renderização, os componentes
 * de `@/components/ui`.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginImpersonation,
  candidateScope,
  createUser,
  finishLogin,
  recruiterAccessView,
  resolveSession,
  startLogin,
  type CandidateAccessView,
  type Role,
} from "../src/contexts/auth/index.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { authSession, authUser, recruiterAccessEvent, recruiterGrant, recruiterInvite } from "../src/core/db/schema.ts";
import { translator } from "../src/core/i18n/index.ts";
import { discoverEntries, exportedBindings, guardComesFirst, stripComments } from "./support/entry-inventory.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const boundary = vi.hoisted(() => ({ token: undefined as string | undefined, effects: [] as string[] }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    getAll: () => [],
    has: (name: string) => name === "jho_session" && boundary.token !== undefined,
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
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void boundary.effects.push(`revalidatePath(${path})`),
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("@/components/ui/card", () => {
  const box = (props: HTMLAttributes<HTMLElement>) => createElement("div", props);
  return { Card: box, CardContent: box, CardHeader: box, CardTitle: box };
});
vi.mock("@/components/ui/button", () => ({
  Button: (props: HTMLAttributes<HTMLElement>) => createElement("button", props),
  buttonVariants: () => "",
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: HTMLAttributes<HTMLElement>) => createElement("input", props) }));
vi.mock("@/components/ui/label", () => ({ Label: (props: HTMLAttributes<HTMLElement>) => createElement("label", props) }));
vi.mock("../app/mutation-feedback.tsx", () => ({ publishMutationFeedback: () => {} }));
vi.mock("../app/transition-link.tsx", () => ({
  TransitionLink: (props: HTMLAttributes<HTMLElement> & { href: string }) => createElement("a", props),
}));

const { grantRecruiterAccessAction, revokeRecruiterAccessAction, setGrantEndDateAction, resendInviteAction, cancelInviteAction, dismissInviteAction } =
  await import("../app/account/recruiter-access-actions.ts");
const { adminRevokeGrantAction, adminCancelInviteAction } = await import("../app/admin/actions.ts");
const { requireSession } = await import("../app/auth.ts");
const { RecruiterAccessSection } = await import("../app/account/recruiter-access.tsx");

const DENIED = /^(negado: |NEXT_HTTP_ERROR_FALLBACK;403$)/;
const t = translator("pt-BR").t;

let db: DB;
let sink: string;
let seven: number;
let nine: number;
let rui: number;

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

async function login(email: string, roles: Role[], candidateId: number | null, extra: Partial<typeof authUser.$inferInsert> = {}) {
  const { id } = await createUser({ email, fullName: email, roles, candidateId });
  if (Object.keys(extra).length > 0) await db.update(authUser).set(extra).where(eq(authUser.id, id));
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  return { id, token: result.token };
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "executou";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function rows() {
  return {
    grants: await db.select().from(recruiterGrant),
    invites: await db.select().from(recruiterInvite),
    events: await db.select().from(recruiterAccessEvent),
  };
}

beforeAll(() => {
  sink = mkdtempSync(join(tmpdir(), "jho-recruiter-access-"));
  process.env.JHO_MAIL_SINK = sink;
});

afterAll(() => {
  delete process.env.JHO_MAIL_SINK;
  rmSync(sink, { recursive: true, force: true });
});

beforeEach(async () => {
  db = await useTestDb();
  boundary.token = undefined;
  boundary.effects = [];
  seven = await ensureCandidate({ slug: "ana", name: "Ana" });
  nine = await ensureCandidate({ slug: "dona", name: "Dona" });
  rui = (await login("rui@x.com", ["recruiter"], null, { emailVerifiedAt: "2026-01-01T00:00:00.000Z" })).id;
});

afterEach(async () => {
  await releaseTestDb();
});

describe("quem pode conceder", () => {
  it("IT-024 sessão só de recrutador e admin sem candidato são negados, e nada é gravado", async () => {
    const recruiter = await login("so-recrutador@x.com", ["recruiter"], null);
    const admin = await login("admin@x.com", ["admin"], null);
    const before = await rows();

    for (const token of [recruiter.token, admin.token]) {
      boundary.token = token;
      boundary.effects = [];
      expect(await outcome(() => grantRecruiterAccessAction(form({ email: "bia@y.com", endDate: "", tz: "" })))).toMatch(DENIED);
      expect(boundary.effects).toEqual([]);
    }
    expect(await rows()).toEqual(before);
  });

  it("IT-070 sessão de candidato no revogar do admin é negada; a sessão emprestada de um admin também", async () => {
    const owner = await login("ana@x.com", ["candidate"], seven);
    const [grant] = await db
      .insert(recruiterGrant)
      .values({ candidateId: seven, recruiterUserId: rui, recruiterEmail: "rui@x.com" })
      .returning();
    boundary.token = owner.token;
    expect(await outcome(() => adminRevokeGrantAction(form({ grantId: grant!.id })))).toMatch(DENIED);

    const admin = await login("admin@x.com", ["admin"], null);
    const target = await login("alvo@x.com", ["admin", "candidate"], nine);
    const borrowed = await beginImpersonation(await resolveSession(admin.token), target.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);
    boundary.token = borrowed.token;
    expect(await outcome(() => adminRevokeGrantAction(form({ grantId: grant!.id })))).toMatch(/sessão emprestada/);
    expect(await outcome(() => adminCancelInviteAction(form({ inviteId: 1 })))).toMatch(/sessão emprestada/);
    expect((await db.select().from(recruiterGrant))[0]!.status).toBe("active");
  });

  it("IT-071 sessão emprestada no candidato: conceder, revogar, reenviar, cancelar, dispensar e mudar a data são negados", async () => {
    const admin = await login("admin@x.com", ["admin"], null);
    const owner = await login("ana@x.com", ["candidate"], seven);
    boundary.token = owner.token;
    expect(await grantRecruiterAccessAction(form({ email: "rui@x.com", endDate: "", tz: "" }))).toEqual({ ok: true, kind: "grant" });
    expect(await grantRecruiterAccessAction(form({ email: "bia@y.com", endDate: "", tz: "" }))).toEqual({ ok: true, kind: "invite" });
    const [grant] = await db.select().from(recruiterGrant);
    const [invite] = await db.select().from(recruiterInvite);

    const borrowed = await beginImpersonation(await resolveSession(admin.token), owner.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);
    boundary.token = borrowed.token;
    const before = await rows();
    boundary.effects = [];

    const calls = [
      () => grantRecruiterAccessAction(form({ email: "caio@y.com", endDate: "", tz: "" })),
      () => revokeRecruiterAccessAction(form({ grantId: grant!.id })),
      () => setGrantEndDateAction(form({ grantId: grant!.id, endDate: "2026-12-01", tz: "UTC" })),
      () => resendInviteAction(form({ inviteId: invite!.id })),
      () => cancelInviteAction(form({ inviteId: invite!.id })),
      () => dismissInviteAction(form({ inviteId: invite!.id })),
    ];
    for (const call of calls) expect(await outcome(call)).toMatch(/^negado: access:manage — sessão emprestada/);
    expect(boundary.effects).toEqual([]);
    expect(await rows()).toEqual(before);
  });

  it("IT-072 candidateId no formulário é ignorado: a concessão é do candidato da sessão", async () => {
    const owner = await login("ana@x.com", ["candidate"], seven);
    boundary.token = owner.token;
    await grantRecruiterAccessAction(form({ email: "rui@x.com", endDate: "", tz: "", candidateId: nine }));
    const grants = await db.select().from(recruiterGrant);
    expect(grants.map((g) => g.candidateId)).toEqual([seven]);
  });

  it("IT-073 admin que também é candidato, fora de empréstimo, concede no próprio perfil", async () => {
    const both = await login("dona@x.com", ["admin", "candidate"], nine);
    boundary.token = both.token;
    expect(await grantRecruiterAccessAction(form({ email: "rui@x.com", endDate: "", tz: "" }))).toEqual({ ok: true, kind: "grant" });
    expect((await db.select().from(recruiterGrant)).map((g) => g.candidateId)).toEqual([nine]);
    expect(boundary.effects).toEqual(["revalidatePath(/account)"]);
    // O e-mail saiu pelo sink, com o link montado na origem local.
    const [file] = readdirSync(sink).filter((name) => name.endsWith(".json")).sort().reverse();
    expect(JSON.parse(readFileSync(join(sink, file!), "utf8")).text).toContain(`http://127.0.0.1:3000/recruiter/${nine}`);
  });

  it("IT-077 sessão vencida: as actions negam sem gravar, e a página leva ao login", async () => {
    const owner = await login("ana@x.com", ["candidate"], seven);
    await db.update(authSession).set({ expiresAt: "2000-01-01T00:00:00.000Z" });
    boundary.token = owner.token;
    const before = await rows();

    expect(await outcome(() => grantRecruiterAccessAction(form({ email: "rui@x.com", endDate: "", tz: "" })))).toMatch(DENIED);
    expect(await outcome(() => revokeRecruiterAccessAction(form({ grantId: 1 })))).toMatch(DENIED);
    expect(await rows()).toEqual(before);
    expect(await outcome(() => requireSession())).toBe("NEXT_REDIRECT;/login");
  });
});

describe("a seção em Minha conta", () => {
  const view: CandidateAccessView = {
    grants: [
      {
        id: 1,
        recruiterEmail: "rui@x.com",
        recruiterName: "Rui <i>E2E</i>",
        display: "active",
        createdAt: "2026-10-06T12:00:00.000Z",
        expiresAt: null,
        expiryTz: null,
        lastAccessedAt: null,
      },
    ],
    invites: [
      {
        id: 2,
        email: "bia@y.com",
        createdAt: "2026-10-06T12:00:00.000Z",
        expiresAt: "2026-10-13T12:00:00.000Z",
        accessExpiresAt: null,
        expiryTz: null,
        status: "pending",
        deliveryFailed: true,
      },
    ],
    history: {
      rows: [
        { id: 9, kind: "access_revoked", actor: "admin", actorName: "Dona Admin", recruiterEmail: "x@x.com", detail: null, at: "2026-10-06T12:00:00.000Z" },
        { id: 8, kind: "end_date_changed", actor: "candidate", actorName: null, recruiterEmail: "rui@x.com", detail: "none", at: "2026-10-06T11:00:00.000Z" },
      ],
      page: 1,
      pages: 2,
      total: 21,
    },
  };
  const ACTIONS = [
    "recruiter-access-form",
    "recruiter-grant-revoke",
    "recruiter-grant-save-end",
    "recruiter-invite-resend",
    "recruiter-invite-cancel",
  ];

  it("IT-075 candidato: declaração de escopo, formulário, lista, convites e histórico com dado de usuário como texto", () => {
    const html = renderToStaticMarkup(createElement(RecruiterAccessSection, { view, borrowed: false, t, locale: "pt-BR" }));
    expect(html).toContain('data-testid="recruiter-access-scope"');
    expect(html).toContain(t("recruiterAccess.scopeNever"));
    for (const id of ACTIONS) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain("Rui &lt;i&gt;E2E&lt;/i&gt;");
    expect(html).toContain(t("recruiterAccess.statusActive"));
    expect(html).toContain(t("recruiterAccess.noEnd"));
    expect(html).toContain(t("recruiterAccess.neverAccessed"));
    expect(html).toContain(t("recruiterAccess.deliveryFailed"));
    expect(html).toMatch(/por um administrador \(<span data-user-content="true">Dona Admin<\/span>\)/);
    expect(html).toContain("não termina mais em uma data");
    expect(html).toContain('data-testid="recruiter-access-history-older"');
    expect(html).not.toContain('data-testid="recruiter-access-history-newer"');
  });

  it("IT-075 sessão emprestada: lista e histórico sem nenhum formulário nem botão", () => {
    const html = renderToStaticMarkup(createElement(RecruiterAccessSection, { view, borrowed: true, t, locale: "pt-BR" }));
    expect(html).toContain('data-testid="recruiter-access-borrowed"');
    expect(html).toContain('data-testid="recruiter-grant"');
    expect(html).toContain('data-testid="recruiter-access-history"');
    for (const id of ACTIONS) expect(html).not.toContain(`data-testid="${id}"`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("IT-075 vazio: sem ninguém com acesso e nada no histórico", () => {
    const empty: CandidateAccessView = { grants: [], invites: [], history: { rows: [], page: 1, pages: 1, total: 0 } };
    const html = renderToStaticMarkup(createElement(RecruiterAccessSection, { view: empty, borrowed: false, t, locale: "pt-BR" }));
    expect(html).toContain(t("recruiterAccess.empty"));
    expect(html).toContain(t("recruiterAccess.historyEmpty"));
  });

  it("IT-075 recrutador sem candidato não tem a seção: sem escopo, e a leitura é negada", async () => {
    const recruiter = await resolveSession((await login("so-recrutador@x.com", ["recruiter"], null)).token);
    expect(candidateScope(recruiter)).toBeNull();
    expect(() => recruiterAccessView(recruiter!, 1)).toThrow(/negado: candidate:read/);
  });
});

describe("superfície", () => {
  it("IT-076 a CLI não tem verbo de conceder nem de convidar", () => {
    const cli = stripComments(readFileSync("src/cli.ts", "utf8"));
    const commands = [...cli.matchAll(/\.command\("([^"]+)"/g)].map((match) => match[1]!);
    expect(commands.length).toBeGreaterThan(20);
    expect(commands.filter((name) => /grant|invite/i.test(name))).toEqual([]);
  });

  it("IT-078 o inventário vê as actions novas, cada uma guardada primeiro pela ação certa", () => {
    const { serverModules, pages } = discoverEntries();
    const guards: Record<string, Record<string, RegExp>> = {
      "app/account/recruiter-access-actions.ts": Object.fromEntries(
        [
          "grantRecruiterAccessAction",
          "revokeRecruiterAccessAction",
          "setGrantEndDateAction",
          "resendInviteAction",
          "cancelInviteAction",
          "dismissInviteAction",
        ].map((name) => [name, /await guardOwnCandidate\("access:manage"\)/]),
      ),
      "app/admin/actions.ts": {
        adminRevokeGrantAction: /await guard\("user:manage"\)/,
        adminCancelInviteAction: /await guard\("user:manage"\)/,
      },
    };
    for (const [file, expected] of Object.entries(guards)) {
      expect(serverModules).toContain(file);
      const source = readFileSync(file, "utf8");
      const exported = exportedBindings(source).map((binding) => binding.exported);
      for (const [name, guard] of Object.entries(expected)) {
        expect(exported).toContain(name);
        expect(guardComesFirst(source, name)).toEqual({ ok: true });
        const body = source.slice(source.indexOf(`function ${name}(`));
        expect(body.slice(0, body.indexOf("\n}"))).toMatch(guard);
      }
    }
    // Na administração, concessão e convite só aparecem para revogar e cancelar.
    const admin = exportedBindings(readFileSync("app/admin/actions.ts", "utf8")).map((binding) => binding.exported);
    expect(admin.filter((name) => /grant|invite|link/i.test(name))).toEqual(["adminRevokeGrantAction", "adminCancelInviteAction"]);
    expect(pages).toContain("app/account/page.tsx");
    expect(readFileSync("app/account/page.tsx", "utf8")).toContain('await requirePage("account:read")');
  });
});
