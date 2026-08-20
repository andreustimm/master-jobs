import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, candidate } from "../src/core/db/schema.ts";
import {
  ADMIN_ACTIONS,
  adminsBesides,
  beginImpersonation,
  can,
  createUser,
  endImpersonation,
  endSession,
  findUser,
  finishLogin,
  linkRecruiterToCandidate,
  listUsers,
  passwordSignIn,
  recruiterLinks,
  removeRecruiterLink,
  resolveSession,
  revokeUserSessions,
  setUserDisabled,
  setUserRoles,
  startLogin,
} from "../src/contexts/auth/index.ts";
import { setPassword } from "../src/contexts/auth/infra/password-login.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O contexto de auth composto — a fachada que o resto do sistema realmente usa.
 *
 * As camadas de baixo já são testadas em isolamento, e é justamente por isso
 * que este arquivo existe: teste de unidade com dublê não detecta **fiação
 * trocada**. Um `startLogin` apontado para o provedor errado, ou um
 * `resolveSession` que ignorasse o modo aberto, passariam por todos os testes
 * de dublê e quebrariam a instalação inteira.
 *
 * Aqui nada é dublado. Vale-se do banco em memória e exercita-se a função
 * exportada, que é o único ponto que a aplicação enxerga.
 */

let db: DB;
let time: ReturnType<typeof fixedClock>;
let modoAnterior: string | undefined;

async function makeCandidate(slug: string): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: slug })
    .returning({ id: candidate.id });
  return row!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock("2026-08-20T12:00:00.000Z");
  setClock(time);
  // O modo aberto é global e lido de `process.env`. Deixá-lo herdado do
  // ambiente faria este arquivo passar ou falhar conforme o shell de quem roda.
  modoAnterior = process.env.JHO_AUTH_MODE;
  delete process.env.JHO_AUTH_MODE;
});

afterEach(() => {
  if (modoAnterior === undefined) delete process.env.JHO_AUTH_MODE;
  else process.env.JHO_AUTH_MODE = modoAnterior;
  resetClock();
  releaseTestDb();
});

describe("ciclo de vida da sessão pela fachada", () => {
  it("link mágico entra, resolve e sai — e sair invalida de verdade", async () => {
    const cid = await makeCandidate("dono");
    await createUser({ email: "dono@local.test", roles: ["candidate"], candidateId: cid });

    const { token: link } = await startLogin("dono@local.test");
    const login = await finishLogin(link);

    expect(login).not.toBeNull();
    // O token de sessão é outro valor que o do link: é isso que derruba fixação
    // de sessão — o que o atacante plantou antes de autenticar não é o que
    // termina válido.
    expect(login!.token).not.toBe(link);

    const sessao = await resolveSession(login!.token);
    expect(sessao).toMatchObject({ email: "dono@local.test", candidateId: cid });

    await endSession(login!.token);
    // Revogado no servidor. Se `endSession` só apagasse o cookie, quem copiou o
    // valor continuaria autenticado.
    expect(await resolveSession(login!.token)).toBeNull();
  });

  it("login por senha usa a mesma fachada e produz sessão equivalente", async () => {
    const cid = await makeCandidate("senha");
    await createUser({ email: "senha@local.test", roles: ["candidate"], candidateId: cid });
    await setPassword("senha@local.test", "senha-bem-longa-mesmo");

    const ok = await passwordSignIn("senha@local.test", "senha-bem-longa-mesmo");
    expect(ok.ok).toBe(true);
    if (ok.ok !== true) return;

    expect((await resolveSession(ok.token))!.candidateId).toBe(cid);
    // Sessão de senha não é emprestada — o banner de impersonação não pode
    // aparecer, e a política não pode negar administração por engano.
    expect(ok.session.impersonatedBy).toBeNull();
  });

  it("senha errada não devolve sessão nem distingue o motivo", async () => {
    await createUser({ email: "existe@local.test", roles: ["candidate"] });
    await setPassword("existe@local.test", "senha-bem-longa-mesmo");

    const errada = await passwordSignIn("existe@local.test", "chute-qualquer");
    const inexistente = await passwordSignIn("nao-existe@local.test", "chute-qualquer");

    // Resposta idêntica para conta existente com senha errada e para conta que
    // não existe. Qualquer diferença aqui transforma o formulário de login em
    // um verificador de "esta pessoa tem conta neste sistema".
    expect(errada).toEqual({ ok: false, reason: "invalid" });
    expect(inexistente).toEqual({ ok: false, reason: "invalid" });
  });

  it("revokeUserSessions derruba tudo da conta e diz quantas eram", async () => {
    await createUser({ email: "multi@local.test", roles: ["candidate"] });
    await setPassword("multi@local.test", "senha-bem-longa-mesmo");

    const a = await passwordSignIn("multi@local.test", "senha-bem-longa-mesmo");
    const b = await passwordSignIn("multi@local.test", "senha-bem-longa-mesmo");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok !== true || b.ok !== true) return;

    // `setPassword` já derrubou o que existia antes, então o que se conta aqui
    // são exatamente as duas sessões abertas depois.
    expect(await revokeUserSessions("  MULTI@Local.TEST ")).toBe(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });

  it("revokeUserSessions devolve null para conta que não existe", async () => {
    expect(await revokeUserSessions("ninguem@local.test")).toBeNull();
  });
});

