/**
 * Suíte: formas de entrar, a parte pura (#464, US-008–US-011, ADR-004).
 *
 * Invariante: sessão emprestada não mexe nas formas de entrar; o último método
 * não sai; a primeira senha segue a regra de sempre; a vista da conta mostra
 * só provedor, datas, origem e disponibilidade; admin não tem ação de ligar
 * provedor alheio, e quem não é admin não administra contas.
 * Fronteira DENTRO: `can()`, `canDisconnect`, `methodsView` e o serviço
 * `setFirstPassword` com store dublado.
 * Fronteira FORA: banco, trava de linha e telas (`auth-account-methods.test.ts`
 * e E2E `account-methods`).
 */
import { describe, expect, it } from "vitest";
import { setFirstPassword } from "../src/contexts/auth/app/account-methods.ts";
import { canDisconnect, methodsView, type IdentityRecord } from "../src/contexts/auth/domain/methods.ts";
import { can } from "../src/contexts/auth/domain/policy.ts";
import { ACTIONS, type Action, type Role, type Session } from "../src/contexts/auth/domain/types.ts";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

function session(over: Partial<Session> = {}): Session {
  return {
    userId: 1,
    candidateId: null,
    roles: ["candidate"],
    email: "ana@x.com",
    fullName: null,
    expiresAt: "2026-11-01T00:00:00.000Z",
    linkedCandidateIds: [],
    impersonatedBy: null,
    ...over,
  };
}

describe("política das formas de entrar", () => {
  it("UT-090 sessão emprestada não mexe nas formas de entrar, qualquer que seja o papel do alvo", () => {
    for (const roles of [["candidate"], ["recruiter"], ["admin"], ["admin", "candidate"]] as Role[][]) {
      const borrowed = session({ roles, impersonatedBy: 99 });
      expect(can(borrowed, "account:manage-methods", { kind: "global" }, NOW)).toEqual({
        allowed: false,
        reason: "sessão emprestada não mexe nas formas de entrar do alvo",
      });
    }
    // A própria sessão, de qualquer papel, pode.
    for (const roles of [["candidate"], ["recruiter"], ["admin"]] as Role[][]) {
      expect(can(session({ roles }), "account:manage-methods", { kind: "global" }, NOW).allowed).toBe(true);
    }
    expect(can(null, "account:manage-methods", { kind: "global" }, NOW).allowed).toBe(false);
    expect(can(session({ roles: [] }), "account:manage-methods", { kind: "global" }, NOW).allowed).toBe(false);
  });

  it("UT-095 admin não tem ação de ligar provedor alheio; quem não é admin não administra contas", () => {
    // Não existe ação de ligar provedor em conta de outra pessoa: nem na lista,
    // nem como string — o nome inventado cai no "deny by default".
    expect(ACTIONS.filter((action) => /link|identity/.test(action))).toEqual([]);
    const admin = session({ roles: ["admin"], userId: 9 });
    expect(can(admin, "identity:link-for-other" as Action, { kind: "global" }, NOW).allowed).toBe(false);
    // Desligar provedor de outra conta é administração (`user:manage`).
    expect(can(admin, "user:manage", { kind: "global" }, NOW).allowed).toBe(true);
    for (const roles of [["candidate"], ["recruiter"]] as Role[][]) {
      expect(can(session({ roles }), "user:manage", { kind: "global" }, NOW).allowed).toBe(false);
    }
    // E admin em sessão emprestada perde a administração (US-011.EC-2).
    expect(can(session({ roles: ["admin"], impersonatedBy: 3 }), "user:manage", { kind: "global" }, NOW).allowed).toBe(
      false,
    );
  });
});

describe("último método (ADR-004)", () => {
  it("UT-091 sem senha e só LinkedIn: não desliga; com senha, desliga", () => {
    expect(canDisconnect({ hasPassword: false, providers: ["linkedin"] }, "linkedin")).toBe(false);
    expect(canDisconnect({ hasPassword: true, providers: ["linkedin"] }, "linkedin")).toBe(true);
    // Outro provedor também é porta.
    expect(canDisconnect({ hasPassword: false, providers: ["google", "linkedin"] }, "linkedin")).toBe(true);
    // Provedor que não está ligado não tem o que desligar.
    expect(canDisconnect({ hasPassword: true, providers: ["linkedin"] }, "google")).toBe(false);
  });
});

