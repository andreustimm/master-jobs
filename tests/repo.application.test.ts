import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowedTransitions,
  APPLICATION_STATUSES,
  FUNNEL_STATUSES,
  mailMayMove,
  OUT_OF_FUNNEL,
  transitionApplication,
  transitionDirection,
  transitionGroups,
  undoableEvent,
  undoTransition,
  type ApplicationStatus,
  type FunnelStatus,
  type RecordedStatusChange,
} from "../src/contexts/pursuit/domain/application.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  applicationTimeline,
  ApplicationTransitionConflictError,
  ApplicationUndoUnavailableError,
  listBoard,
  pipelineCounts,
  pipelineRows,
  setApplicationStatus,
  undoApplicationStatus,
} from "../src/core/db/repo.ts";
import { deleteClosedJobsWithoutApplication } from "../src/core/db/retention.ts";
import {
  application,
  applicationEvent,
  candidate,
  company,
  job,
  jobScore,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

/**
 * Suite: candidate-scoped Pursuit aggregate
 * Invariant: one candidate can never read or mutate another candidate's score or application.
 * Boundary IN: pure transition policy plus the real libSQL/Drizzle repository and transaction.
 * Boundary OUT: session authorization and browser wiring, owned by auth and E2E suites.
 */

let db: DB;

async function seedJob(): Promise<number> {
  // Mirrors what an ingest run produces: source ids are human-readable
  // ("greenhouse:acme"), and the job carries both fingerprint and contentHash.
  await db
    .insert(source)
    .values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" });
  const [c] = await db
    .insert(company)
    .values({ slug: "acme", name: "Acme" })
    .returning({ id: company.id });
  const [j] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:acme",
      companyId: c!.id,
      companyName: "Acme",
      externalId: "job-1",
      title: "Staff AI Engineer",
      url: "https://example.test/job-1",
      fingerprint: "fp-1",
      contentHash: "ch-1",
      raw: "{}",
    })
    .returning({ id: job.id });
  return j!.id;
}

async function seedCandidate(slug: string, isDefault = false): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: `Candidate ${slug}`, isDefault })
    .returning({ id: candidate.id });
  return row!.id;
}

async function seedScore(candidateId: number, jobId: number, fit: number): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    trackId: await primaryTrackId(db, candidateId),
    jobId,
    fit,
    titleScore: fit,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    freshnessScore: 0,
    benefitScore: 0,
    penalty: 0,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: "test",
  });
}

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

