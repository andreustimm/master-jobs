import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, candidate } from "../src/core/db/schema.ts";
import {
  createUser,
  deleteUser,
  findUser,
  finishLogin,
  listUsers,
  passwordSignIn,
  resolveSession,
  startLogin,
  updateUser,
} from "../src/contexts/auth/index.ts";
import { setPassword } from "../src/contexts/auth/infra/password-login.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Nome da conta e exclusão de conta, pela fachada.
 *
 * Nada é dublado, pelo mesmo motivo do arquivo de fiação ao lado: o que estes
 * dois recursos podem quebrar não é lógica isolada, é **travessia**. O nome
 * precisa sair do banco, atravessar `Identity`, virar `Session` e chegar ao
 * topo da tela; a exclusão precisa levar a sessão junto e deixar o candidato em
 * pé. Dublê nenhum falha quando um `select` esquece de trazer a coluna nova —
 * e foi exatamente esse o modo de falha que o type system pegou em quatro
 * lugares enquanto isto foi escrito.
 *
 * Fronteira DENTRO: banco real em memória, migrações reais, funções de
 * produção. FORA: rede e HTTP. As regras de "não é o último admin" e "não é a
 * própria conta" vivem na Server Action, não aqui, e são testadas onde moram.
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
  modoAnterior = process.env.JHO_AUTH_MODE;
  delete process.env.JHO_AUTH_MODE;
});

afterEach(() => {
  if (modoAnterior === undefined) delete process.env.JHO_AUTH_MODE;
  else process.env.JHO_AUTH_MODE = modoAnterior;
  resetClock();
  releaseTestDb();
});

describe("nome da conta", () => {
  it("chega até a sessão do link mágico", async () => {
    await createUser({ email: "nome@local.test", fullName: "Ana Ribeiro", roles: ["admin"] });

    const { token: link } = await startLogin("nome@local.test");
    const login = await finishLogin(link);
    const sessao = await resolveSession(login!.token);

    // A travessia inteira numa asserção: coluna -> Identity -> Session. Se
    // qualquer `select` no caminho esquecer a coluna, isto vira `undefined` e o
    // topo da tela cai para o e-mail sem ninguém perceber.
    expect(sessao!.fullName).toBe("Ana Ribeiro");
  });

  it("chega até a sessão do login por senha", async () => {
    await createUser({ email: "psenha@local.test", fullName: "Bruno Alves", roles: ["admin"] });
    await setPassword("psenha@local.test", "senha-bem-longa-mesmo");

    const ok = await passwordSignIn("psenha@local.test", "senha-bem-longa-mesmo");
    expect(ok.ok).toBe(true);
    if (ok.ok !== true) return;

    // Caminho separado do link mágico, com `select` próprio. Testar só um dos
    // dois deixaria metade da travessia sem rede.
    expect((await resolveSession(ok.token))!.fullName).toBe("Bruno Alves");
  });

  it("conta sem nome tem nulo, e não string vazia", async () => {
    await createUser({ email: "sem@local.test", roles: ["admin"] });

    const { token: link } = await startLogin("sem@local.test");
    const sessao = await resolveSession((await finishLogin(link))!.token);

    // Nulo é o que a interface sabe tratar para cair no e-mail. `""` passaria
    // pelo `??` e deixaria o topo em branco.
    expect(sessao!.fullName).toBeNull();
  });

  it("espaço em volta é aparado, e só-espaço vira nulo", async () => {
    const { id: comEspaco } = await createUser({
      email: "espaco@local.test",
      fullName: "  Carla Dias  ",
      roles: ["admin"],
    });
    const { id: soEspaco } = await createUser({
      email: "branco@local.test",
      fullName: "   ",
      roles: ["admin"],
    });

    expect((await findUser(comEspaco))!.fullName).toBe("Carla Dias");
    // Nome que é só espaço não é nome. Guardá-lo faria a tela mostrar um vazio
    // que parece defeito, em vez de cair para o e-mail.
    expect((await findUser(soEspaco))!.fullName).toBeNull();
  });
});

