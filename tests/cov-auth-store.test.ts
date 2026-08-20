import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authSession, authUser, candidate } from "../src/core/db/schema.ts";
import {
  drizzleAuthRepository,
  drizzleSessions,
} from "../src/contexts/auth/infra/drizzle-store.ts";
import { hashPassword, verifyPassword } from "../src/contexts/auth/domain/password.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Manutenção da tabela de sessões e o verificador de senha diante de lixo.
 *
 * Dois assuntos que parecem administrativos e não são:
 *
 *  - `purgeExpired` APAGA linhas. Uma condição errada aqui não corrompe dado,
 *    ela derruba todo mundo — e o sintoma ("me deslogou sozinho") é o mesmo de
 *    dez outros problemas, então ninguém suspeita da faxina.
 *  - `verifyPassword` diante de um hash corrompido precisa dizer "senha
 *    errada", nunca estourar. Uma exceção aqui vira 500, e um 500 que só
 *    acontece para endereço existente é oráculo de enumeração de contas.
 */

let db: DB;
let time: ReturnType<typeof fixedClock>;

async function seedUser(email: string): Promise<number> {
  const [c] = await db
    .insert(candidate)
    .values({ slug: email, name: email })
    .returning({ id: candidate.id });
  const [u] = await db
    .insert(authUser)
    .values({ email, roles: ["candidate"], candidateId: c!.id })
    .returning({ id: authUser.id });
  return u!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock("2026-08-20T12:00:00.000Z");
  setClock(time);
});

afterEach(() => {
  resetClock();
  releaseTestDb();
});

describe("purgeExpired", () => {
  it("apaga só o que já venceu e devolve quantas linhas saíram", async () => {
    // Linha expirada não prova nada: ela não autentica ninguém e não sustenta
    // auditoria (o rastro de quem entrou mora em `auth_event`). O que ela faz é
    // crescer. A faxina existe para isso e para nada mais.
    const userId = await seedUser("faxina@local.test");
    const vivo = await drizzleSessions.create({ userId, expiresAt: "2026-09-20T12:00:00.000Z" });
    await drizzleSessions.create({ userId, expiresAt: "2026-08-20T11:00:00.000Z" });
    await drizzleSessions.create({ userId, expiresAt: "2026-01-01T00:00:00.000Z" });

    expect(await drizzleSessions.purgeExpired()).toBe(2);

    const restantes = await db.select().from(authSession);
    expect(restantes).toHaveLength(1);
    // E o que sobrou continua servindo: a faxina não pode custar a sessão de
    // quem está trabalhando agora.
    expect(await drizzleSessions.resolve(vivo)).not.toBeNull();
  });

  it("é segura de rodar em banco sem nada a apagar", async () => {
    // Roda periodicamente. Se falhasse com zero linhas, a primeira execução de
    // uma instalação nova quebraria o agendamento inteiro.
    expect(await drizzleSessions.purgeExpired()).toBe(0);
  });

  it("apaga a sessão revogada só depois de ela vencer", async () => {
    // Revogada mas ainda no prazo continua na tabela de propósito: a coluna
    // `revokedAt` é o registro de que houve logout, e apagá-la cedo apagaria o
    // rastro de uma saída que talvez precise ser investigada.
    const userId = await seedUser("revogada@local.test");
    const token = await drizzleSessions.create({ userId, expiresAt: "2026-08-20T13:00:00.000Z" });
    await drizzleSessions.revoke(token);

    expect(await drizzleSessions.purgeExpired()).toBe(0);
    expect(await db.select().from(authSession)).toHaveLength(1);

    time.advance(2 * 3_600_000);
    expect(await drizzleSessions.purgeExpired()).toBe(1);
  });

  it("usa o relógio injetado, não o do sistema", async () => {
    // Se a faxina lesse `Date.now()` direto e o resto do contexto lesse o
    // relógio injetado, as duas metades passariam a decidir por linhas do tempo
    // diferentes — e o bug só apareceria em produção, nunca em teste.
    const userId = await seedUser("relogio@local.test");
    await drizzleSessions.create({ userId, expiresAt: "2026-08-21T00:00:00.000Z" });

    expect(await drizzleSessions.purgeExpired()).toBe(0);
    time.set("2026-08-22T00:00:00.000Z");
    expect(await drizzleSessions.purgeExpired()).toBe(1);
  });
});