describe("setApplicationStatus", () => {
  it("creates the application on first call", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const rows = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("shortlisted");
    // Only `applied` stamps a date — a shortlist is not a candidacy.
    expect(rows[0]!.appliedAt).toBeNull();
  });

  it("stamps appliedAt when it first reaches applied", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");

    const [row] = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    expect(row!.appliedAt).toBeTruthy();
  });

  it("never moves appliedAt once set", async () => {
    // This is the invariant that matters: the application date is evidence of
    // when the user actually applied. A later status change must not rewrite it,
    // or every funnel-velocity number downstream becomes fiction.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");
    const [first] = await db.select().from(application).where(eq(application.jobId, jobId));

    await setApplicationStatus(candidateId, jobId, "screening");
    await setApplicationStatus(candidateId, jobId, "interviewing");

    const [after] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(after!.appliedAt).toBe(first!.appliedAt);
  });

  it("keeps exactly one application row per candidate and job", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    for (const s of ["shortlisted", "preparing", "applied", "screening"] as const) {
      await setApplicationStatus(candidateId, jobId, s);
    }
    const rows = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("screening");
  });

  it("records an event for every transition, with the previous status", async () => {
    // The event log is the audit trail. Losing `fromStatus` would make it
    // impossible to reconstruct the funnel after the fact.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    await setApplicationStatus(candidateId, jobId, "preparing");
    await setApplicationStatus(candidateId, jobId, "applied", "via referral");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));

    expect(events).toHaveLength(3);
    expect(events[0]!.fromStatus).toBeNull();
    expect(events[0]!.toStatus).toBe("shortlisted");
    expect(events[2]!.fromStatus).toBe("preparing");
    expect(events[2]!.toStatus).toBe("applied");
    expect(events[2]!.detail).toBe("via referral");
  });

  it("is idempotent when the requested status is already current", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(app!.status).toBe("shortlisted");
    expect(events).toHaveLength(1);
  });

  it("keeps a note written on a stage that does not move", async () => {
    // De um estado terminal a única transição oferecida é a atual, então salvar
    // uma nota cai sempre no caminho de no-op. Descartar ali era anunciar
    // sucesso sem gravar nada — o mesmo silêncio que o canal já não sofre.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");
    await setApplicationStatus(candidateId, jobId, "archived");

    await setApplicationStatus(candidateId, jobId, "archived", "Recrutador pediu para tentar de novo no Q3.");

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));

    expect(app!.status).toBe("archived");
    const notes = events.filter((event) => event.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.detail).toBe("Recrutador pediu para tentar de novo no Q3.");
    expect(notes[0]!.fromStatus).toBeNull();
    expect(notes[0]!.toStatus).toBeNull();
    // Nenhuma transição inventada: os dois `status_change` são os reais.
    expect(events.filter((event) => event.kind === "status_change")).toHaveLength(2);
  });

  it("rejects an illegal transition without changing history", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");
    await setApplicationStatus(candidateId, jobId, "rejected");

    await expect(setApplicationStatus(candidateId, jobId, "withdrawn")).rejects.toMatchObject({
      code: "illegal_transition",
      from: "rejected",
      to: "withdrawn",
    });

    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(app!.status).toBe("rejected");
    expect(app!.appliedAt).toBeTruthy();

    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(events).toHaveLength(2);
  });

  it("rolls the application update back when the event insert fails", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    await db.execute(sql.raw(`
      create function production.reject_application_event() returns trigger language plpgsql as $$
      begin raise exception 'forced event failure'; end $$;
      create trigger reject_application_event before insert on production.application_event
      for each row execute function production.reject_application_event()
    `));

    await expect(
      setApplicationStatus(candidateId, jobId, "preparing"),
    ).rejects.toThrow();

    const [after] = await db
      .select()
      .from(application)
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, after!.id));

    expect(after!.status).toBe("shortlisted");
    expect(events).toHaveLength(1);
  });

  it("commits only one of two competing transitions", async () => {
    // Um par que continua ilegal mesmo em sequência (encerramento para
    // encerramento): com as arestas de volta da #316, quase todo outro par vira
    // duas transições legais seguidas, e a corrida deixaria de ser observável.
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "applied");

    const outcomes = await Promise.allSettled([
      setApplicationStatus(candidateId, jobId, "rejected"),
      setApplicationStatus(candidateId, jobId, "withdrawn"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id));
    expect(["rejected", "withdrawn"]).toContain(app!.status);
    expect(events).toHaveLength(2);
    expect(events[1]!.toStatus).toBe(app!.status);
  });
});