describe("resolveSession", () => {
  it("sem token e sem modo aberto, não há sessão — nem sintetizada", async () => {
    // Este é o padrão, e o padrão é a decisão de segurança: antes, a ausência
    // de sessão sintetizava uma e deixava currículo, funil e export acessíveis
    // a qualquer requisição.
    expect(await resolveSession(null)).toBeNull();
    expect(await resolveSession("")).toBeNull();
  });

  it("token inventado não resolve", async () => {
    expect(await resolveSession("valor-que-nunca-foi-emitido")).toBeNull();
  });

  it("no modo aberto sintetiza a sessão e nem consulta o token", async () => {
    // O modo aberto tem de passar pelo MESMO guard do modo autenticado. Se ele
    // devolvesse null e a aplicação tivesse um desvio próprio, o caminho
    // autenticado viraria um ramo que só roda em produção — ou seja, um ramo
    // que ninguém testou.
    process.env.JHO_AUTH_MODE = "open";

    const sessao = await resolveSession(null, 42);
    expect(sessao).not.toBeNull();
    expect(sessao!.candidateId).toBe(42);
    expect(sessao!.roles).toEqual(["admin", "candidate"]);
    expect(sessao!.impersonatedBy).toBeNull();
  });
});

describe("gestão de contas pela fachada", () => {
  it("cria, lista, encontra, promove e desabilita", async () => {
    const cid = await makeCandidate("gestao");
    const { id } = await createUser({
      email: "gestao@local.test",
      roles: ["candidate"],
      candidateId: cid,
    });

    expect((await listUsers()).map((u) => u.email)).toEqual(["gestao@local.test"]);
    expect((await findUser(id))!.roles).toEqual(["candidate"]);

    await setUserRoles(id, ["candidate", "admin"]);
    expect((await findUser(id))!.roles).toEqual(["candidate", "admin"]);

    await setUserDisabled(id, true);
    expect((await findUser(id))!.disabledAt).toBeTruthy();
  });

  it("desabilitar corta a sessão viva na hora, não no vencimento", async () => {
    // É a razão de a desativação existir. Se ela só valesse a partir do próximo
    // login, desligar uma conta comprometida não faria nada durante trinta dias.
    const { id } = await createUser({ email: "corta@local.test", roles: ["candidate"] });
    await setPassword("corta@local.test", "senha-bem-longa-mesmo");
    const login = await passwordSignIn("corta@local.test", "senha-bem-longa-mesmo");
    expect(login.ok).toBe(true);
    if (login.ok !== true) return;

    expect(await resolveSession(login.token)).not.toBeNull();
    await setUserDisabled(id, true);
    expect(await resolveSession(login.token)).toBeNull();
  });

  it("findUser devolve null para id inexistente", async () => {
    expect(await findUser(31337)).toBeNull();
  });

  it("adminsBesides enxerga o último admin da instalação", async () => {
    const admin = await createUser({ email: "raiz@local.test", roles: ["admin"] });
    expect(await adminsBesides(admin.id)).toEqual([]);

    const outro = await createUser({ email: "segundo@local.test", roles: ["admin"] });
    expect(await adminsBesides(admin.id)).toEqual([outro.id]);
  });
});

