import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authUser, candidate, recruiterCandidate } from "../src/core/db/schema.ts";
import {
  drizzleUserDirectory,
  otherActiveAdmins,
} from "../src/contexts/auth/infra/drizzle-directory.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Gestão de contas — o adapter que administra em vez de autenticar.
 *
 * Este arquivo existe porque `drizzle-directory.ts` é o único lugar do sistema
 * capaz de **criar um admin, rebaixar um admin e ligar um recrutador a um
 * candidato**. Cada uma dessas três operações, feita errada, é escalada de
 * privilégio ou leitura de currículo alheio — não bug cosmético.
 *
 * O adapter é burro de propósito, mas "burro" aqui significa que a garantia
 * inteira mora no escopo de cada consulta. E escopo só se prova exercitando
 * dois candidatos ao mesmo tempo: um teste com um único usuário passaria
 * intacto mesmo se o `where` tivesse sumido.
 */

let db: DB;

async function makeCandidate(n: number): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug: `candidato-${n}`, name: `Candidato ${n}` })
    .returning({ id: candidate.id });
  return row!.id;
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => releaseTestDb());

describe("UserDirectory: leitura de contas", () => {
  it("lista em ordem estável e NUNCA devolve o hash da senha", async () => {
    // O hash é credencial quebrável offline. Uma tela de administração que o
    // recebesse o colocaria no HTML, no JSON da rota e em qualquer log de
    // requisição — três cópias de algo que só precisa existir dentro do banco.
    // O resumo carrega apenas o FATO de existir senha, porque o que a tela
    // precisa saber é se a conta consegue entrar, não com o quê.
    const cid = await makeCandidate(1);
    await db.insert(authUser).values({
      email: "com-senha@local.test",
      roles: ["candidate"],
      candidateId: cid,
      passwordHash: "scrypt$65536$8$1$c2FsdGluaG8$aGFzaC1zZWNyZXRvLWRlbW8",
    });
    await db.insert(authUser).values({ email: "sem-senha@local.test", roles: ["recruiter"] });

    const rows = await drizzleUserDirectory.list();

    expect(rows.map((r) => r.email)).toEqual(["com-senha@local.test", "sem-senha@local.test"]);
    expect(rows[0]!.hasPassword).toBe(true);
    expect(rows[1]!.hasPassword).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("aGFzaC1zZWNyZXRvLWRlbW8");
    expect(Object.keys(rows[0]!)).not.toContain("passwordHash");
  });

  it("devolve lista vazia numa instalação recém-migrada", async () => {
    // Sem conta nenhuma o retorno é `[]`, não `null` nem exceção: a tela de
    // administração precisa renderizar "nenhuma conta" logo depois do seed.
    await expect(drizzleUserDirectory.list()).resolves.toEqual([]);
  });

  it("find devolve null para id inexistente em vez de estourar", async () => {
    // Id vem da URL, então id inventado é entrada hostil normal. Null vira 404
    // na camada de cima; uma exceção viraria 500 — e um 500 diferente de um 404
    // já conta ao atacante que aquele id existe.
    await expect(drizzleUserDirectory.find(4242)).resolves.toBeNull();
  });

  it("find projeta a conta com papéis, vínculo de candidato e estado", async () => {
    const cid = await makeCandidate(2);
    const { id } = await drizzleUserDirectory.create({
      email: "alvo@local.test",
      roles: ["admin", "candidate"],
      candidateId: cid,
    });

    const found = await drizzleUserDirectory.find(id);
    expect(found).toMatchObject({
      id,
      email: "alvo@local.test",
      roles: ["admin", "candidate"],
      candidateId: cid,
      disabledAt: null,
      hasPassword: false,
    });
    expect(found!.createdAt).toBeTruthy();
  });
});