describe("primeira senha (US-009)", () => {
  function deps() {
    const writes: string[] = [];
    const events: string[] = [];
    return {
      writes,
      events,
      deps: {
        store: {
          accountMethods: async () => null,
          unlinkIdentityChecked: async () => "unlinked" as const,
          setFirstPassword: async (_userId: number, hash: string) => (writes.push(hash), true),
        },
        repository: { record: async (input: { kind: string }) => void events.push(input.kind), findUserId: async () => null },
        hashPassword: async (password: string) => `hash(${password.length})`,
      },
    };
  }

  it("UT-092 11 caracteres: weak_password, sem escrita; 12: ok", async () => {
    const short = deps();
    await expect(
      setFirstPassword({ userId: 1, email: "ana@x.com", password: "a".repeat(11) }, short.deps),
    ).resolves.toEqual({ ok: false, error: "weak_password" });
    expect(short.writes).toEqual([]);
    expect(short.events).toEqual([]);

    const ok = deps();
    await expect(
      setFirstPassword({ userId: 1, email: "ana@x.com", password: "a".repeat(12) }, ok.deps),
    ).resolves.toEqual({ ok: true });
    expect(ok.writes).toEqual(["hash(12)"]);
    expect(ok.events).toEqual(["password_set"]);
  });

  it("conta que já tem senha recusa com has_password e não registra nada", async () => {
    const has = deps();
    has.deps.store.setFirstPassword = async () => false;
    await expect(
      setFirstPassword({ userId: 1, email: "ana@x.com", password: "senha-de-doze-ou-mais" }, has.deps),
    ).resolves.toEqual({ ok: false, error: "has_password" });
    expect(has.events).toEqual([]);
  });
});

describe("a vista dos métodos (US-010)", () => {
  const linkedin: IdentityRecord = {
    provider: "linkedin",
    origin: "manual",
    linkedAt: "2026-10-01T10:00:00.000Z",
    lastUsedAt: null,
  };

  it("UT-093 ligado e nunca usado mostra 'never'; ligado fora da lista do ambiente fica 'não disponível aqui'", () => {
    const view = methodsView({ hasPassword: false, identities: [linkedin] }, ["google"]);
    expect(view).toEqual({
      password: false,
      providers: [
        { provider: "google", linked: false, availableHere: true },
        {
          provider: "linkedin",
          linked: true,
          origin: "manual",
          linkedAt: "2026-10-01T10:00:00.000Z",
          lastUsed: "never",
          availableHere: false,
        },
      ],
    });
    const used = methodsView(
      { hasPassword: true, identities: [{ ...linkedin, lastUsedAt: "2026-10-05T09:00:00.000Z" }] },
      ["google", "linkedin"],
    );
    expect(used.providers[1]).toMatchObject({ lastUsed: "2026-10-05T09:00:00.000Z", availableHere: true });
    expect(used.password).toBe(true);
  });

  it("UT-094 só provedor, datas, origem e disponibilidade — nada do perfil do provedor", () => {
    // O registro chega com campos que a vista não pode repassar.
    const leaky = {
      ...linkedin,
      subject: "li-sujeito-secreto",
      emailAtLink: "outra@y.com",
      name: "Ana do LinkedIn",
      picture: "https://media.licdn.com/foto.jpg",
      accessToken: "tok",
    } as IdentityRecord;
    const view = methodsView({ hasPassword: true, identities: [leaky] }, ["linkedin"]);
    const linked = view.providers.find((item) => item.provider === "linkedin")!;
    expect(Object.keys(linked).sort()).toEqual(
      ["availableHere", "lastUsed", "linked", "linkedAt", "origin", "provider"].sort(),
    );
    expect(Object.keys(view).sort()).toEqual(["password", "providers"]);
    const serialized = JSON.stringify(view);
    for (const secret of ["li-sujeito-secreto", "outra@y.com", "Ana do LinkedIn", "licdn", "tok\""]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
