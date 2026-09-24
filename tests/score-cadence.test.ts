import { and, eq, inArray, ne } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "../src/core/clock.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { candidateScoreQueues } from "../src/contexts/operations/infra/drizzle-sweep.ts";
import { saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate, job, jobScore, scoreCursor, source, sweepRun } from "../src/core/db/schema.ts";
import { scoreCandidate } from "../src/core/scoring/apply.ts";
import { runScoreQueue } from "../src/core/scoring/queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A cadência das notas (#288), contra o PostgreSQL de verdade: lote de cem,
 * mais recentes primeiro, cursor que retoma, e a passagem de "sem nota" para
 * a manutenção. As regras puras têm suíte própria (`score-batch.test.ts`);
 * aqui se prova que o SQL obedece a elas.
 */

const { GET } = await import("../app/api/cron/varredura/route.ts");

let db: DB;

const CURRICULO = [
  "Maria Souza — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
].join("\n");

const ENV_KEYS = ["CRON_SECRET", "JHO_ENV", "VERCEL_ENV"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  resetClock();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await releaseTestDb();
});

/** Relógio que anda um segundo a cada leitura: um prazo curto vence depois do primeiro lote. */
function relogioQueCorre(): void {
  let agora = Date.parse("2026-09-23T12:00:00.000Z");
  setClock({
    now: () => (agora += 1_000),
    iso: () => new Date(agora).toISOString(),
  });
}

/** Um prazo que só o primeiro lote da chamada respeita. */
const prazoCurto = () => Date.now() - 1;

/**
 * `n` vagas abertas com datas distintas. Metade tem `posted_at`; a outra metade
 * só `first_seen_at` — a ordem é pela data de publicação quando há, e pela
 * primeira vez que o acervo viu a vaga quando não há. Inseridas fora de ordem,
 * para que ordem de id não passe por ordem de recência.
 */
async function semearVagas(n: number): Promise<number[]> {
  await db.insert(source).values({ id: "manual:cadencia", kind: "manual", handle: "cadencia", label: "Cadência" }).onConflictDoNothing();
  const dia = (i: number) => new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 3_600_000).toISOString();
  const ordem = Array.from({ length: n }, (_, i) => (i * 7) % n);
  const linhas = await db
    .insert(job)
    .values(
      ordem.map((i) => ({
        sourceId: "manual:cadencia",
        companyName: "Acme",
        externalId: `c${i}`,
        title: "AI Solutions Architect",
        descriptionText: "Remote LATAM. rag, agentes, typescript, python, postgres, multi-tenant.",
        locationRaw: "Remote LATAM",
        url: `manual://cadencia/c${i}`,
        fingerprint: `c${i}`,
        contentHash: `c${i}`,
        raw: "{}",
        postedAt: i % 2 === 0 ? dia(i) : null,
        firstSeenAt: i % 2 === 0 ? "2026-01-01T00:00:00.000Z" : dia(i),
      })),
    )
    .returning({ id: job.id, externalId: job.externalId });
  // Da mais recente para a mais antiga.
  const porIndice = new Map(linhas.map((linha) => [Number(linha.externalId.slice(1)), linha.id]));
  return Array.from({ length: n }, (_, k) => porIndice.get(n - 1 - k)!);
}

async function criarCandidatoComCv(slug = "maria", cv = CURRICULO): Promise<number> {
  const [c] = await db.insert(candidate).values({ slug, name: slug }).returning({ id: candidate.id });
  await saveDocument({ candidateId: c!.id, label: "cv", content: cv });
  return c!.id;
}

async function notas(candidateId: number): Promise<number[]> {
  const linhas = await db.select({ jobId: jobScore.jobId }).from(jobScore).where(eq(jobScore.candidateId, candidateId));
  return linhas.map((linha) => linha.jobId).sort((a, b) => a - b);
}

const ordenado = (ids: number[]) => [...ids].sort((a, b) => a - b);

async function filaDe(candidateId: number) {
  return (await candidateScoreQueues()).find((entry) => entry.id === candidateId)?.queue;
}