describe("UserDirectory: criação de conta", () => {
  it("normaliza o endereço, porque o login busca pela forma normalizada", async () => {
    // Sem normalizar, "  DONO@X  " e "dono@x" viram duas contas para a mesma
    // pessoa e o índice único não impede nada. Pior: a conta criada com
    // maiúscula nunca seria encontrada pelo login, que compara em minúsculas —
    // conta órfã, com papéis, invisível para quem administra.
    const { id } = await drizzleUserDirectory.create({
      email: "  DONO@Local.TEST  ",
      roles: ["admin"],
    });
    expect((await drizzleUserDirectory.find(id))!.email).toBe("dono@local.test");
  });

  it("cria conta SEM credencial: existir não é poder entrar", async () => {
    // Deliberado. Se criar conta também criasse senha, esta função teria de
    // manusear segredo — e o caminho de administração passaria a produzir
    // credenciais. A conta nasce inerte e só entra quando alguém define uma
    // senha por outro caminho.
    const { id } = await drizzleUserDirectory.create({
      email: "novo@local.test",
      roles: ["recruiter"],
    });

    const [row] = await db.select().from(authUser).where(eq(authUser.id, id));
    expect(row!.passwordHash).toBeNull();
    expect((await drizzleUserDirectory.find(id))!.hasPassword).toBe(false);
  });

  it("aponta para nenhum candidato quando não pedirem explicitamente", async () => {
    // `candidateId` é o que dá acesso ao currículo. O padrão precisa ser nulo:
    // conta administrativa criada sem pensar não pode sair lendo o perfil de
    // alguém só porque o campo ficou em branco.
    const { id } = await drizzleUserDirectory.create({
      email: "so-admin@local.test",
      roles: ["admin"],
    });
    expect((await drizzleUserDirectory.find(id))!.candidateId).toBeNull();
  });

  it("recusa endereço repetido — duas contas para o mesmo e-mail é identidade ambígua", async () => {
    // O índice único é a defesa: com duas linhas para o mesmo endereço, o login
    // escolheria uma delas por acaso, e desabilitar "a conta" desabilitaria só
    // metade dela.
    await drizzleUserDirectory.create({ email: "repetido@local.test", roles: ["candidate"] });
    await expect(
      drizzleUserDirectory.create({ email: "REPETIDO@local.test", roles: ["admin"] }),
    ).rejects.toThrow();
  });
});

describe("UserDirectory: papéis e desativação", () => {
  it("updateRoles substitui o conjunto inteiro, não acumula", async () => {
    // Rebaixar precisa REMOVER. Se a atualização fizesse união com o que já
    // estava lá, tirar "admin" de alguém seria impossível pela tela — e a única
    // forma de reverter uma promoção errada seria SQL na mão.
    const { id } = await drizzleUserDirectory.create({
      email: "promovido@local.test",
      roles: ["admin", "candidate"],
    });

    await drizzleUserDirectory.updateRoles(id, ["candidate"]);
    expect((await drizzleUserDirectory.find(id))!.roles).toEqual(["candidate"]);
  });

  it("updateRoles em id inexistente não cria nada nem falha", async () => {
    await drizzleUserDirectory.updateRoles(9999, ["admin"]);
    expect(await drizzleUserDirectory.list()).toEqual([]);
  });

  it("setDisabled carimba e limpa a data, e o ciclo é reversível", async () => {
    // `disabledAt` é o que corta a sessão viva na hora (ver `drizzle-store`),
    // então precisa gravar de verdade — e precisa poder ser desfeito, senão
    // desabilitar por engano é uma conta perdida.
    const { id } = await drizzleUserDirectory.create({
      email: "vai-e-volta@local.test",
      roles: ["candidate"],
    });

    await drizzleUserDirectory.setDisabled(id, true);
    const disabled = await drizzleUserDirectory.find(id);
    expect(disabled!.disabledAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(disabled!.disabledAt!))).toBe(false);

    await drizzleUserDirectory.setDisabled(id, false);
    expect((await drizzleUserDirectory.find(id))!.disabledAt).toBeNull();
  });

  it("setDisabled só atinge a conta pedida", async () => {
    // Um `where` esquecido aqui desabilitaria a instalação inteira de uma vez,
    // inclusive quem teria de reverter a operação.
    const a = await drizzleUserDirectory.create({ email: "a@local.test", roles: ["admin"] });
    const b = await drizzleUserDirectory.create({ email: "b@local.test", roles: ["admin"] });

    await drizzleUserDirectory.setDisabled(a.id, true);
    expect((await drizzleUserDirectory.find(b.id))!.disabledAt).toBeNull();
  });
});

