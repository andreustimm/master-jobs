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
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client.ts";
import { withDuplicateKeyRetry } from "./retry.ts";
import { candidate, candidateDocument, job, source } from "./schema.ts";
import {
  CANDIDATE_FIXTURES,
  JOB_FIXTURES,
  validateFixtures,
  type CandidateFixture,
  type JobFixture,
} from "./fixtures.ts";

export const FIXTURE_SOURCE_ID = "fixture:sample";

/** Rótulo fixo: é ele que dá identidade ao currículo de exemplo entre execuções. */
export const FIXTURE_CV_LABEL = "Currículo de exemplo";

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
  await withDuplicateKeyRetry(async () => {
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
  });
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

  // Upsert, não ler-depois-escrever: entre o SELECT e o INSERT cabe outra
  // execução do seed, e três deploys simultâneos inseririam a mesma vaga três
  // vezes. Quem garante a identidade é o índice único, não a janela de tempo.
  // Reescreve só o conteúdo declarado: `firstSeenAt` e o que a aplicação tiver
  // produzido em cima da vaga não são da fixture.
  const [row] = await withDuplicateKeyRetry(() =>
    db
      .insert(job)
      .values(values)
      .onConflictDoUpdate({ target: job.fingerprint, set: values })
      // `xmax` é zero na linha recém-inserida e carrega a transação que a
      // atualizou quando o conflito disparou — é a resposta do próprio
      // PostgreSQL para "isto nasceu agora?", sem segunda consulta.
      .returning({ inserted: sql<boolean>`(xmax = 0)` }),
  );

  return row!.inserted ? "inserted" : "updated";
}

async function seedCandidate(fixture: CandidateFixture): Promise<"inserted" | "updated"> {
  const db = getDb();
  const [row] = await withDuplicateKeyRetry(() =>
    db
      .insert(candidate)
      .values({ slug: fixture.slug, name: fixture.name })
      .onConflictDoUpdate({ target: candidate.slug, set: { name: fixture.name } })
      .returning({ id: candidate.id, inserted: sql<boolean>`(xmax = 0)` }),
  );

  const candidateId = row!.id;
  const outcome = row!.inserted ? "inserted" : "updated";

  if (fixture.cv) {
    // A identidade do currículo corrente é a que o banco já impõe:
    // `(candidate_id, kind) where is_current`. A versão anterior procurava por
    // rótulo e, quando não achava, inseria — duas execuções simultâneas não
    // achavam nada e inseriam as duas. `FOR UPDATE` não segurava isso porque
    // não existe linha para travar; quem resolve é o conflito no índice.
    await withDuplicateKeyRetry(() =>
      db
        .insert(candidateDocument)
        .values({
          candidateId,
          kind: "cv",
          label: FIXTURE_CV_LABEL,
          format: "markdown",
          content: fixture.cv!,
        })
        .onConflictDoUpdate({
          target: [candidateDocument.candidateId, candidateDocument.kind],
          targetWhere: sql`${candidateDocument.isCurrent} = true`,
          set: { label: FIXTURE_CV_LABEL, format: "markdown", content: fixture.cv! },
        }),
    );
  }

  return outcome;
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
