import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMPERSONATION_HOURS,
  startImpersonation,
  stopImpersonation,
  type ImpersonationDeps,
} from "../src/contexts/auth/app/impersonation.ts";
import { AuthorizationError } from "../src/contexts/auth/domain/policy.ts";
import type { Role, Session } from "../src/contexts/auth/domain/types.ts";
import type { UserSummary } from "../src/contexts/auth/ports.ts";

/**
 * Assumir identidade é a única porta do admin para dado privado alheio.
 *
 * Uma porta assim precisa de duas garantias, e as duas estão travadas aqui: que
 * ela não escala privilégio, e que ninguém passa por ela em silêncio.
 */

const NOW = Date.parse("2026-08-20T12:00:00Z");

function session(over: Partial<Session> & { roles: Role[] }): Session {
  return {
    userId: 1,
    candidateId: null,
    email: "quem@local.test",
    fullName: null,
    expiresAt: "2026-09-20T12:00:00Z",
    linkedCandidateIds: [],
    impersonatedBy: null,
    ...over,
  };
}

const ADMIN = session({ roles: ["admin"], userId: 9, email: "admin@local.test" });

function user(over: Partial<UserSummary> & { id: number }): UserSummary {
  return {
    email: `u${over.id}@local.test`,
    fullName: null,
    roles: ["candidate"],
    candidateId: over.id,
    disabledAt: null,
    createdAt: "2026-08-01T00:00:00Z",
    hasPassword: true,
    ...over,
  };
}

function deps(users: UserSummary[]): ImpersonationDeps & {
  created: { userId: number; expiresAt: string; impersonatedBy?: number | null }[];
  events: { kind: string; detail?: string }[];
  revoked: string[];
} {
  const created: { userId: number; expiresAt: string; impersonatedBy?: number | null }[] = [];
  const events: { kind: string; detail?: string }[] = [];
  const revoked: string[] = [];
  return {
    created,
    events,
    revoked,
    sessions: {
      create: async (input) => {
        created.push(input);
        return `token-${input.userId}`;
      },
      resolve: async () => null,
      revoke: async (t) => {
        revoked.push(t);
      },
      revokeAllFor: async () => 0,
      purgeExpired: async () => 0,
    },
    users: {
      list: async () => users,
      find: async (id) => users.find((u) => u.id === id) ?? null,
      create: async () => ({ id: 0 }),
      updateRoles: async () => {},
      update: async () => {},
      remove: async () => {},
      setDisabled: async () => {},
      linkedCandidates: async () => [],
      linksOf: async () => [],
      linkCandidate: async () => {},
      unlinkById: async () => {},
    },
    audit: {
      record: async (e) => {
        events.push({ kind: e.kind, detail: e.detail });
      },
      findUserId: async () => null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("startImpersonation", () => {
  it("cria sessão marcada com quem assumiu", async () => {
    const d = deps([user({ id: 2 })]);
    const result = await startImpersonation(ADMIN, 2, d);

    expect(result.ok).toBe(true);
    expect(d.created[0]).toMatchObject({ userId: 2, impersonatedBy: 9 });
  });

  it("a sessão emprestada vive uma hora, não trinta dias", async () => {
    const d = deps([user({ id: 2 })]);
    await startImpersonation(ADMIN, 2, d);

    // Assumir identidade é diagnóstico, não modo de trabalho. Uma credencial
    // de acesso a dado alheio esquecida aberta por um mês é risco sem troca.
    const lifetime = Date.parse(d.created[0]!.expiresAt) - NOW;
    expect(lifetime).toBe(IMPERSONATION_HOURS * 3_600_000);
  });

  it("registra quem assumiu de quem", async () => {
    const d = deps([user({ id: 2, email: "alvo@local.test" })]);
    await startImpersonation(ADMIN, 2, d);

    // Acesso a currículo alheio que não aparece em lugar nenhum é
    // indistinguível de vazamento.
    expect(d.events).toHaveLength(1);
    expect(d.events[0]!.kind).toBe("impersonation_start");
    expect(d.events[0]!.detail).toContain("alvo@local.test");
  });

  it("recusa quem não é admin, sem escrever nada", async () => {
    const d = deps([user({ id: 2 })]);
    const candidate = session({ roles: ["candidate"], candidateId: 1 });

    await expect(startImpersonation(candidate, 2, d)).rejects.toThrow(AuthorizationError);
    expect(d.created).toHaveLength(0);
    expect(d.events).toHaveLength(0);
  });

  it("recusa sem sessão", async () => {
    const d = deps([user({ id: 2 })]);
    await expect(startImpersonation(null, 2, d)).rejects.toThrow(AuthorizationError);
  });

  it("NÃO permite cadeia: quem já está emprestado não assume ninguém", async () => {
    // A sessão emprestada carrega papel `admin` quando o alvo é admin. Se a
    // negativa dependesse do papel, um admin encadearia identidades e o
    // registro mostraria só o primeiro salto.
    const d = deps([user({ id: 3 })]);
    const borrowed = session({ roles: ["admin"], userId: 5, impersonatedBy: 9 });

    await expect(startImpersonation(borrowed, 3, d)).rejects.toThrow(AuthorizationError);
    expect(d.created).toHaveLength(0);
  });

  it("recusa conta desabilitada", async () => {
    const d = deps([user({ id: 2, disabledAt: "2026-08-10T00:00:00Z" })]);
    const result = await startImpersonation(ADMIN, 2, d);

    // Seria porta dos fundos para operar como alguém que o sistema já decidiu
    // que não entra.
    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(d.created).toHaveLength(0);
  });

  it("recusa alvo inexistente e recusa assumir a si mesmo", async () => {
    const d = deps([user({ id: 2 })]);
    expect(await startImpersonation(ADMIN, 404, d)).toEqual({ ok: false, reason: "not-found" });
    expect(await startImpersonation(ADMIN, 9, d)).toEqual({ ok: false, reason: "self" });
    expect(d.created).toHaveLength(0);
  });
});

describe("stopImpersonation", () => {
  it("revoga no servidor e registra o fim", async () => {
    const d = deps([user({ id: 9, email: "admin@local.test", roles: ["admin"] })]);
    const borrowed = session({
      roles: ["candidate"],
      userId: 2,
      email: "alvo@local.test",
      impersonatedBy: 9,
    });

    await stopImpersonation(borrowed, "token-2", d);

    // Revogado no servidor, não apenas esquecido pelo navegador: um token que o
    // cliente apaga continua válido para quem o copiou.
    expect(d.revoked).toEqual(["token-2"]);
    expect(d.events[0]!.kind).toBe("impersonation_end");
    expect(d.events[0]!.detail).toContain("alvo@local.test");
  });

  it("revoga mesmo quando a sessão não era emprestada, mas não registra", async () => {
    const d = deps([]);
    await stopImpersonation(session({ roles: ["candidate"] }), "token-x", d);

    expect(d.revoked).toEqual(["token-x"]);
    expect(d.events).toHaveLength(0);
  });
});
