import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authUser } from "../src/core/db/schema.ts";
import { generatePassword, seedOwner } from "../src/contexts/auth/app/seed.ts";
import { verifyLogin } from "../src/contexts/auth/infra/password-login.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});
afterEach(() => releaseTestDb());

describe("generatePassword", () => {
  it("é longa o suficiente para o mínimo da política", () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword().length).toBeGreaterThanOrEqual(12);
    }
  });

  it("nunca repete", () => {
    // Previsibilidade aqui seria a falha inteira: a senha gerada é a
    // credencial de primeiro acesso.
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(seen.size).toBe(200);
  });

  it("usa só caracteres que se transcrevem sem erro", () => {
    // Ela vai ser lida de um terminal e digitada num formulário.
    for (let i = 0; i < 20; i++) {
      expect(generatePassword()).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("seedOwner", () => {
  it("cria a conta com senha utilizável", async () => {
    const r = await seedOwner({ email: "dono@test" });
    expect(r.created).toBe(true);
    expect(r.passwordSet).toBe(true);
    expect(r.password).toBeTruthy();
    expect(r.roles).toEqual(["owner", "admin"]);

    // A senha devolvida é a que entra — não basta gravar um hash qualquer.
    expect((await verifyLogin("dono@test", r.password!)).ok).toBe(true);
  });

  it("guarda só o hash, nunca a senha", async () => {
    const r = await seedOwner({ email: "dono@test" });
    const [row] = await db.select().from(authUser);
    expect(row!.passwordHash).not.toContain(r.password!);
    expect(row!.passwordHash!.startsWith("scrypt$")).toBe(true);
  });

  it("é idempotente e não derruba quem já entrou", async () => {
    // Sobrescrever a credencial de alguém em silêncio seria o pior
    // comportamento possível para um comando chamado "seed".
    const first = await seedOwner({ email: "dono@test" });
    const second = await seedOwner({ email: "dono@test" });

    expect(second.created).toBe(false);
    expect(second.passwordSet).toBe(false);
    expect(second.password).toBeUndefined();
    expect((await verifyLogin("dono@test", first.password!)).ok).toBe(true);
  });

  it("redefine quando pedido explicitamente", async () => {
    const first = await seedOwner({ email: "dono@test" });
    const second = await seedOwner({ email: "dono@test", force: true });

    expect(second.passwordSet).toBe(true);
    expect((await verifyLogin("dono@test", second.password!)).ok).toBe(true);
    expect((await verifyLogin("dono@test", first.password!)).ok).toBe(false);
  });

  it("aceita uma senha escolhida e não a devolve como se fosse gerada", async () => {
    const r = await seedOwner({ email: "dono@test", password: "senha-escolhida-longa" });
    expect((await verifyLogin("dono@test", "senha-escolhida-longa")).ok).toBe(true);
    expect(r.password).toBe("senha-escolhida-longa");
  });

  it("normaliza o endereço", async () => {
    await seedOwner({ email: "  DONO@TEST  " });
    const [row] = await db.select().from(authUser);
    expect(row!.email).toBe("dono@test");
  });

  it("exige um e-mail em vez de inventar um", async () => {
    // O perfil tem o e-mail em variável de ambiente, então ele está vazio em
    // qualquer clone sem `.env`. Falhar com instrução é melhor que criar uma
    // conta com endereço fabricado.
    await expect(seedOwner({})).rejects.toThrow(/e-mail/i);
  });
});