describe("transitionApplication", () => {
  const AT = "2026-08-20T01:00:00.000Z";

  it("returns the next state for a legal transition", () => {
    const result = transitionApplication({ status: "shortlisted", appliedAt: null }, "preparing", AT);

    expect(result).toEqual({
      ok: true,
      changed: true,
      state: { status: "preparing", appliedAt: null },
      event: { kind: "status_change", fromStatus: "shortlisted", toStatus: "preparing", at: AT },
    });
  });

  it("rejects swapping one closing state for another", () => {
    expect(transitionApplication({ status: "rejected", appliedAt: AT }, "withdrawn", AT)).toEqual({
      ok: false,
      error: { code: "illegal_transition", from: "rejected", to: "withdrawn" },
    });
  });

  it("covers every persisted status pair", () => {
    // Avançar um passo; voltar para qualquer estágio anterior; encerramentos
    // reabrem para qualquer estágio de progresso; arquivar de todo progresso;
    // rejeitar e retirar só depois de enviar (#316).
    const progress = ["backlog", "shortlisted", "preparing", "applied", "screening", "interviewing", "offer"] as const;
    const legal: Record<FunnelStatus, readonly ApplicationStatus[]> = {
      backlog: ["shortlisted", "archived"],
      shortlisted: ["backlog", "preparing", "archived"],
      preparing: ["backlog", "shortlisted", "applied", "archived"],
      applied: ["backlog", "shortlisted", "preparing", "screening", "rejected", "withdrawn", "archived"],
      screening: ["backlog", "shortlisted", "preparing", "applied", "interviewing", "rejected", "withdrawn", "archived"],
      interviewing: [...progress.slice(0, 5), "offer", "rejected", "withdrawn", "archived"],
      offer: [...progress.slice(0, 6), "rejected", "withdrawn", "archived"],
      rejected: progress,
      withdrawn: progress,
      archived: progress,
    };

    for (const from of FUNNEL_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        const result = transitionApplication({ status: from, appliedAt: null }, to, AT);
        expect(result.ok, `${from} -> ${to}`).toBe(from === to || legal[from].includes(to));
      }
    }
  });

  it("offers exactly the statuses the transition policy accepts, grouped by direction", () => {
    // A lista da interface é derivada, nunca uma segunda cópia da regra.
    for (const from of FUNNEL_STATUSES) {
      const accepted = FUNNEL_STATUSES.filter((to) => transitionApplication({ status: from, appliedAt: null }, to, AT).ok);
      expect(allowedTransitions(from), from).toEqual(accepted);

      const groups = transitionGroups(from);
      for (const [direction, members] of Object.entries(groups)) {
        for (const to of members) expect(transitionDirection(from, to), `${from} -> ${to}`).toBe(direction);
      }
      expect(new Set([from, ...groups.forward, ...groups.back, ...groups.close])).toEqual(new Set(accepted));
    }
  });

  it("lists every earlier stage under 'back', in funnel order", () => {
    expect(transitionGroups("interviewing")).toEqual({
      forward: ["offer"],
      back: ["backlog", "shortlisted", "preparing", "applied", "screening"],
      close: ["rejected", "withdrawn", "archived"],
    });
    // "Preparando" era beco sem saída: nem arquivar.
    expect(transitionGroups("preparing").close).toEqual(["archived"]);
  });

  it("reopens rejected, withdrawn and archived — even after applying — and keeps appliedAt", () => {
    const applied = "2026-08-01T00:00:00.000Z";
    for (const closed of ["rejected", "withdrawn", "archived"] as const) {
      expect(transitionGroups(closed).back, closed).toEqual(["backlog", "shortlisted", "preparing", "applied", "screening", "interviewing", "offer"]);
      expect(transitionApplication({ status: closed, appliedAt: applied }, "screening", AT)).toMatchObject({
        ok: true,
        state: { status: "screening", appliedAt: applied },
      });
    }
  });

  it("preserves appliedAt when moving back from screening to shortlisted", () => {
    const applied = "2026-08-01T00:00:00.000Z";
    expect(transitionApplication({ status: "screening", appliedAt: applied }, "shortlisted", AT)).toMatchObject({
      ok: true,
      state: { status: "shortlisted", appliedAt: applied },
    });
  });

  it("never lets a command move into 'out of the funnel' — only undo reaches it", () => {
    for (const from of [null, ...FUNNEL_STATUSES]) {
      const current = from === null ? null : { status: from, appliedAt: null };
      expect(transitionApplication(current, OUT_OF_FUNNEL, AT).ok, String(from)).toBe(false);
    }
  });

  it("treats 'out of the funnel' as a first observation again", () => {
    expect(allowedTransitions(OUT_OF_FUNNEL)).toEqual(FUNNEL_STATUSES);
    expect(transitionApplication({ status: OUT_OF_FUNNEL, appliedAt: null }, "interviewing", AT)).toEqual({
      ok: true,
      changed: true,
      state: { status: "interviewing", appliedAt: null },
      event: { kind: "status_change", fromStatus: null, toStatus: "interviewing", at: AT },
    });
  });

  it("degrades instead of crashing on a status outside the funnel", () => {
    // A coluna é `text` sem CHECK no banco, e a função roda ao renderizar a tela.
    const unknown = "triaging" as ApplicationStatus;

    expect(() => allowedTransitions(unknown)).not.toThrow();
    expect(allowedTransitions(unknown)).toEqual([unknown]);
    expect(transitionGroups(unknown)).toEqual({ forward: [], back: [], close: [] });
  });

  it("offers every funnel status before the first observation", () => {
    expect(allowedTransitions(null)).toEqual(FUNNEL_STATUSES);
  });
});

