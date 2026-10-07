/**
 * Suíte: o que acontece com identidades e cadastros quando a conta some, e a
 * purga de cadastros na manutenção (#464, ADR-009).
 *
 * Fronteira DENTRO: PostgreSQL real com as migrações (`useTestDb`), as FKs
 * aplicadas e `runDatabaseCleanup`, que o job `manutencao-banco.yml` chama por
 * `jho db cleanup --apply`.
 * Fronteira FORA: o serviço de cadastro que escreve as linhas — aqui elas são
 * semeadas na forma que ele grava.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { runDatabaseCleanup } from "../src/core/db/retention.ts";
import { authIdentity, authSignup, authUser } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => releaseTestDb());

const NOW = new Date("2026-10-06T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let tokens = 0;
async function signup(values: { createdAt: string; completedAt?: string | null; userId?: number | null; email?: string }) {
  tokens += 1;
  const [row] = await db
    .insert(authSignup)
    .values({
      kind: "manual",
      tokenHash: `token-${tokens}`,
      email: values.email ?? `pessoa${tokens}@example.test`,
      locale: "pt-BR",
      role: "candidate",
      cvText: "Currículo que não pode sobrar no banco além do prazo.",
      ipHmac: "hmac-ip",
      createdAt: values.createdAt,
      expiresAt: new Date(Date.parse(values.createdAt) + DAY).toISOString(),
      completedAt: values.completedAt ?? null,
      userId: values.userId ?? null,
    })
    .returning({ id: authSignup.id, email: authSignup.email });
  return row!;
}

describe("conta apagada", () => {
  it("IT-102 apagar a conta apaga as identidades e deixa o cadastro concluído sem dono", async () => {
    const [ana] = await db.insert(authUser).values({ email: "ana@example.test", roles: ["candidate"] }).returning({ id: authUser.id });
    const [bia] = await db.insert(authUser).values({ email: "bia@example.test", roles: ["recruiter"] }).returning({ id: authUser.id });
    await db.insert(authIdentity).values([
      { userId: ana!.id, provider: "google", subject: "g-ana", origin: "automatic" },
      { userId: ana!.id, provider: "linkedin", subject: "l-ana", origin: "manual" },
      { userId: bia!.id, provider: "google", subject: "g-bia", origin: "manual" },
    ]);
    const done = await signup({ createdAt: ago(HOUR), completedAt: ago(HOUR / 2), userId: ana!.id, email: "ana@example.test" });

    await db.delete(authUser).where(eq(authUser.id, ana!.id));

    const identities = await db.select({ subject: authIdentity.subject }).from(authIdentity);
    expect(identities.map((row) => row.subject)).toEqual(["g-bia"]);
    const [kept] = await db.select().from(authSignup).where(eq(authSignup.id, done.id));
    expect(kept).toMatchObject({ userId: null, email: "ana@example.test" });
  });
});

describe("purga na manutenção", () => {
  it("IT-103 apaga pendente com mais de 24 h e concluído com mais de 30 dias, e só esses", async () => {
    const [user] = await db.insert(authUser).values({ email: "c@example.test", roles: ["candidate"] }).returning({ id: authUser.id });
    const stalePending = await signup({ createdAt: ago(DAY + 1_000) });
    const freshPending = await signup({ createdAt: ago(DAY - 60_000) });
    const oldCompleted = await signup({ createdAt: ago(31 * DAY), completedAt: ago(30 * DAY + 1_000), userId: user!.id });
    const recentCompleted = await signup({ createdAt: ago(29 * DAY), completedAt: ago(29 * DAY) });

    const dry = await runDatabaseCleanup({ now: NOW });
    expect(dry.candidates.expiredSignups).toBe(2);
    expect(dry.applied).toBeNull();
    expect(await db.select({ id: authSignup.id }).from(authSignup)).toHaveLength(4);

    const result = await runDatabaseCleanup({ apply: true, now: NOW });
    expect(result.applied?.purgedSignups).toBe(2);

    const left = (await db.select({ id: authSignup.id }).from(authSignup)).map((row) => row.id).sort();
    expect(left).toEqual([freshPending.id, recentCompleted.id].sort());
    expect(left).not.toContain(stalePending.id);
    expect(left).not.toContain(oldCompleted.id);
    // A conta do cadastro purgado continua existindo: a purga é do registro.
    expect(await db.select({ id: authUser.id }).from(authUser)).toEqual([{ id: user!.id }]);

    const again = await runDatabaseCleanup({ apply: true, now: NOW });
    expect(again.applied?.purgedSignups).toBe(0);
  });
});