describe("findUserId", () => {
  it("normaliza o endereço antes de procurar", async () => {
    // Quem digita o e-mail para revogar sessões de emergência não vai acertar a
    // caixa. Uma busca sensível a maiúsculas devolveria "conta não encontrada"
    // no exato momento em que alguém está tentando cortar um acesso.
    const id = await seedUser("dono@local.test");
    expect(await drizzleAuthRepository.findUserId("  DONO@Local.TEST  ")).toBe(id);
  });

  it("devolve null para endereço desconhecido em vez de inventar um id", async () => {
    expect(await drizzleAuthRepository.findUserId("ninguem@local.test")).toBeNull();
  });
});

describe("verifyPassword diante de valor armazenado corrompido", () => {
  it("responde 'senha errada' quando os parâmetros são impossíveis para o scrypt", async () => {
    // Números finitos e formato válido, mas N=3 não é potência de 2 — o scrypt
    // rejeita. É o caso de um hash gravado por uma versão antiga, ou de uma
    // linha adulterada. A resposta tem de ser a mesma de qualquer outra falha:
    // `false`. Uma exceção aqui distinguiria essa conta das demais.
    expect(await verifyPassword("qualquer-senha", "scrypt$3$8$1$c2FsdA$aGFzaGFxdWk")).toBe(false);
  });

  it("responde 'senha errada' quando o custo pedido excede o teto de memória", async () => {
    // Outro caminho para o mesmo lugar: parâmetros plausíveis, derivação
    // impossível. O verificador nunca pode deixar isso virar 500.
    expect(await verifyPassword("qualquer-senha", "scrypt$1048576$8$1$c2FsdA$aGFzaGFxdWk")).toBe(false);
  });

  it("recusa hash com número de campos errado, sem tentar derivar nada", async () => {
    for (const junk of ["scrypt$65536$8$1$c2FsdA", "scrypt$65536$8$1$c2FsdA$aGFzaA$sobra"]) {
      expect(await verifyPassword("qualquer", junk), junk).toBe(false);
    }
  });

  it("recusa hash íntegro no formato mas errado no conteúdo", async () => {
    // O caminho normal da rejeição: mesmo N, r, p e sal, dígito final trocado.
    // A comparação é em tempo constante justamente aqui — uma rejeição precoce
    // contaria quantos bytes bateram, e é dela que se reconstrói o hash.
    const real = await hashPassword("senha-de-verdade-longa");
    const parts = real.split("$");
    const ultimo = parts[5]!;
    const trocado = (ultimo[0] === "A" ? "B" : "A") + ultimo.slice(1);
    const adulterado = [...parts.slice(0, 5), trocado].join("$");

    expect(await verifyPassword("senha-de-verdade-longa", adulterado)).toBe(false);
    // E o hash íntegro continua funcionando, para provar que a rejeição acima
    // veio do conteúdo e não de o teste ter quebrado o formato.
    expect(await verifyPassword("senha-de-verdade-longa", real)).toBe(true);
  });

  it("o sal faz parte da verificação: trocá-lo invalida o hash", async () => {
    // Sal por linha é o que impede uma tabela pré-computada de servir para toda
    // a base. Se a verificação ignorasse o sal armazenado, dois usuários com a
    // mesma senha teriam o mesmo hash e a proteção sumiria em silêncio.
    const real = await hashPassword("senha-de-verdade-longa");
    const parts = real.split("$");
    const outroSal = parts[4]! === "AAAAAAAAAAAAAAAAAAAAAA" ? "BBBBBBBBBBBBBBBBBBBBBB" : "AAAAAAAAAAAAAAAAAAAAAA";
    const comOutroSal = [...parts.slice(0, 4), outroSal, parts[5]!].join("$");

    expect(await verifyPassword("senha-de-verdade-longa", comOutroSal)).toBe(false);
  });
});
