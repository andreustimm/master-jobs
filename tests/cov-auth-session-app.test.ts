import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import {
  SESSION_DAYS,
  beginLogin,
  completeLogin,
  isOpenMode,
  loginWithPassword,
  logout,
  revokeAllSessionsForEmail,
  singleUserSession,
  type AuthDeps,
} from "../src/contexts/auth/app/session.ts";
import { stopImpersonation, type ImpersonationDeps } from "../src/contexts/auth/app/impersonation.ts";
import type { Identity, UserSummary } from "../src/contexts/auth/ports.ts";

/**
 * Casos de uso de sessão, com as portas trocadas por dublês.
 *
 * A orquestração é curta, e é exatamente por isso que ela merece teste próprio:
 * o que este arquivo protege não é cálculo, é ORDEM e OMISSÃO. Autorizar antes
 * de escrever, nunca criar sessão num login que falhou, nunca deixar o segredo
 * escapar para o registro de auditoria. Com o banco real no meio, um erro de
 * ordem some dentro do ruído das consultas; com dublês, ele vira asserção.
 */

const NOW_ISO = "2026-08-20T12:00:00.000Z";

type Recorded = { kind: string; userId?: number | null; email?: string | null; detail?: string };

function identity(over: Partial<Identity> = {}): Identity {
  return {
    userId: 7,
    email: "pessoa@local.test",
    roles: ["candidate"],
    candidateId: 3,
    linkedCandidateIds: [],
    ...over,
  };
}

function makeDeps(over: {
  identity?: Partial<AuthDeps["identity"]>;
  passwords?: AuthDeps["passwords"];
  sessions?: Partial<AuthDeps["sessions"]>;
  findUserId?: (email: string) => Promise<number | null>;
} = {}) {
  const created: { userId: number; expiresAt: string; impersonatedBy?: number | null }[] = [];
  const events: Recorded[] = [];
  const revoked: string[] = [];
  const revokedAllFor: number[] = [];
  const begun: string[] = [];

  const deps: AuthDeps = {
    sessions: {
      create: async (input) => {
        created.push(input);
        return `sessao-${created.length}`;
      },
      resolve: async () => null,
      revoke: async (token) => {
        revoked.push(token);
      },
      revokeAllFor: async (userId) => {
        revokedAllFor.push(userId);
        return 3;
      },
      purgeExpired: async () => 0,
      ...over.sessions,
    },
    identity: {
      name: "dublê",
      begin: async (email) => {
        begun.push(email);
        return { token: "link-token", expiresAt: "2026-08-20T12:15:00.000Z" };
      },
      complete: async () => identity(),
      ...over.identity,
    },
    passwords: over.passwords ?? { verify: async () => ({ ok: false, reason: "invalid" }) },
    repository: {
      record: async (input) => {
        events.push(input);
      },
      findUserId: over.findUserId ?? (async () => null),
    },
  };

  return { deps, created, events, revoked, revokedAllFor, begun };
}

beforeEach(() => setClock(fixedClock(NOW_ISO)));
afterEach(() => resetClock());

describe("beginLogin", () => {
  it("delega ao provedor e NÃO cria sessão nenhuma antes de autenticar", async () => {
    // Uma sessão emitida no "começar login" seria uma credencial válida entregue
    // a quem só digitou um endereço de e-mail. O caso de uso não pode encostar
    // no `SessionStore` neste ponto — nem para preparar, nem para reservar.
    const d = makeDeps();
    const result = await beginLogin("  ALGUEM@Local.TEST ", d.deps);

    expect(result).toEqual({ token: "link-token", expiresAt: "2026-08-20T12:15:00.000Z" });
    expect(d.begun).toEqual(["  ALGUEM@Local.TEST "]);
    expect(d.created).toHaveLength(0);
    expect(d.events).toHaveLength(0);
  });
});