describe("editar a conta", () => {
  it("muda nome, e-mail e papéis de uma vez", async () => {
    const { id } = await createUser({ email: "antes@local.test", roles: ["candidate"] });

    await updateUser(id, {
      email: "DEPOIS@Local.Test",
      fullName: "Diana Souza",
      roles: ["admin", "recruiter"],
    });

    const depois = await findUser(id);
    expect(depois!.fullName).toBe("Diana Souza");
    // Minúscula sempre: o índice de e-mail é único e o login normaliza antes de
    // procurar. Guardar com maiúscula criaria uma conta que existe e não entra.
    expect(depois!.email).toBe("depois@local.test");
    expect(depois!.roles).toEqual(["admin", "recruiter"]);
  });

  it("campo ausente não é tocado", async () => {
    const { id } = await createUser({
      email: "parcial@local.test",
      fullName: "Elza Martins",
      roles: ["candidate"],
    });

    await updateUser(id, { roles: ["admin"] });

    const depois = await findUser(id);
    // O patch é parcial de propósito: a modal pode ter sido aberta antes da
    // última alteração, e mandar o registro inteiro faria duas edições
    // simultâneas se sobrescreverem em silêncio.
    expect(depois!.fullName).toBe("Elza Martins");
    expect(depois!.email).toBe("parcial@local.test");
    expect(depois!.roles).toEqual(["admin"]);
  });

  it("apagar o nome é diferente de não mexer nele", async () => {
    const { id } = await createUser({
      email: "limpa@local.test",
      fullName: "Fábio Nunes",
      roles: ["admin"],
    });

    await updateUser(id, { fullName: "" });

    // `""` explícito é a pessoa apagando o nome, e vira nulo. Ausente teria
    // deixado "Fábio Nunes" — é a distinção que o caso anterior guarda.
    expect((await findUser(id))!.fullName).toBeNull();
  });

  it("patch vazio não estoura", async () => {
    const { id } = await createUser({ email: "nada@local.test", roles: ["admin"] });

    // A modal aberta e fechada sem mudar nada chega aqui. `set({})` é erro de
    // SQL no Drizzle, e o certo é não fazer nada — não derrubar a tela.
    await expect(updateUser(id, {})).resolves.toBeUndefined();
    expect((await findUser(id))!.email).toBe("nada@local.test");
  });
});

describe("excluir a conta", () => {
  it("some da listagem e não é mais encontrada", async () => {
    const { id } = await createUser({ email: "vai@local.test", roles: ["admin"] });
    await createUser({ email: "fica@local.test", roles: ["admin"] });

    await deleteUser(id);

    expect(await findUser(id)).toBeNull();
    expect((await listUsers()).map((u) => u.email)).toEqual(["fica@local.test"]);
  });

  it("leva a sessão junto — quem estava logado deixa de estar", async () => {
    const { id } = await createUser({ email: "logada@local.test", roles: ["admin"] });
    const { token: link } = await startLogin("logada@local.test");
    const login = await finishLogin(link);
    expect(await resolveSession(login!.token)).not.toBeNull();

    await deleteUser(id);

    // Cascata na chave estrangeira. Sem ela a sessão continuaria resolvendo
    // contra uma conta que não existe, e apagar alguém não tiraria o acesso —
    // que é a única coisa que apagar precisa garantir.
    expect(await resolveSession(login!.token)).toBeNull();
  });

  it("não apaga o candidato junto", async () => {
    const cid = await makeCandidate("preservado");
    const { id } = await createUser({
      email: "dono@local.test",
      roles: ["candidate"],
      candidateId: cid,
    });

    await deleteUser(id);

    // Conta e candidato são coisas distintas. Apagar o currículo de alguém por
    // causa de uma conta removida seria dano colateral silencioso — e o
    // currículo é o dado mais caro de reconstruir que existe aqui.
    const restantes = await db.select().from(candidate);
    expect(restantes.map((c) => c.id)).toContain(cid);
  });

  it("a auditoria sobrevive, sem apontar para a conta que não existe mais", async () => {
    const { id } = await createUser({ email: "auditada@local.test", roles: ["admin"] });
    const { token: link } = await startLogin("auditada@local.test");
    await finishLogin(link);

    const antes = await db.select().from(authEvent);
    expect(antes.length).toBeGreaterThan(0);

    await deleteUser(id);

    // O login ocorreu, e continua tendo ocorrido. `set null` no `user_id` é o
    // que separa "auditoria preservada" de "auditoria apagada junto" — e uma
    // trilha que some quando a conta some não serve para investigar nada.
    const depois = await db.select().from(authEvent);
    expect(depois.length).toBe(antes.length);
    expect(depois.every((e) => e.userId === null)).toBe(true);
  });
});
