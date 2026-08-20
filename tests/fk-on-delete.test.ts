import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authSession, authUser, company, job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O que acontece com o dado quando a conta some.
 *
 * Testa COMPORTAMENTO, e não o `pragma`. Um teste que lê a definição da chave
 * confirma que a declaração está escrita; só apagar a linha confirma que o banco
 * faz o que ela promete — e a divergência que a 0025 corrigiu passou despercebida
 * exatamente porque ninguém tinha apagado nada ainda.
 *
 * As duas regras aqui vêm da mesma pergunta: o que é dado e o que é metadado
 * sobre ele?
 */

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
  await db.insert(company).values({ slug: "acme", name: "Acme" });
});

afterEach(() => {
  releaseTestDb();
});

async function seedUser(email: string): Promise<number> {
  const [row] = await db
    .insert(authUser)
    .values({ email, roles: ["recruiter"] })
    .returning({ id: authUser.id });
  return row!.id;
}

async function seedJob(postedBy: number | null): Promise<number> {
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "lever:acme",
      companyName: "Acme",
      externalId: `job-${Math.abs(postedBy ?? 0)}-${Date.now()}`,
      title: "Staff AI Engineer",
      url: "https://example.test/job",
      fingerprint: `fp-${postedBy}-${Date.now()}`,
      contentHash: "ch",
      raw: "{}",
      postedByUserId: postedBy,
    })
    .returning({ id: job.id });
  return row!.id;
}

describe("apagar a conta de quem cadastrou uma vaga", () => {
  it("a vaga SOBREVIVE e esquece quem a cadastrou", async () => {
    const recruiterId = await seedUser("recrutador@local.test");
    const jobId = await seedJob(recruiterId);

    await db.delete(authUser).where(eq(authUser.id, recruiterId));

    // A vaga é o dado; a atribuição é metadado sobre ela. Recusar a exclusão
    // por causa do metadado — que era o efeito de `NO ACTION` — inverte a ordem
    // de importância e trava a exclusão de conta com um erro de constraint sem
    // explicação óbvia.
    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row).toBeDefined();
    expect(row?.postedByUserId).toBeNull();
  });
});

describe("apagar a conta de um admin que assumiu identidade", () => {
  it("a sessão emprestada CAI JUNTO", async () => {
    const adminId = await seedUser("admin@local.test");
    const targetId = await seedUser("alvo@local.test");
    await db.insert(authSession).values({
      tokenHash: "hash-emprestada",
      userId: targetId,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      impersonatedBy: adminId,
    });

    await db.delete(authUser).where(eq(authUser.id, adminId));

    // Sessão emprestada é credencial de acesso a dado alheio. Sobreviver ao
    // admin que a criou deixaria uma porta aberta sem dono — e `NO ACTION`
    // fazia pior: recusava apagar o admin, mantendo os dois.
    const restantes = await db
      .select()
      .from(authSession)
      .where(eq(authSession.tokenHash, "hash-emprestada"));
    expect(restantes).toHaveLength(0);
  });

  it("a sessão própria do alvo continua de pé", async () => {
    const targetId = await seedUser("alvo2@local.test");
    const adminId = await seedUser("admin2@local.test");
    await db.insert(authSession).values({
      tokenHash: "hash-propria",
      userId: targetId,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await db.insert(authSession).values({
      tokenHash: "hash-emprestada-2",
      userId: targetId,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      impersonatedBy: adminId,
    });

    await db.delete(authUser).where(eq(authUser.id, adminId));

    // Só a emprestada cai. Derrubar a sessão de quem foi assumido seria punir
    // o alvo por uma ação do admin.
    const restantes = await db.select().from(authSession).where(eq(authSession.userId, targetId));
    expect(restantes.map((r) => r.tokenHash)).toEqual(["hash-propria"]);
  });
});
