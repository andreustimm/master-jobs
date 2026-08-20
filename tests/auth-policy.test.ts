import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  authorize,
  can,
  canReadPublicProfile,
  candidateScope,
} from "../src/contexts/auth/domain/policy.ts";
import {
  ACTIONS,
  ADMIN_ACTIONS,
  type Action,
  type Role,
  type Session,
} from "../src/contexts/auth/domain/types.ts";

/**
 * A matriz de permissões, exaustivamente.
 *
 * É o teste de segurança mais barato que existe: a decisão é função pura, então
 * toda combinação de papel, ação, posse e visibilidade pode ser afirmada sem
 * banco, sem servidor e sem browser.
 */

const NOW = Date.parse("2026-08-20T12:00:00Z");
const LATER = "2026-09-20T12:00:00Z";
const EARLIER = "2026-08-19T12:00:00Z";

function session(over: Partial<Session> & { roles: Role[] }): Session {
  return {
    userId: 1,
    candidateId: null,
    email: "quem@local.test",
    expiresAt: LATER,
    linkedCandidateIds: [],
    impersonatedBy: null,
    ...over,
  };
}

const candidate = (candidateId: number | null = 1) =>
  session({ roles: ["candidate"], candidateId });
const admin = () => session({ roles: ["admin"], userId: 9 });
const recruiter = (linked: number[] = []) =>
  session({ roles: ["recruiter"], userId: 7, linkedCandidateIds: linked });

const own = { kind: "candidate" as const, candidateId: 1 };
const other = { kind: "candidate" as const, candidateId: 2 };