describe("completeLogin", () => {
  it("carrega os vínculos do recrutador para dentro da sessão", async () => {
    // A política deriva posse da SESSÃO e nunca de um id que o chamador mandou.
    // Se os vínculos não viessem resolvidos daqui, o ponto de uso teria de
    // aceitar um `candidateId` por parâmetro — que é declaração de vontade, não
    // prova de permissão.
    const d = makeDeps({
      identity: {
        complete: async () =>
          identity({ userId: 11, roles: ["recruiter"], candidateId: null, linkedCandidateIds: [4, 9] }),
      },
    });

    const result = await completeLogin("link-token", d.deps);
    expect(result!.session.linkedCandidateIds).toEqual([4, 9]);
    expect(result!.session.candidateId).toBeNull();
  });

  it("a sessão nasce com validade de SESSION_DAYS pelo relógio injetado", async () => {
    const d = makeDeps();
    const result = await completeLogin("link-token", d.deps);

    const lifetime = Date.parse(result!.session.expiresAt) - Date.parse(NOW_ISO);
    expect(lifetime).toBe(SESSION_DAYS * 86_400_000);
    expect(d.created[0]!.expiresAt).toBe(result!.session.expiresAt);
  });

  it("uma sessão criada por login NUNCA é marcada como emprestada", async () => {
    // `impersonatedBy` é o que faz a política negar administração em bloco. Se
    // o login comum o preenchesse, ou se a impersonação o deixasse vazio, os
    // dois tipos de sessão ficariam indistinguíveis — que é o mesmo que não ter
    // impersonação auditada.
    const d = makeDeps();
    const result = await completeLogin("link-token", d.deps);

    expect(result!.session.impersonatedBy).toBeNull();
    expect(d.created[0]!.impersonatedBy).toBeUndefined();
  });

  it("token recusado não vira sessão, e o registro não guarda o token", async () => {
    const d = makeDeps({ identity: { complete: async () => null } });

    expect(await completeLogin("token-roubado-abc123", d.deps)).toBeNull();
    expect(d.created).toHaveLength(0);
    // Registrar o valor tentado transformaria o log de auditoria em lista de
    // segredos — e log é o que as pessoas colam em issue.
    expect(JSON.stringify(d.events)).not.toContain("token-roubado-abc123");
    expect(d.events[0]!.kind).toBe("login_failed");
  });
});