describe("UserDirectory: vínculo recrutador↔candidato", () => {
  it("linkCandidate é idempotente pelo índice único", async () => {
    // Vincular duas vezes não pode criar dois vínculos: a tela mostraria a
    // mesma pessoa duplicada, e remover um deixaria o outro em pé — o acesso
    // continuaria valendo depois de o candidato achar que revogou.
    const cid = await makeCandidate(3);
    const recruiter = await drizzleUserDirectory.create({
      email: "rec@local.test",
      roles: ["recruiter"],
    });
    const owner = await drizzleUserDirectory.create({
      email: "dono@local.test",
      roles: ["candidate"],
    });

    await drizzleUserDirectory.linkCandidate(recruiter.id, cid, owner.id);
    await drizzleUserDirectory.linkCandidate(recruiter.id, cid, owner.id);

    expect(await drizzleUserDirectory.linksOf(recruiter.id)).toHaveLength(1);
    expect(await drizzleUserDirectory.linkedCandidates(recruiter.id)).toEqual([cid]);
  });

  it("registra QUEM criou o vínculo", async () => {
    // O vínculo dá leitura de currículo e funil. Sem `createdBy` não há como
    // distinguir depois um consentimento do candidato de um vínculo que
    // apareceu sozinho — e é justamente essa distinção que a regra "só o
    // próprio candidato vincula" existe para preservar.
    const cid = await makeCandidate(4);
    const recruiter = await drizzleUserDirectory.create({
      email: "rec2@local.test",
      roles: ["recruiter"],
    });
    const owner = await drizzleUserDirectory.create({
      email: "dono2@local.test",
      roles: ["candidate"],
    });

    await drizzleUserDirectory.linkCandidate(recruiter.id, cid, owner.id);

    const [row] = await db.select().from(recruiterCandidate);
    expect(row!.createdBy).toBe(owner.id);
  });

  it("linksOf e linkedCandidates enxergam SÓ os vínculos do recrutador pedido", async () => {
    // Escopo é a garantia inteira desta tabela. Um recrutador que recebesse a
    // lista do outro saberia quais candidatos existem e — como o id do
    // candidato é o que abre o perfil — teria o material para tentar o acesso.
    const c1 = await makeCandidate(5);
    const c2 = await makeCandidate(6);
    const r1 = await drizzleUserDirectory.create({ email: "r1@local.test", roles: ["recruiter"] });
    const r2 = await drizzleUserDirectory.create({ email: "r2@local.test", roles: ["recruiter"] });

    await drizzleUserDirectory.linkCandidate(r1.id, c1, r1.id);
    await drizzleUserDirectory.linkCandidate(r2.id, c2, r2.id);

    expect(await drizzleUserDirectory.linkedCandidates(r1.id)).toEqual([c1]);
    expect(await drizzleUserDirectory.linksOf(r2.id)).toEqual([
      { id: expect.any(Number), candidateId: c2 },
    ]);
  });

  it("recrutador sem vínculo nenhum recebe listas vazias", async () => {
    // Zero vínculos é o estado inicial e o estado depois de revogar tudo. Se
    // isso virasse null, a política que deriva posse de `linkedCandidateIds`
    // teria de tratar o caso — e "tratar o caso" é onde nasce o `?? [tudo]`.
    const r = await drizzleUserDirectory.create({ email: "solo@local.test", roles: ["recruiter"] });
    expect(await drizzleUserDirectory.linkedCandidates(r.id)).toEqual([]);
    expect(await drizzleUserDirectory.linksOf(r.id)).toEqual([]);
  });

  it("unlinkById remove só o vínculo apontado", async () => {
    // Revogar acesso demais é irritante; revogar de menos é o vazamento
    // continuar valendo. Por isso a remoção é pelo id do vínculo, e não pelo
    // par — nenhuma tela precisa citar o id do candidato para revogar.
    const c1 = await makeCandidate(7);
    const c2 = await makeCandidate(8);
    const r = await drizzleUserDirectory.create({ email: "dois@local.test", roles: ["recruiter"] });

    await drizzleUserDirectory.linkCandidate(r.id, c1, r.id);
    await drizzleUserDirectory.linkCandidate(r.id, c2, r.id);
    const links = await drizzleUserDirectory.linksOf(r.id);

    await drizzleUserDirectory.unlinkById(links[0]!.id);

    expect(await drizzleUserDirectory.linkedCandidates(r.id)).toEqual([links[1]!.candidateId]);
  });

  it("unlinkById de vínculo inexistente é no-op silencioso", async () => {
    // Duplo clique em "remover", ou dois administradores na mesma tela. Falhar
    // aqui só produziria erro numa ação que já atingiu o resultado desejado.
    await expect(drizzleUserDirectory.unlinkById(12345)).resolves.toBeUndefined();
  });
});

