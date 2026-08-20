import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authUser } from "../src/core/db/schema.ts";
import { drizzleAuthRepository } from "../src/contexts/auth/infra/drizzle-store.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A auditoria precisa sobreviver à exclusão da conta.
 *
 * `auth_event.user_id` tem `ON DELETE SET NULL`. A linha continua existindo e
 * para de dizer QUEM — numa tabela cuja razão de existir é provar quem entrou,
 * quem falhou e quem assumiu a identidade de quem. Íntegra na aparência, vazia
 * no conteúdo.
 *
 * O e-mail denormalizado é o que atravessa. Antes era opcional e dependia de
 * quem chamou lembrar: não era garantia, era acaso.
 */

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedUser(email: string): Promise<number> {
  const [row] = await db
    .insert(authUser)
    .values({ email, roles: ["candidate"] })
    .returning({ id: authUser.id });
  return row!.id;
}

describe("record", () => {
  it("resolve o e-mail quando só recebeu o userId", async () => {
    const id = await seedUser("pessoa@local.test");
    await drizzleAuthRepository.record({ kind: "login", userId: id });

    const [row] = await db.select().from(authEvent);
    expect(row?.email).toBe("pessoa@local.test");
  });

  it("respeita o e-mail que veio, sem consultar", async () => {
    // Tentativa em endereço desconhecido grava o endereço TENTADO, que não
    // corresponde a conta nenhuma — sobrescrevê-lo apagaria a informação.
    const id = await seedUser("real@local.test");
    await drizzleAuthRepository.record({
      kind: "login_failed",
      userId: id,
      email: "digitado-errado@local.test",
    });

    const [row] = await db.select().from(authEvent);
    expect(row?.email).toBe("digitado-errado@local.test");
  });

  it("evento sem usuário continua sem e-mail", async () => {
    await drizzleAuthRepository.record({ kind: "session_expired" });
    const [row] = await db.select().from(authEvent);
    expect(row?.email).toBeNull();
  });

  it("apagar a conta zera o vínculo mas NÃO apaga quem foi", async () => {
    // O caso que motiva tudo isto. Sem o e-mail gravado, a linha sobreviveria
    // dizendo apenas "alguém entrou".
    const id = await seedUser("some@local.test");
    await drizzleAuthRepository.record({ kind: "login", userId: id });

    await db.delete(authUser).where(eq(authUser.id, id));

    const [row] = await db.select().from(authEvent);
    expect(row).toBeDefined();
    expect(row?.userId).toBeNull();
    expect(row?.email).toBe("some@local.test");
  });

  it("usuário inexistente não impede o registro", async () => {
    // Falhar aqui perderia o evento inteiro para preservar um campo. A ordem de
    // importância é a oposta: o registro é o dado.
    await drizzleAuthRepository.record({ kind: "denied", userId: null, email: null });
    expect(await db.select().from(authEvent)).toHaveLength(1);
  });
});