describe("loginWithPassword", () => {
  it("emite sessão e registra o login sem citar a senha", async () => {
    const d = makeDeps({
      passwords: {
        verify: async () => ({ ok: true, identity: identity({ userId: 5, email: "dono@local.test" }) }),
      },
    });

    const result = await loginWithPassword("dono@local.test", "senha-secreta-longa", d.deps);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.token).toBe("sessao-1");
    expect(d.created[0]).toMatchObject({ userId: 5 });
    expect(d.events[0]).toMatchObject({ kind: "login", userId: 5, detail: "senha" });
    // O detalhe registra o MÉTODO, jamais o segredo.
    expect(JSON.stringify(d.events)).not.toContain("senha-secreta-longa");
  });

  it("a sessão de senha também nasce não-emprestada e com prazo padrão", async () => {
    const d = makeDeps({
      passwords: { verify: async () => ({ ok: true, identity: identity({ linkedCandidateIds: [2] }) }) },
    });

    const result = await loginWithPassword("pessoa@local.test", "x".repeat(20), d.deps);
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;

    expect(result.session.impersonatedBy).toBeNull();
    expect(result.session.linkedCandidateIds).toEqual([2]);
    expect(Date.parse(result.session.expiresAt) - Date.parse(NOW_ISO)).toBe(
      SESSION_DAYS * 86_400_000,
    );
  });

  it("credencial inválida não produz sessão nem evento de sucesso", async () => {
    // O caso de uso repassa a recusa exatamente como veio. Ele não pode
    // enriquecer o motivo: distinguir "conta não existe" de "senha errada" na
    // resposta transforma o formulário de login em oráculo de enumeração de
    // contas, e a infra já se dá ao trabalho de igualar os dois.
    const d = makeDeps({ passwords: { verify: async () => ({ ok: false, reason: "invalid" }) } });

    expect(await loginWithPassword("quem@local.test", "errada", d.deps)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(d.created).toHaveLength(0);
    expect(d.events).toHaveLength(0);
  });

  it("bloqueio por tentativas também não produz sessão", async () => {
    // O limite existe para tornar campanha sustentada impossível. Se o caso de
    // uso emitisse sessão mesmo assim, ou tratasse `rate_limited` como sucesso
    // parcial, o custo do scrypt teria sido pago à toa.
    const d = makeDeps({ passwords: { verify: async () => ({ ok: false, reason: "rate_limited" }) } });

    expect(await loginWithPassword("alvo@local.test", "tentativa", d.deps)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(d.created).toHaveLength(0);
  });
});

describe("logout", () => {
  it("revoga no servidor mesmo quando o token já não resolve", async () => {
    // Ordem importa: revogar acontece sempre, resolver serve só para saber o
    // que registrar. Se a revogação dependesse de a sessão existir, um token
    // expirado-mas-copiado ficaria sem revogação — e a coluna `revokedAt` é o
    // que sobrevive à mudança de relógio.
    const d = makeDeps({ sessions: { resolve: async () => null } });

    await logout("token-fantasma", d.deps);
    expect(d.revoked).toEqual(["token-fantasma"]);
    expect(d.events).toHaveLength(0);
  });

  it("registra a saída quando havia sessão", async () => {
    const d = makeDeps({
      sessions: {
        resolve: async () => ({
          userId: 5,
          candidateId: 3,
          roles: ["candidate"],
          email: "dono@local.test",
          expiresAt: "2026-09-19T12:00:00.000Z",
          linkedCandidateIds: [],
          impersonatedBy: null,
        }),
      },
    });

    await logout("token-vivo", d.deps);
    expect(d.events[0]).toMatchObject({ kind: "logout", userId: 5, email: "dono@local.test" });
  });
});

describe("revokeAllSessionsForEmail", () => {
  it("devolve null e NÃO revoga nada para endereço desconhecido", async () => {
    // Null significa "não havia conta", que é diferente de "revoguei zero
    // sessões". Se a função chamasse `revokeAllFor` com um id inventado, a
    // operação passaria a depender de qual id o banco resolveu reciclar.
    const d = makeDeps({ findUserId: async () => null });

    expect(await revokeAllSessionsForEmail("ninguem@local.test", d.deps)).toBeNull();
    expect(d.revokedAllFor).toHaveLength(0);
  });

  it("derruba todas as sessões da conta encontrada e diz quantas eram", async () => {
    // É a operação de emergência: suspeita de comprometimento derruba tudo de
    // uma vez, e o número é o que confirma para o operador que algo foi cortado.
    const d = makeDeps({ findUserId: async () => 42 });

    expect(await revokeAllSessionsForEmail("  DONO@Local.TEST ", d.deps)).toBe(3);
    expect(d.revokedAllFor).toEqual([42]);
  });
});

describe("modo aberto e sessão sintetizada", () => {
  it("só abre com o valor exato, e qualquer outra coisa exige autenticação", async () => {
    // Segurança por omissão: a omissão precisa ser a opção segura. Um `!==
    // "closed"` aqui abriria a instalação para qualquer variável mal digitada.
    expect(isOpenMode({})).toBe(false);
    expect(isOpenMode({ JHO_AUTH_MODE: "OPEN" })).toBe(false);
    expect(isOpenMode({ JHO_AUTH_MODE: "open " })).toBe(false);
    expect(isOpenMode({ JHO_AUTH_MODE: "open" })).toBe(true);
  });

  it("a sessão do modo aberto expira e não é emprestada", async () => {
    // Ela passa pelo MESMO guard do modo autenticado, então precisa ter os
    // mesmos campos preenchidos — inclusive `impersonatedBy: null`, senão a
    // política de administração leria `undefined` e decidiria sobre nada.
    const s = singleUserSession(4, Date.parse(NOW_ISO));

    expect(s.impersonatedBy).toBeNull();
    expect(s.linkedCandidateIds).toEqual([]);
    expect(Date.parse(s.expiresAt) - Date.parse(NOW_ISO)).toBe(86_400_000);
  });

  it("sem candidato, a sessão aberta não finge ter um perfil", async () => {
    expect(singleUserSession(null, Date.parse(NOW_ISO)).candidateId).toBeNull();
  });
});

describe("stopImpersonation quando o admin que assumiu não é mais encontrável", () => {
  it("registra o fim com e-mail nulo em vez de perder o evento", async () => {
    // Um acesso a dado alheio com começo registrado e sem fim registrado é
    // pior que registro nenhum: ele sugere que a sessão emprestada nunca foi
    // largada. Por isso o e-mail de quem assumiu é enfeite — o id é o que
    // rastreia, e a ausência do primeiro não pode cancelar o segundo.
    const eventos: { kind: string; email?: string | null; userId?: number | null; detail?: string }[] = [];
    const deps: ImpersonationDeps = {
      sessions: {
        create: async () => "x",
        resolve: async () => null,
        revoke: async () => {},
        revokeAllFor: async () => 0,
        purgeExpired: async () => 0,
      },
      users: {
        list: async () => [] as UserSummary[],
        find: async () => null,
        create: async () => ({ id: 0 }),
        updateRoles: async () => {},
        setDisabled: async () => {},
        linkedCandidates: async () => [],
        linksOf: async () => [],
        linkCandidate: async () => {},
        unlinkById: async () => {},
      },
      audit: {
        record: async (e) => {
          eventos.push(e);
        },
        findUserId: async () => null,
      },
    };

    await stopImpersonation(
      {
        userId: 2,
        candidateId: 5,
        roles: ["candidate"],
        email: "alvo@local.test",
        expiresAt: "2026-08-20T13:00:00.000Z",
        linkedCandidateIds: [],
        impersonatedBy: 9,
      },
      "token-emprestado",
      deps,
    );

    expect(eventos[0]).toMatchObject({
      kind: "impersonation_end",
      userId: 9,
      email: null,
    });
    expect(eventos[0]!.detail).toContain("alvo@local.test");
  });
});