describe("sem sessão e sessão expirada", () => {
  it("nega tudo sem sessão", () => {
    for (const action of ACTIONS) {
      expect(can(null, action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });

  it("nega tudo com sessão expirada", () => {
    const dead = session({ roles: ["admin", "candidate"], candidateId: 1, expiresAt: EARLIER });
    for (const action of ACTIONS) {
      expect(can(dead, action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });

  it("trata expiração ilegível como expirada", () => {
    const broken = session({ roles: ["admin"], expiresAt: "não é data" });
    expect(can(broken, "admin:access", { kind: "global" }, NOW).allowed).toBe(false);
  });
});

describe("admin", () => {
  it("administra a instalação", () => {
    for (const action of ADMIN_ACTIONS) {
      expect(can(admin(), action, { kind: "global" }, NOW).allowed).toBe(true);
    }
  });

  it("NÃO lê dado privado de candidato, nem com escopo casando", () => {
    // O invariante deste sistema: admin cura o catálogo, não vira superusuário
    // de currículo. Para ver dado privado ele assume a identidade, e assumir
    // deixa registro.
    const associated = session({ roles: ["admin"], candidateId: 1 });
    expect(can(associated, "candidate:read", own, NOW).allowed).toBe(false);
    expect(can(associated, "candidate:write", own, NOW).allowed).toBe(false);
    expect(can(associated, "application:write", own, NOW).allowed).toBe(false);
  });
});

describe("candidate", () => {
  it("lê e escreve o próprio dado", () => {
    for (const action of ["candidate:read", "candidate:write", "application:write"] as Action[]) {
      expect(can(candidate(1), action, own, NOW).allowed).toBe(true);
    }
  });

  it("não alcança o dado de outro candidato", () => {
    for (const action of ["candidate:read", "candidate:write", "application:write"] as Action[]) {
      expect(can(candidate(1), action, other, NOW).allowed).toBe(false);
    }
  });

  it("recurso global não é atalho para escopo de candidato", () => {
    // Sem esta regra, um chamador que esquecesse o escopo receberia acesso.
    expect(can(candidate(1), "candidate:read", { kind: "global" }, NOW).allowed).toBe(false);
  });

  it("não administra", () => {
    for (const action of ADMIN_ACTIONS) {
      expect(can(candidate(1), action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });
});

describe("recruiter", () => {
  it("lê o candidato que acompanha", () => {
    expect(can(recruiter([1]), "candidate:read", own, NOW).allowed).toBe(true);
  });

  it("não lê o candidato que não acompanha", () => {
    expect(can(recruiter([3]), "candidate:read", own, NOW).allowed).toBe(false);
  });

  it("acompanha não é editar", () => {
    // O funil registra decisão de uma pessoa; mover o de outro seria falsificar.
    expect(can(recruiter([1]), "candidate:write", own, NOW).allowed).toBe(false);
    expect(can(recruiter([1]), "application:write", own, NOW).allowed).toBe(false);
  });

  it("cadastra vaga no acervo global", () => {
    expect(can(recruiter(), "job:write", { kind: "global" }, NOW).allowed).toBe(true);
    expect(can(recruiter(), "job:read", { kind: "global" }, NOW).allowed).toBe(true);
  });

  it("não administra", () => {
    for (const action of ADMIN_ACTIONS) {
      expect(can(recruiter(), action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });
});

describe("visibilidade do perfil", () => {
  it("privado é o padrão: campo ausente não abre nada", () => {
    // Esquecer de carregar a visibilidade tem de NEGAR, nunca permitir.
    expect(can(recruiter(), "candidate:read", other, NOW).allowed).toBe(false);
  });

  it("`recruiters` abre para qualquer recrutador autenticado", () => {
    const resource = { ...other, visibility: "recruiters" as const };
    expect(can(recruiter(), "candidate:read", resource, NOW).allowed).toBe(true);
    // ...e não abre para candidato alheio nem para admin.
    expect(can(candidate(1), "candidate:read", resource, NOW).allowed).toBe(false);
    expect(can(admin(), "candidate:read", resource, NOW).allowed).toBe(false);
  });

  it("`public` abre a leitura para qualquer sessão", () => {
    const resource = { ...other, visibility: "public" as const };
    expect(can(candidate(1), "candidate:read", resource, NOW).allowed).toBe(true);
    expect(can(recruiter(), "candidate:read", resource, NOW).allowed).toBe(true);
  });

  it("visibilidade nunca abre ESCRITA", () => {
    const resource = { ...other, visibility: "public" as const };
    expect(can(candidate(1), "candidate:write", resource, NOW).allowed).toBe(false);
    expect(can(recruiter(), "candidate:write", resource, NOW).allowed).toBe(false);
  });

  it("leitura anônima só existe para perfil público", () => {
    expect(canReadPublicProfile("public").allowed).toBe(true);
    expect(canReadPublicProfile("recruiters").allowed).toBe(false);
    expect(canReadPublicProfile("private").allowed).toBe(false);
    expect(canReadPublicProfile(undefined).allowed).toBe(false);
  });

  it("`can()` continua negando quem não tem sessão, mesmo em perfil público", () => {
    // O caminho anônimo é `canReadPublicProfile`, e é separado de propósito:
    // afrouxar a primeira linha de `can()` abriria buraco em toda ação.
    const resource = { ...other, visibility: "public" as const };
    expect(can(null, "candidate:read", resource, NOW).allowed).toBe(false);
  });
});

describe("impersonação", () => {
  it("sessão emprestada não executa ação de administração", () => {
    const borrowed = session({ roles: ["candidate"], candidateId: 2, impersonatedBy: 9 });
    for (const action of ADMIN_ACTIONS) {
      expect(can(borrowed, action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });

  it("admin assumindo OUTRO ADMIN também perde a administração", () => {
    // O caso que uma checagem baseada em papel deixaria passar: a sessão
    // emprestada carrega papel `admin` porque o alvo é admin. Se a negativa
    // dependesse do papel, o primeiro admin operaria a instalação com a cara do
    // segundo, e o registro não os separaria.
    const borrowed = session({ roles: ["admin"], userId: 5, impersonatedBy: 9 });
    for (const action of ADMIN_ACTIONS) {
      const decision = can(borrowed, action, { kind: "global" }, NOW);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toContain("emprestada");
    }
  });

  it("mas alcança o dado do candidato assumido — que é o ponto", () => {
    const borrowed = session({ roles: ["candidate"], candidateId: 2, impersonatedBy: 9 });
    expect(can(borrowed, "candidate:read", other, NOW).allowed).toBe(true);
    expect(can(borrowed, "candidate:write", other, NOW).allowed).toBe(true);
  });

  it("e não alcança o dado de um terceiro", () => {
    const borrowed = session({ roles: ["candidate"], candidateId: 2, impersonatedBy: 9 });
    expect(can(borrowed, "candidate:read", { kind: "candidate", candidateId: 3 }, NOW).allowed)
      .toBe(false);
  });
});

describe("deny by default", () => {
  it("ação desconhecida é negada", () => {
    const decision = can(admin(), "nope:nope" as Action, { kind: "global" }, NOW);
    expect(decision.allowed).toBe(false);
  });

  it("papel vazio não recebe nada", () => {
    const nobody = session({ roles: [] });
    for (const action of ACTIONS) {
      expect(can(nobody, action, { kind: "global" }, NOW).allowed).toBe(false);
    }
  });
});

describe("authorize", () => {
  it("lança em negativa e é silencioso em permissão", () => {
    expect(() => authorize(admin(), "admin:access", { kind: "global" }, NOW)).not.toThrow();
    expect(() => authorize(candidate(1), "admin:access", { kind: "global" }, NOW)).toThrow(
      AuthorizationError,
    );
  });
});

describe("candidateScope", () => {
  it("vem da sessão, e é null sem sessão", () => {
    expect(candidateScope(candidate(7))).toBe(7);
    expect(candidateScope(null)).toBeNull();
    expect(candidateScope(admin())).toBeNull();
  });
});