describe("e-mail nunca regride o funil", () => {
  it("aceita avançar e encerrar, recusa voltar e recusa quem está fora do funil", () => {
    expect(mailMayMove("applied", "screening")).toBe(true);
    expect(mailMayMove("interviewing", "rejected")).toBe(true);
    expect(mailMayMove("interviewing", "applied")).toBe(false);
    expect(mailMayMove("rejected", "interviewing")).toBe(false);
    expect(mailMayMove(OUT_OF_FUNNEL, "applied")).toBe(false);
  });
});

describe("desfazer (domínio)", () => {
  const T1 = "2026-08-01T00:00:00.000Z";
  const T2 = "2026-08-02T00:00:00.000Z";
  const T3 = "2026-08-03T00:00:00.000Z";
  const NOW = "2026-08-04T00:00:00.000Z";
  const change = (
    id: number,
    at: string,
    fromStatus: ApplicationStatus | null,
    toStatus: ApplicationStatus,
    revertsEventId: number | null = null,
  ): RecordedStatusChange => ({ id, at, fromStatus, toStatus, revertsEventId });

  it("reverte a última movimentação com um evento compensatório que aponta para ela", () => {
    const events = [change(2, T2, "shortlisted", "preparing"), change(1, T1, null, "shortlisted")];
    const result = undoTransition({ status: "preparing", appliedAt: null }, events, 2, NOW);

    expect(result).toEqual({
      ok: true,
      state: { status: "shortlisted", appliedAt: null },
      event: { kind: "status_change", fromStatus: "preparing", toStatus: "shortlisted", at: NOW, revertsEventId: 2 },
    });
  });

  it("desfazer de novo recua mais um passo, pulando desfeitos e desfazeres", () => {
    const events = [
      change(3, T3, "preparing", "shortlisted", 2),
      change(2, T2, "shortlisted", "preparing"),
      change(1, T1, null, "shortlisted"),
    ];
    expect(undoableEvent({ status: "shortlisted", appliedAt: null }, events)?.id).toBe(1);
  });

  it("desfazer o primeiro registro deixa a candidatura fora do funil", () => {
    const result = undoTransition({ status: "shortlisted", appliedAt: null }, [change(1, T1, null, "shortlisted")], 1, NOW);
    expect(result).toMatchObject({ ok: true, state: { status: OUT_OF_FUNNEL, appliedAt: null } });
  });

  it("limpa appliedAt só ao desfazer a própria entrada em 'Candidatura enviada'", () => {
    const own = undoTransition({ status: "applied", appliedAt: T2 }, [change(2, T2, "preparing", "applied"), change(1, T1, null, "preparing")], 2, NOW);
    expect(own).toMatchObject({ ok: true, state: { status: "preparing", appliedAt: null } });

    // Reentrada depois de um recuo: a data real da candidatura é a de T1.
    const reentry = undoTransition({ status: "applied", appliedAt: T1 }, [change(3, T3, "preparing", "applied"), change(2, T2, "applied", "preparing"), change(1, T1, null, "applied")], 3, NOW);
    expect(reentry).toMatchObject({ ok: true, state: { status: "preparing", appliedAt: T1 } });

    const later = undoTransition({ status: "screening", appliedAt: T1 }, [change(2, T2, "applied", "screening"), change(1, T1, null, "applied")], 2, NOW);
    expect(later).toMatchObject({ ok: true, state: { status: "applied", appliedAt: T1 } });
  });

  it("recusa com 'stale' quando o evento visto não é mais o último", () => {
    const events = [change(2, T2, "shortlisted", "preparing"), change(1, T1, null, "shortlisted")];
    expect(undoTransition({ status: "preparing", appliedAt: null }, events, 1, NOW)).toEqual({ ok: false, error: { code: "stale" } });
  });

  it("não desfaz nada sem histórico, fora do funil nem com trilha que não leva ao estado atual", () => {
    expect(undoTransition({ status: "preparing", appliedAt: null }, [], 1, NOW)).toEqual({ ok: false, error: { code: "nothing_to_undo" } });
    expect(undoableEvent({ status: OUT_OF_FUNNEL, appliedAt: null }, [change(2, T2, "shortlisted", OUT_OF_FUNNEL, 1), change(1, T1, null, "shortlisted")])).toBeNull();
    expect(undoableEvent({ status: "offer", appliedAt: null }, [change(1, T1, null, "shortlisted")])).toBeNull();
  });
});

