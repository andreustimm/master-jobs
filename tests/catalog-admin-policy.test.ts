/**
 * UT-009 — Plataformas e Execuções só para admin (#223, tarefa 03).
 *
 * As telas e as actions do catálogo usam `admin:access`, e a política nega
 * candidato, recrutador e sessão emprestada — inclusive a de um admin
 * assumindo outro admin — antes de qualquer efeito. A prova de que cada
 * action NEGA de verdade antes de revalidar ou gravar é de
 * `tests/entry-denial.test.ts`, que descobre as actions pelo inventário; aqui
 * fica a política e a ordem textual do guarda nos arquivos novos.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { can } from "../src/contexts/auth/domain/policy.ts";
import type { Session } from "../src/contexts/auth/domain/types.ts";

const base: Session = {
  id: "s",
  userId: 7,
  email: "x@local.test",
  roles: [],
  candidateId: null,
  linkedCandidateIds: [],
  impersonatedBy: null,
  expiresAt: "2999-01-01T00:00:00.000Z",
} as unknown as Session;

const session = (patch: Partial<Session>): Session => ({ ...base, ...patch }) as Session;

describe("UT-009 política do catálogo", () => {
  it("admin passa", () => {
    expect(can(session({ roles: ["admin"] }), "admin:access").allowed).toBe(true);
  });

  it("candidato e recrutador são negados", () => {
    expect(can(session({ roles: ["candidate"], candidateId: 1 }), "admin:access").allowed).toBe(false);
    expect(can(session({ roles: ["recruiter"] }), "admin:access").allowed).toBe(false);
  });

  it("sessão emprestada é negada mesmo quando o alvo é admin", () => {
    expect(can(session({ roles: ["admin"], impersonatedBy: 1 } as Partial<Session>), "admin:access").allowed).toBe(false);
    expect(can(session({ roles: ["candidate"], candidateId: 1, impersonatedBy: 1 } as Partial<Session>), "admin:access").allowed).toBe(false);
  });

  it("sem sessão é negado", () => {
    expect(can(null, "admin:access").allowed).toBe(false);
  });
});

describe("UT-009 guarda antes de qualquer efeito nas entradas novas", () => {
  const PAGES = [
    "app/admin/plataformas/page.tsx",
    "app/admin/plataformas/[id]/page.tsx",
    "app/admin/execucoes/page.tsx",
    "app/admin/execucoes/[id]/page.tsx",
  ];
  const ACTIONS = ["app/admin/plataformas/actions.ts", "app/admin/execucoes/actions.ts"];

  it("toda página chama requirePage(\"admin:access\") antes de ler dado", () => {
    for (const file of PAGES) {
      const text = readFileSync(file, "utf8");
      const guardAt = text.indexOf('await requirePage("admin:access")');
      expect(guardAt, file).toBeGreaterThan(0);
      for (const read of ["catalogSource", "catalogSources(", "sourceRuns(", "sourceRun("]) {
        const at = text.indexOf(`await ${read}`);
        if (at >= 0) expect(at, `${file}: ${read}`).toBeGreaterThan(guardAt);
      }
    }
  });

  it("toda action exportada começa pelo guard(\"admin:access\")", () => {
    for (const file of ACTIONS) {
      const text = readFileSync(file, "utf8");
      const bodies = text.split(/export async function /).slice(1);
      expect(bodies.length, file).toBeGreaterThan(0);
      for (const body of bodies) {
        const name = body.slice(0, body.indexOf("("));
        const firstAwait = body.indexOf("await ");
        expect(body.slice(firstAwait, firstAwait + 40), `${file}: ${name}`).toMatch(/^await guard\("admin:access"\)/);
      }
    }
  });
});