describe("vínculo de recrutador pela fachada", () => {
  it("vincula, aparece na sessão do recrutador, e remover revoga o alcance", async () => {
    // O vínculo é o que dá ao recrutador leitura de currículo e funil. Ele é
    // resolvido na CARGA DA SESSÃO justamente para a política nunca aceitar um
    // id de candidato vindo do chamador.
    const cid = await makeCandidate("acompanhado");
    const rec = await createUser({ email: "rec@local.test", roles: ["recruiter"] });
    const dono = await createUser({ email: "consente@local.test", roles: ["candidate"], candidateId: cid });

    await linkRecruiterToCandidate(rec.id, cid, dono.id);
    await setPassword("rec@local.test", "senha-bem-longa-mesmo");

    const login = await passwordSignIn("rec@local.test", "senha-bem-longa-mesmo");
    expect(login.ok).toBe(true);
    if (login.ok !== true) return;

    expect((await resolveSession(login.token))!.linkedCandidateIds).toEqual([cid]);

    const links = await recruiterLinks(rec.id);
    expect(links).toHaveLength(1);
    await removeRecruiterLink(links[0]!.id);

    // Revogar tem de valer para a sessão JÁ ABERTA: os vínculos são relidos a
    // cada resolução, e não congelados no login.
    expect((await resolveSession(login.token))!.linkedCandidateIds).toEqual([]);
  });
});

describe("impersonação pela fachada", () => {
  it("a sessão emprestada entra como o alvo mas perde a administração", async () => {
    // A negativa é por `impersonatedBy !== null`, não por papel — e o teste
    // usa um alvo que TAMBÉM é admin, que é o caso em que uma checagem por
    // papel silenciosamente permitiria tudo.
    const cid = await makeCandidate("alvo");
    const admin = await createUser({ email: "admin@local.test", roles: ["admin"] });
    const alvo = await createUser({
      email: "alvo@local.test",
      roles: ["admin", "candidate"],
      candidateId: cid,
    });

    const actor = {
      userId: admin.id,
      candidateId: null,
      roles: ["admin"] as const,
      email: "admin@local.test",
      expiresAt: "2026-09-20T12:00:00.000Z",
      linkedCandidateIds: [] as number[],
      impersonatedBy: null,
    };

    const started = await beginImpersonation({ ...actor, roles: [...actor.roles] }, alvo.id);
    expect(started.ok).toBe(true);
    if (started.ok !== true) return;

    const emprestada = await resolveSession(started.token);
    expect(emprestada).toMatchObject({ email: "alvo@local.test", impersonatedBy: admin.id });

    for (const acao of ADMIN_ACTIONS) {
      expect(can(emprestada, acao, { kind: "global" }, time.now()).allowed, acao).toBe(false);
    }

    // E o acesso deixou rastro: um acesso a currículo alheio que não aparece em
    // lugar nenhum é indistinguível de vazamento.
    const eventos = await db.select().from(authEvent);
    expect(eventos.map((e) => e.kind)).toContain("impersonation_start");
  });

  it("largar a identidade revoga a sessão emprestada e registra o fim", async () => {
    const cid = await makeCandidate("largado");
    const admin = await createUser({ email: "adm2@local.test", roles: ["admin"] });
    const alvo = await createUser({ email: "largado@local.test", roles: ["candidate"], candidateId: cid });

    const started = await beginImpersonation(
      {
        userId: admin.id,
        candidateId: null,
        roles: ["admin"],
        email: "adm2@local.test",
        expiresAt: "2026-09-20T12:00:00.000Z",
        linkedCandidateIds: [],
        impersonatedBy: null,
      },
      alvo.id,
    );
    expect(started.ok).toBe(true);
    if (started.ok !== true) return;

    const emprestada = await resolveSession(started.token);
    await endImpersonation(emprestada, started.token);

    expect(await resolveSession(started.token)).toBeNull();
    const kinds = (await db.select().from(authEvent)).map((e) => e.kind);
    expect(kinds).toContain("impersonation_end");
  });

  it("a sessão emprestada vive uma hora, não os trinta dias de um login", async () => {
    const admin = await createUser({ email: "adm3@local.test", roles: ["admin"] });
    const alvo = await createUser({ email: "curto@local.test", roles: ["candidate"] });

    const started = await beginImpersonation(
      {
        userId: admin.id,
        candidateId: null,
        roles: ["admin"],
        email: "adm3@local.test",
        expiresAt: "2026-09-20T12:00:00.000Z",
        linkedCandidateIds: [],
        impersonatedBy: null,
      },
      alvo.id,
    );
    expect(started.ok).toBe(true);
    if (started.ok !== true) return;

    expect(Date.parse(started.expiresAt) - time.now()).toBe(3_600_000);

    // Passada a hora, a credencial de acesso a dado alheio morre sozinha.
    time.advance(3_600_001);
    expect(await resolveSession(started.token)).toBeNull();
  });
});