describe("histórico da candidatura", () => {
  it("devolve os eventos do próprio candidato, do mais recente para o mais antigo", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted", "Vale olhar com calma.");
    await setApplicationStatus(candidateId, jobId, "preparing", "Revisar arquitetura antes de aplicar.");

    const timeline = await applicationTimeline(candidateId, jobId);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      kind: "status_change",
      fromStatus: "shortlisted",
      toStatus: "preparing",
      detail: "Revisar arquitetura antes de aplicar.",
    });
    expect(timeline[1]).toMatchObject({ fromStatus: null, toStatus: "shortlisted" });
  });

  it("não devolve o histórico de outro candidato nem de quem não tem escopo", async () => {
    // A nota é texto que a pessoa escreveu sobre a própria candidatura: ler a
    // de outra conta seria o mesmo que ler o funil alheio.
    const owner = await seedCandidate("owner", true);
    const other = await seedCandidate("other");
    const jobId = await seedJob();
    await setApplicationStatus(owner, jobId, "shortlisted", "Nota privada do dono.");

    expect(await applicationTimeline(other, jobId)).toEqual([]);
    expect(await applicationTimeline(null, jobId)).toEqual([]);
  });
});

describe("candidate-scoped read models", () => {
  it("isolates scores, applications and funnel counts for the same job", async () => {
    const firstCandidate = await seedCandidate("first", true);
    const secondCandidate = await seedCandidate("second");
    const jobId = await seedJob();

    await seedScore(firstCandidate, jobId, 91);
    await seedScore(secondCandidate, jobId, 17);
    await setApplicationStatus(firstCandidate, jobId, "shortlisted");
    await setApplicationStatus(secondCandidate, jobId, "applied");

    const [firstBoard, secondBoard, firstCounts, secondCounts] = await Promise.all([
      listBoard(firstCandidate, { minFit: 0 }),
      listBoard(secondCandidate, { minFit: 0 }),
      pipelineCounts(firstCandidate),
      pipelineCounts(secondCandidate),
    ]);

    expect(firstBoard[0]).toMatchObject({ jobId, fit: 91, status: "shortlisted" });
    expect(secondBoard[0]).toMatchObject({ jobId, fit: 17, status: "applied" });
    expect(firstCounts).toEqual({ shortlisted: 1 });
    expect(secondCounts).toEqual({ applied: 1 });
  });
});