describe("lote de cem, mais recentes primeiro, cursor que retoma", () => {
  it("cada chamada com prazo grava as cem seguintes na ordem de recência, e a última fecha a passada", async () => {
    await seedCatalog();
    const recentes = await semearVagas(250);
    const id = await criarCandidatoComCv();

    await scoreCandidate(id, { deadline: prazoCurto() });
    expect(await notas(id)).toEqual(ordenado(recentes.slice(0, 100)));
    const [meio] = await db.select().from(scoreCursor).where(eq(scoreCursor.candidateId, id));
    expect(meio).toMatchObject({ positionJobId: recentes[99], lastCompletedAt: null });
    expect(await filaDe(id)).toBe("sem-nota");

    // Retoma do cursor: as cem seguintes, sem repetir nenhuma.
    await scoreCandidate(id, { deadline: prazoCurto() });
    expect(await notas(id)).toEqual(ordenado(recentes.slice(0, 200)));

    await scoreCandidate(id, { deadline: prazoCurto() });
    expect(await notas(id)).toEqual(ordenado(recentes));
    const [fim] = await db.select().from(scoreCursor).where(eq(scoreCursor.candidateId, id));
    expect(fim).toMatchObject({ positionKey: null, positionJobId: null });
    expect(fim!.lastCompletedAt).not.toBeNull();
    expect(fim!.firstCompletedAt).toBe(fim!.lastCompletedAt);

    // Uma passada completa depois não apaga a primeira: é a medida de "tempo até completo".
    relogioQueCorre();
    await scoreCandidate(id);
    const [outra] = await db.select().from(scoreCursor).where(eq(scoreCursor.candidateId, id));
    expect(outra!.firstCompletedAt).toBe(fim!.firstCompletedAt);
    expect(outra!.lastCompletedAt).not.toBe(fim!.lastCompletedAt);
    // Completou uma passada na principal: sai de "sem nota".
    expect(await filaDe(id)).toBe("manutencao");
  });

  it("a fila de repontuação — a do `after()` de quem salva o currículo — segue o mesmo lote e a mesma ordem", async () => {
    await seedCatalog();
    const recentes = await semearVagas(250);
    const id = await criarCandidatoComCv();
    relogioQueCorre();

    const r = await runScoreQueue({ budgetMs: 1, worker: "web", prefer: id });

    expect(r).toMatchObject({ pontuadas: 100, adiadas: 1 });
    expect(await notas(id)).toEqual(ordenado(recentes.slice(0, 100)));
  });

  it("perfil mudou no meio de uma passada: recomeça do topo, em vez de retomar do meio", async () => {
    await seedCatalog();
    const recentes = await semearVagas(250);
    const id = await criarCandidatoComCv();
    await scoreCandidate(id);
    const [atual] = await db.select().from(scoreCursor).where(eq(scoreCursor.candidateId, id));

    // Uma manutenção parada no meio do acervo, gravada com o perfil de antes,
    // e todas as notas desse perfil — o estado logo depois de a pessoa mudar
    // o currículo ou editar a trilha.
    await db
      .update(scoreCursor)
      .set({ profileHash: "perfil-antigo", positionKey: "2026-01-05T00:00:00.000Z", positionJobId: recentes[149]! })
      .where(eq(scoreCursor.candidateId, id));
    await db.update(jobScore).set({ profileHash: "perfil-antigo" }).where(eq(jobScore.candidateId, id));

    await scoreCandidate(id, { deadline: prazoCurto() });

    const novas = await db
      .select({ jobId: jobScore.jobId })
      .from(jobScore)
      .where(and(eq(jobScore.candidateId, id), ne(jobScore.profileHash, "perfil-antigo")));
    expect(ordenado(novas.map((n) => n.jobId))).toEqual(ordenado(recentes.slice(0, 100)));
    // A passada completa anterior continua registrada: quem tem nota não volta a "sem nota".
    const [depois] = await db.select().from(scoreCursor).where(eq(scoreCursor.candidateId, id));
    expect(depois).toMatchObject({
      profileHash: atual!.profileHash,
      positionJobId: recentes[99],
      lastCompletedAt: atual!.lastCompletedAt,
      firstCompletedAt: atual!.firstCompletedAt,
    });
    expect(await filaDe(id)).toBe("manutencao");
  });

  it("sem prazo, a passada retomada do meio é seguida de outra do topo: vaga nova acima do cursor não fica para depois", async () => {
    await seedCatalog();
    const recentes = await semearVagas(250);
    const id = await criarCandidatoComCv();
    await scoreCandidate(id, { deadline: prazoCurto() });

    const [nova] = await db
      .insert(job)
      .values({
        sourceId: "manual:cadencia",
        companyName: "Acme",
        externalId: "nova",
        title: "AI Solutions Architect",
        descriptionText: "Remote LATAM. rag, agentes, typescript.",
        locationRaw: "Remote LATAM",
        url: "manual://cadencia/nova",
        fingerprint: "nova",
        contentHash: "nova",
        raw: "{}",
        postedAt: "2026-09-23T00:00:00.000Z",
      })
      .returning({ id: job.id });

    await scoreCandidate(id);

    expect(await notas(id)).toEqual(ordenado([...recentes, nova!.id]));
  });

  it("vaga fechada fica fora do lote", async () => {
    await seedCatalog();
    const recentes = await semearVagas(5);
    await db.update(job).set({ closedAt: "2026-09-23T00:00:00.000Z" }).where(inArray(job.id, recentes.slice(0, 2)));
    const id = await criarCandidatoComCv();

    await scoreCandidate(id);

    expect(await notas(id)).toEqual(ordenado(recentes.slice(2)));
  });
});

describe("as fatias da agenda, pela rota, em produção", () => {
  function pedido(fatia: string): NextRequest {
    return new NextRequest(`https://exemplo.test/api/cron/varredura?fatia=${fatia}`, {
      headers: { authorization: "Bearer segredo-de-verdade" },
    });
  }

  beforeEach(() => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    process.env.JHO_ENV = "production";
    delete process.env.VERCEL_ENV;
  });

  it("sem-nota completa o candidato novo, que passa para a manutenção; a métrica registra a unidade", async () => {
    await seedCatalog();
    const recentes = await semearVagas(150);
    const id = await criarCandidatoComCv();

    const r = await GET(pedido("sem-nota"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ slice: "sem-nota", items: 1, errors: 0 });
    expect(await notas(id)).toEqual(ordenado(recentes));
    expect(await filaDe(id)).toBe("manutencao");

    // Já atendido: a sem-nota não o vê mais, e a manutenção respeita o intervalo da reserva comum.
    expect((await (await GET(pedido("sem-nota"))).json()).units).toEqual([]);
    expect((await (await GET(pedido("manutencao"))).json()).units).toEqual([]);

    const unidades = await db.select().from(sweepRun).where(eq(sweepRun.unit, `pontuacao:${id}`));
    expect(unidades).toHaveLength(1);
    expect(unidades[0]).toMatchObject({ slice: "sem-nota", items: 150, errors: 0 });
  });

  it("fora de produção a mesma chamada não grava nota nenhuma", async () => {
    process.env.JHO_ENV = "staging";
    await seedCatalog();
    await semearVagas(3);
    const id = await criarCandidatoComCv();

    expect((await GET(pedido("sem-nota"))).status).toBe(503);
    expect(await notas(id)).toEqual([]);
    expect(await db.select().from(sweepRun)).toEqual([]);
  });
});
