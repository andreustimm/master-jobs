import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IllegalApplicationTransitionError } from "../src/contexts/pursuit/domain/application.ts";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus, undoApplicationStatus } from "../src/core/db/repo.ts";
import {
  application,
  applicationEvent,
  candidate,
  company,
  job,
  mailMessage,
  mailSuggestion,
  source,
} from "../src/core/db/schema.ts";
import { decideSuggestion, OutOfFunnelSuggestionError, RegressiveSuggestionError } from "../src/core/mail/run.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

/** Espera até alguma sessão deste banco estar parada num lock de linha. */
async function untilSomeoneWaitsOnALock(other: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const [row] = await other<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `;
    if (row!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("ninguém chegou a esperar o lock da candidatura");
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function seedTrackedSuggestion(options: { matched?: boolean } = {}) {
  const [owner] = await db
    .insert(candidate)
    .values({ slug: "owner", name: "Owner", isDefault: true })
    .returning({ id: candidate.id });
  await db.insert(source).values({
    id: "manual:test",
    kind: "manual",
    handle: "test",
    label: "Test",
  });
  const [employer] = await db
    .insert(company)
    .values({ slug: "acme", name: "Acme" })
    .returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "manual:test",
      companyId: employer!.id,
      companyName: "Acme",
      externalId: "mail-job",
      title: "Architect",
      url: "manual://mail-job",
      fingerprint: "mail-job",
      contentHash: "mail-job",
      raw: "{}",
    })
    .returning({ id: job.id });
  await setApplicationStatus(owner!.id, posting!.id, "applied");
  const [tracked] = await db
    .select({ id: application.id })
    .from(application)
    .where(
      and(
        eq(application.candidateId, owner!.id),
        eq(application.jobId, posting!.id),
      ),
    );
  const [message] = await db
    .insert(mailMessage)
    .values({ messageId: "message-1", kind: "ats_screening" })
    .returning({ id: mailMessage.id });
  const matched = options.matched ?? true;
  const [suggestion] = await db
    .insert(mailSuggestion)
    .values({
      mailId: message!.id,
      applicationId: matched ? tracked!.id : null,
      jobId: matched ? posting!.id : null,
      suggestedStatus: "screening",
      confidence: 0.9,
    })
    .returning({ id: mailSuggestion.id });
  return { candidateId: owner!.id, jobId: posting!.id, suggestionId: suggestion!.id };
}

describe("decideSuggestion", () => {
  it("commits the suggestion, application and event as one decision", async () => {
    const seeded = await seedTrackedSuggestion();

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).resolves.toEqual({ jobId: seeded.jobId, status: "screening" });

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, tracked!.id));

    expect(suggestion).toMatchObject({ status: "accepted" });
    expect(suggestion!.decidedAt).toBeTruthy();
    expect(tracked!.status).toBe("screening");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      fromStatus: "applied",
      toStatus: "screening",
      detail: `via e-mail (sugestão #${seeded.suggestionId})`,
    });
  });

  it("does not accept a suggestion without a matched application", async () => {
    const seeded = await seedTrackedSuggestion({ matched: false });

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toThrow("não possui candidatura correspondente");

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
  });

  it("rolls the suggestion back when the application event cannot be written", async () => {
    const seeded = await seedTrackedSuggestion();
    await db.execute(sql.raw(`
      create function production.reject_mail_application_event() returns trigger language plpgsql as $$
      begin raise exception 'forced event failure'; end $$;
      create trigger reject_mail_application_event before insert on production.application_event
      for each row execute function production.reject_mail_application_event()
    `));

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toThrow();

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
    expect(tracked!.status).toBe("applied");
  });

  it("is idempotent when an accepted decision is replayed", async () => {
    const seeded = await seedTrackedSuggestion();

    await decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");
    await decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");

    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, tracked!.id));
    expect(events).toHaveLength(2);
  });

  it("recusa com mensagem a sugestão que faria o funil voltar, e ela fica pendente (#316)", async () => {
    // Com as arestas de volta, o domínio aceitaria "Em entrevista → Triagem".
    // Um e-mail de triagem atrasado não pode desfazer uma entrevista marcada.
    const seeded = await seedTrackedSuggestion();
    await setApplicationStatus(seeded.candidateId, seeded.jobId, "screening");
    await setApplicationStatus(seeded.candidateId, seeded.jobId, "interviewing");

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toThrow("voltar de interviewing para screening");

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    const [tracked] = await db
      .select()
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
    expect(tracked!.status).toBe("interviewing");
  });

  it("recusa com erro próprio a sugestão para candidatura fora do funil, sem mostrar o status cru 'untracked' (#346)", async () => {
    // A pessoa desfez a candidatura até "fora do funil" de propósito; e-mail
    // não a recoloca sozinho. Isto não é uma regressão (não existe "voltar" a
    // partir de fora do funil), e a mensagem não pode expor o marcador interno
    // como se fosse um estágio real.
    const seeded = await seedTrackedSuggestion();
    const [tracked] = await db
      .select({ id: application.id })
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    const [firstEvent] = await db
      .select({ id: applicationEvent.id })
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, tracked!.id));
    await undoApplicationStatus(seeded.candidateId, seeded.jobId, firstEvent!.id);
    const [outOfFunnel] = await db
      .select({ status: application.status })
      .from(application)
      .where(eq(application.jobId, seeded.jobId));
    expect(outOfFunnel!.status).toBe("untracked");

    let caught: unknown;
    try {
      await decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OutOfFunnelSuggestionError);
    const message = (caught as Error).message;
    expect(message).not.toMatch(/voltar/);
    expect(message).not.toMatch(/untracked/);

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
  });

  it("sugestão ilegal que não é 'voltar' vira o erro comum de transição, não a mensagem de regressão (Minor #346, revisão da PR #354)", async () => {
    // `shortlisted` → `interviewing` não existe em nenhum sentido (nem avança
    // um passo, nem volta): dizer que isso "voltaria o funil" seria falso.
    const seeded = await seedTrackedSuggestion();
    await db.update(application).set({ status: "shortlisted" }).where(eq(application.jobId, seeded.jobId));
    await db
      .update(mailSuggestion)
      .set({ suggestedStatus: "interviewing" })
      .where(eq(mailSuggestion.id, seeded.suggestionId));

    await expect(
      decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted"),
    ).rejects.toBeInstanceOf(IllegalApplicationTransitionError);

    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
  });

  it("trava `owned` (FOR UPDATE): um avanço real em voo não escapa do guard de regressão por trás de uma igualdade que virou coincidência (ABA, #356)", async () => {
    // A sugestão pendente sugere "screening", e a candidatura também está em
    // "screening" no instante em que `decideSuggestion` lê `owned` — então
    // `status !== owned.status` é falso e o guard de regressão nem roda: não
    // há nada de errado em aceitar "screening" quando já se está em
    // "screening" de verdade. O problema é ler isso SEM travar a linha: entre
    // essa leitura e a gravação, um avanço real (`screening` → `interviewing`
    // → `offer`) pode commitar. Sem `FOR UPDATE`, `setApplicationStatusInTransaction`
    // decide sobre o estado NOVO ("offer") mas a checagem de regressão do
    // e-mail já tinha sido pulada com base no estado VELHO — e "voltar" de
    // "offer" para "screening" é uma transição legal do domínio (recuo),
    // então a escrita silenciosamente regride o funil que `mailMayMove`
    // deveria ter barrado. Com a trava, a leitura de `owned` só acontece
    // depois do avanço commitar, vê "offer", e o guard de regressão dispara
    // corretamente.
    const seeded = await seedTrackedSuggestion();
    await setApplicationStatus(seeded.candidateId, seeded.jobId, "screening");
    const [app] = await db.select().from(application).where(eq(application.jobId, seeded.jobId));

    const rawConnection = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
    try {
      const tx = await rawConnection.reserve();
      try {
        await tx`begin`;
        await tx`select id from production.application where id = ${app!.id} for update`;

        const deciding = decideSuggestion(seeded.candidateId, seeded.suggestionId, "accepted");
        await untilSomeoneWaitsOnALock(rawConnection);

        // Avanço real, de outra sessão, enquanto `deciding` está bloqueada
        // (na leitura de `owned`, com a trava; na gravação, sem ela).
        const at1 = "2026-02-01T00:00:00.000Z";
        const at2 = "2026-02-01T00:00:01.000Z";
        await tx`update production.application set status = 'interviewing', updated_at = ${at1} where id = ${app!.id}`;
        await tx`
          insert into production.application_event (application_id, at, kind, from_status, to_status)
          values (${app!.id}, ${at1}, 'status_change', 'screening', 'interviewing')
        `;
        await tx`update production.application set status = 'offer', updated_at = ${at2} where id = ${app!.id}`;
        await tx`
          insert into production.application_event (application_id, at, kind, from_status, to_status)
          values (${app!.id}, ${at2}, 'status_change', 'interviewing', 'offer')
        `;
        await tx`commit`;

        await expect(deciding).rejects.toBeInstanceOf(RegressiveSuggestionError);
      } finally {
        tx.release();
      }
    } finally {
      await rawConnection.end({ timeout: 5 });
    }

    // A prova da trava: o avanço real sobrevive, e a sugestão continua
    // pendente — sem a trava, o status final seria "screening" (regredido em
    // silêncio) e a sugestão apareceria "accepted".
    const [tracked] = await db.select().from(application).where(eq(application.jobId, seeded.jobId));
    expect(tracked!.status).toBe("offer");
    const [suggestion] = await db
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, seeded.suggestionId));
    expect(suggestion).toMatchObject({ status: "pending", decidedAt: null });
  });
});
