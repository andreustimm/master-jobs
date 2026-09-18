/**
 * Escreve o acervo de exemplo, e escreve de novo sem duplicar.
 *
 * Idempotência aqui não é elegância: dev e staging semeiam a cada deploy, e um
 * seed que insere de novo transforma dez vagas em trinta na terceira semana.
 * A identidade vem do `externalId` da fixture e do slug do candidato — dados
 * declarados, estáveis entre execuções —, nunca de um id gerado.
 *
 * O seed não liga ingestão: ele escreve direto no acervo, sem adapter e sem
 * rede, e é por isso que roda em ambiente onde a política de ingestão nega.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./client.ts";
import { candidate, candidateDocument, job, source } from "./schema.ts";
import {
  CANDIDATE_FIXTURES,
  JOB_FIXTURES,
  validateFixtures,
  type CandidateFixture,
  type JobFixture,
} from "./fixtures.ts";

export const FIXTURE_SOURCE_ID = "fixture:sample";

export type FixtureSeedResult = {
  jobs: { inserted: number; updated: number };
  candidates: { inserted: number; updated: number };
};

/**
 * `fingerprint` e `contentHash` derivam do `externalId` porque a fixture não
 * tem anúncio de origem para resumir. Estáveis de propósito: reexecutar o seed
 * precisa reencontrar a mesma linha.
 */
function fingerprintFor(fixture: JobFixture): string {
  return `${FIXTURE_SOURCE_ID}:${fixture.externalId}`;
}

async function ensureFixtureSource(): Promise<void> {
  await getDb()
    .insert(source)
    .values({
      id: FIXTURE_SOURCE_ID,
      kind: "manual",
      handle: "sample",
      label: "Acervo de exemplo",
      rationale: "Fixtures de dev/staging — ADR 0021. Nenhuma rede envolvida.",
    })
    .onConflictDoNothing({ target: source.id });
}

async function seedJob(fixture: JobFixture): Promise<"inserted" | "updated"> {
  const db = getDb();
  const fingerprint = fingerprintFor(fixture);
  const values = {
    sourceId: FIXTURE_SOURCE_ID,
    externalId: fixture.externalId,
    fingerprint,
    contentHash: fingerprint,
    companyName: fixture.companyName,
    title: fixture.title,
    descriptionText: fixture.descriptionText,
    locationRaw: fixture.locationRaw,
    remote: fixture.remote,
    url: fixture.url,
    closedAt: fixture.closedAt,
    raw: { fixture: true },
  };

  const [existing] = await db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.fingerprint, fingerprint))
    .limit(1);

  if (!existing) {
    await db.insert(job).values(values);
    return "inserted";
  }

  // Reescreve o conteúdo declarado — e só ele. `firstSeenAt` e o que a
  // aplicação tiver produzido em cima da vaga não são da fixture.
  await db.update(job).set(values).where(eq(job.id, existing.id));
  return "updated";
}

async function seedCandidate(fixture: CandidateFixture): Promise<"inserted" | "updated"> {
  const db = getDb();
  const [existing] = await db
    .select({ id: candidate.id })
    .from(candidate)
    .where(eq(candidate.slug, fixture.slug))
    .limit(1);

  const candidateId = existing?.id ?? (
    await db
      .insert(candidate)
      .values({ slug: fixture.slug, name: fixture.name })
      .returning({ id: candidate.id })
  )[0]!.id;

  if (existing) {
    await db.update(candidate).set({ name: fixture.name }).where(eq(candidate.id, candidateId));
  }

  if (fixture.cv) {
    // Documento por rótulo fixo: reexecutar não empilha versões de currículo,
    // que é o que aconteceria com um insert cego a cada seed.
    const [document] = await db
      .select({ id: candidateDocument.id })
      .from(candidateDocument)
      .where(and(
        eq(candidateDocument.candidateId, candidateId),
        eq(candidateDocument.label, "Currículo de exemplo"),
      ))
      .limit(1);

    if (document) {
      await db
        .update(candidateDocument)
        .set({ content: fixture.cv })
        .where(eq(candidateDocument.id, document.id));
    } else {
      await db.insert(candidateDocument).values({
        candidateId,
        kind: "cv",
        label: "Currículo de exemplo",
        format: "markdown",
        content: fixture.cv,
      });
    }
  }

  return existing ? "updated" : "inserted";
}

/**
 * Semeia o acervo de exemplo. Valida antes de escrever: fixture inválida vira
 * erro de configuração, não meia carga no banco.
 */
export async function seedFixtures(): Promise<FixtureSeedResult> {
  const validation = validateFixtures();
  if (!validation.ok) {
    throw new Error(`Invalid fixture corpus: ${validation.problems.join("; ")}`);
  }

  await ensureFixtureSource();

  const result: FixtureSeedResult = {
    jobs: { inserted: 0, updated: 0 },
    candidates: { inserted: 0, updated: 0 },
  };

  // Sequencial de propósito: o seed roda uma vez por deploy e a ordem estável
  // torna a saída comparável entre execuções. Paralelizar economizaria
  // milissegundos e tiraria isso.
  for (const fixture of JOB_FIXTURES) {
    result.jobs[await seedJob(fixture) === "inserted" ? "inserted" : "updated"] += 1;
  }

  for (const fixture of CANDIDATE_FIXTURES) {
    result.candidates[await seedCandidate(fixture) === "inserted" ? "inserted" : "updated"] += 1;
  }

  return result;
}

/** Quantas linhas de fixture existem agora — para o teste afirmar o teto. */
export async function countFixtures(): Promise<{ jobs: number; candidates: number }> {
  const db = getDb();
  const jobs = await db.select({ id: job.id }).from(job).where(eq(job.sourceId, FIXTURE_SOURCE_ID));
  const candidates = await db.select({ id: candidate.id }).from(candidate);
  return { jobs: jobs.length, candidates: candidates.length };
}