describe("otherActiveAdmins", () => {
  it("conta os outros admins ativos e ignora o próprio usuário", async () => {
    const a = await drizzleUserDirectory.create({ email: "admin-a@local.test", roles: ["admin"] });
    const b = await drizzleUserDirectory.create({
      email: "admin-b@local.test",
      roles: ["admin", "candidate"],
    });

    expect(await otherActiveAdmins(a.id)).toEqual([b.id]);
    expect(await otherActiveAdmins(b.id)).toEqual([a.id]);
  });

  it("não conta admin desabilitado — conta que não entra não administra nada", async () => {
    // Se um admin desabilitado contasse, o sistema deixaria rebaixar o último
    // admin ATIVO achando que sobrou alguém. A recuperação seria SQL na mão.
    const vivo = await drizzleUserDirectory.create({ email: "vivo@local.test", roles: ["admin"] });
    const morto = await drizzleUserDirectory.create({ email: "morto@local.test", roles: ["admin"] });
    await drizzleUserDirectory.setDisabled(morto.id, true);

    expect(await otherActiveAdmins(vivo.id)).toEqual([]);
  });

  it("não conta quem não tem o papel admin", async () => {
    const admin = await drizzleUserDirectory.create({ email: "unico@local.test", roles: ["admin"] });
    await drizzleUserDirectory.create({ email: "cand@local.test", roles: ["candidate"] });
    await drizzleUserDirectory.create({ email: "rec@local.test", roles: ["recruiter"] });

    // Vazio significa "este é o último": a instalação não pode ficar sem
    // ninguém capaz de criar contas ou de desfazer a própria mudança.
    expect(await otherActiveAdmins(admin.id)).toEqual([]);
  });

  it("enxerga a promoção assim que ela acontece", async () => {
    // A checagem do último admin é lida imediatamente antes de rebaixar alguém,
    // então ela tem de refletir o estado atual e não um cache.
    const a = await drizzleUserDirectory.create({ email: "p-a@local.test", roles: ["admin"] });
    const b = await drizzleUserDirectory.create({ email: "p-b@local.test", roles: ["candidate"] });

    expect(await otherActiveAdmins(a.id)).toEqual([]);
    await drizzleUserDirectory.updateRoles(b.id, ["candidate", "admin"]);
    expect(await otherActiveAdmins(a.id)).toEqual([b.id]);
  });
});