describe("desfazer e voltar (repositório)", () => {
  async function eventsOf(jobId: number) {
    const [app] = await db.select().from(application).where(eq(application.jobId, jobId));
    const events = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, app!.id))
      .orderBy(applicationEvent.id);
    return { app: app!, events };
  }

  it("desfazer grava exatamente um evento novo e nunca faz UPDATE nem DELETE no histórico", async () => {
    // A prova é o banco: com um gatilho que recusa UPDATE e DELETE em
    // `application_event`, mover, voltar e desfazer continuam funcionando.
    await db.execute(sql.raw(`
      create function production.forbid_event_rewrite() returns trigger language plpgsql as $$
      begin raise exception 'application_event é append-only'; end $$;
      create trigger forbid_event_rewrite before update or delete on production.application_event
      for each row execute function production.forbid_event_rewrite()
    `));
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    const moved = await setApplicationStatus(candidateId, jobId, "preparing");
    const before = await eventsOf(jobId);

    await undoApplicationStatus(candidateId, jobId, moved!);

    const after = await eventsOf(jobId);
    expect(after.events).toHaveLength(before.events.length + 1);
    expect(after.events.slice(0, -1)).toEqual(before.events);
    expect(after.events.at(-1)).toMatchObject({
      kind: "status_change",
      fromStatus: "preparing",
      toStatus: "shortlisted",
      revertsEventId: moved,
    });
    expect(after.app.status).toBe("shortlisted");

    const timeline = await applicationTimeline(candidateId, jobId);
    expect(timeline.find((event) => event.revertsEventId === moved)).toBeDefined();
  });

  it("desfazer a entrada em 'Candidatura enviada' limpa appliedAt; voltar de Triagem para Pré-selecionada preserva", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    await setApplicationStatus(candidateId, jobId, "preparing");
    const sent = await setApplicationStatus(candidateId, jobId, "applied");
    await undoApplicationStatus(candidateId, jobId, sent!);
    expect((await eventsOf(jobId)).app).toMatchObject({ status: "preparing", appliedAt: null });

    await setApplicationStatus(candidateId, jobId, "applied");
    const { app: applied } = await eventsOf(jobId);
    await setApplicationStatus(candidateId, jobId, "screening");
    await setApplicationStatus(candidateId, jobId, "shortlisted", "Recrutador pediu para refazer o teste.");
    const { app, events } = await eventsOf(jobId);
    expect(app.status).toBe("shortlisted");
    expect(app.appliedAt).toBe(applied.appliedAt);
    expect(events.at(-1)).toMatchObject({ fromStatus: "screening", toStatus: "shortlisted", revertsEventId: null });
  });

  it("desfazer o primeiro registro tira a vaga do funil e das contagens, mas ela segue protegida da retenção", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    const first = await setApplicationStatus(candidateId, jobId, "shortlisted");

    await undoApplicationStatus(candidateId, jobId, first!);

    const { app, events } = await eventsOf(jobId);
    expect(app.status).toBe(OUT_OF_FUNNEL);
    expect(events).toHaveLength(2);
    expect(await pipelineCounts(candidateId)).toEqual({});
    expect(await pipelineRows(candidateId)).toEqual([]);
    const board = await listBoard(candidateId, { minFit: 0, status: "unfiled" });
    expect(board.map((row) => row.jobId)).toContain(jobId);

    // Fechada há muito tempo, a vaga seria descartada — se não tivesse linha.
    await db.update(job).set({ closedAt: "2000-01-01T00:00:00.000Z" }).where(eq(job.id, jobId));
    const removed = await db.transaction((tx) => deleteClosedJobsWithoutApplication(tx, "2026-01-01T00:00:00.000Z"));
    expect(removed).toEqual([]);

    // E voltar ao funil é uma primeira observação de novo.
    await setApplicationStatus(candidateId, jobId, "interviewing");
    expect((await eventsOf(jobId)).events.at(-1)).toMatchObject({ fromStatus: null, toStatus: "interviewing" });
    expect(await pipelineCounts(candidateId)).toEqual({ interviewing: 1 });
  });

  it("conflito: outra aba moveu depois do aviso, e desfazer o evento visto é recusado", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    const seen = await setApplicationStatus(candidateId, jobId, "preparing");
    await setApplicationStatus(candidateId, jobId, "applied");

    await expect(undoApplicationStatus(candidateId, jobId, seen!)).rejects.toBeInstanceOf(ApplicationTransitionConflictError);
    expect((await eventsOf(jobId)).app.status).toBe("applied");
  });

  it("dois desfazeres do mesmo evento: só um grava", async () => {
    const candidateId = await seedCandidate("one", true);
    const jobId = await seedJob();
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    const moved = await setApplicationStatus(candidateId, jobId, "preparing");

    const outcomes = await Promise.allSettled([
      undoApplicationStatus(candidateId, jobId, moved!),
      undoApplicationStatus(candidateId, jobId, moved!),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const { app, events } = await eventsOf(jobId);
    expect(app.status).toBe("shortlisted");
    expect(events.filter((event) => event.revertsEventId === moved)).toHaveLength(1);
  });

  it("não desfaz candidatura de outro candidato nem sem histórico", async () => {
    const owner = await seedCandidate("owner", true);
    const other = await seedCandidate("other");
    const jobId = await seedJob();
    const moved = await setApplicationStatus(owner, jobId, "shortlisted");

    await expect(undoApplicationStatus(other, jobId, moved!)).rejects.toBeInstanceOf(ApplicationUndoUnavailableError);
    expect((await eventsOf(jobId)).app.status).toBe("shortlisted");
  });
});
