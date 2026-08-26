/**
 * Prepara o ambiente do e2e.
 *
 * Cria uma conta dedicada, com senha conhecida. O e2e nunca deve depender da
 * credencial real de ninguém: uma senha de teste no repositório é um segredo
 * publicado, e apontar o teste para a conta do usuário significa que trocar a
 * própria senha quebra a suíte — foi exatamente o que aconteceu.
 *
 * Também limpa as tentativas falhas dessa conta. A suíte tenta entrar com
 * senha errada de propósito, e o limite de 8 em 15 minutos é real: depois de
 * algumas execuções ele bloquearia o teste com uma proteção que funcionou.
 */
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/core/db/client.ts";
import { authEvent, authLoginToken, authUser, candidate, candidateDocument, job, jobScore, scoreTask, targetAccount } from "../../src/core/db/schema.ts";
import { seedOwner } from "../../src/contexts/auth/app/seed.ts";
import { hashToken } from "../../src/contexts/auth/infra/drizzle-store.ts";
import { setPassword } from "../../src/contexts/auth/infra/password-login.ts";
import {
  currentDocument,
  ensureCandidate,
  saveDocument,
  syncCandidateFromProfile,
} from "../../src/core/candidate.ts";
import {
  ensureImportSource,
  upsertRawJob,
} from "../../src/core/ingest/manual.ts";
import { seedCatalog } from "../../src/contexts/skills/index.ts";
import { runMigrations } from "../../src/core/db/migrate.ts";
import { scoreOne } from "../../src/core/scoring/apply.ts";
import { TASK04_FIXTURES } from "./task04-fixtures.mjs";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";
const CLOSED_JOB_ID = Number(process.env.E2E_CLOSED_JOB_ID ?? TASK04_FIXTURES.closedJobId);
const DELETED_JOB_ID = Number(process.env.E2E_DELETED_JOB_ID ?? TASK04_FIXTURES.deletedJobId);

/**
 * Contas por papel.
 *
 * A suíte rodava com uma conta só, que é admin **e** candidato — e uma conta
 * assim não distingue o que cada papel enxerga. Pior: sem uma segunda conta não
 * há quem assumir, e a verificação de impersonação passava por não ter alvo, em
 * vez de por funcionar.
 *
 * Cada uma existe para um cenário específico:
 *
 *   candidato  — o que um candidato puro vê, sem menu de administração
 *   recrutador — sem vínculo, para provar que ele NÃO alcança currículo alheio
 *   alvo       — a conta que o admin assume no ciclo de impersonação
 *
 * Primeiro passo do E-06. O percurso completo por papel é o item inteiro.
 */
export const E2E_ROLES = {
  candidate: { email: "e2e-candidato@local.test", roles: ["candidate"] },
  recruiter: { email: "e2e-recrutador@local.test", roles: ["recruiter"] },
  target: { email: "e2e-alvo@local.test", roles: ["candidate"] },
  noCv: { email: "e2e-sem-cv@local.test", roles: ["candidate"] },
  // Existe para provar que senha certa em conta desabilitada não entra.
  disabled: { email: "e2e-desabilitada@local.test", roles: ["candidate"], disabled: true },
};

try {
  await runMigrations();

  // `force` porque a senha precisa ser conhecida a cada execução, e esta conta
  // existe só para o teste.
  await seedOwner({ email: EMAIL, password: PASSWORD, force: true });

  // A base temporária precisa ser autossuficiente. Em uma base real, estes
  // fixtures só entram quando o dado correspondente não existe, portanto o
  // E2E jamais substitui o currículo ou o acervo do usuário.
  const candidateId = await syncCandidateFromProfile();
  if (!(await currentDocument(candidateId, "cv"))) {
    await saveDocument({
      candidateId,
      kind: "cv",
      label: "E2E CV",
      format: "markdown",
      content:
        "# E2E Candidate\n\nSenior AI Software Architect with TypeScript, Python, distributed systems, LLM products, cloud architecture, observability, and technical leadership experience.",
    });
  }

  await ensureImportSource("ashby:e2e", "ashby", "e2e", "E2E Public Jobs");
  const [{ count }] = await getDb()
    .select({ count: sql`count(*)` })
    .from(job);
  if (Number(count) === 0) {
    const seeded = await upsertRawJob(
      {
        externalId: "public-role",
        companyName: "E2E Public Jobs",
        title: "Senior AI Software Architect",
        locationRaw: "Remote · Brazil",
        descriptionText:
          "Senior AI Software Architect for TypeScript, Python, distributed systems, LLM products, cloud architecture, observability, and technical leadership. Remote in Brazil and LATAM. The role designs reliable services, collaborates with product and engineering partners, documents trade-offs, improves delivery practices, and owns production quality across the full lifecycle. Experience with AWS, Docker, Kubernetes, CI/CD, security, testing, and data systems is valuable for the team and its customers.",
        url: "https://jobs.example.com/e2e-public-role",
        applyUrl: "https://jobs.example.com/e2e-public-role/apply",
        raw: { e2e: true },
      },
      "ashby:e2e",
    );
    await scoreOne(candidateId, seeded.jobId);
  }

  // The skills route needs the same catalog a real installation seeds with
  // `jho skills seed`; keeping it here makes the responsive market rows a
  // deterministic browser fixture instead of an empty-state accident.
  await seedCatalog();

  const resultFixtures = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: 901000000 + index,
      title: `Task 04 typical fixture ${index + 1}`,
      companyName: "Task 04 Typical Lab",
    })),
    ...Array.from({ length: 1001 }, (_, index) => ({
      id: 902000000 + index,
      title: `Task 04 bulk fixture ${index + 1}`,
      companyName: "Task 04 Bulk Lab",
    })),
  ];
  for (let offset = 0; offset < resultFixtures.length; offset += 100) {
    const batch = resultFixtures.slice(offset, offset + 100);
    await getDb().insert(job).values(batch.map((fixture) => ({
      id: fixture.id,
      fingerprint: `e2e:${fixture.id}`,
      contentHash: `e2e:${fixture.id}`,
      sourceId: "ashby:e2e",
      externalId: String(fixture.id),
      companyName: fixture.companyName,
      title: fixture.title,
      descriptionText: "Task 04 deterministic result-cardinality fixture.",
      url: `https://jobs.example.com/${fixture.id}`,
      raw: { e2e: true },
    }))).onConflictDoNothing({ target: job.id });
    await getDb().insert(jobScore).values(batch.map((fixture) => ({
      candidateId,
      jobId: fixture.id,
      fit: 60,
      titleScore: 10,
      keywordScore: 10,
      seniorityScore: 10,
      geoScore: 10,
      compScore: 10,
      freshnessScore: 5,
      benefitScore: 5,
      penalty: 0,
      cluster: "other",
      matchedKeywords: [],
      missingKeywords: [],
      reasons: [],
      blockers: [],
      scorerVersion: "e2e",
      profileHash: "e2e",
    }))).onConflictDoNothing({ target: [jobScore.candidateId, jobScore.jobId] });
  }

  await getDb().insert(targetAccount).values({
    id: TASK04_FIXTURES.referralContactId,
    name: "Task 04 referral contact",
    company: TASK04_FIXTURES.referralCompany,
    category: "former",
    notes: "Deterministic E2E fixture for contextual referral navigation.",
  }).onConflictDoUpdate({
    target: targetAccount.id,
    set: {
      name: "Task 04 referral contact",
      company: TASK04_FIXTURES.referralCompany,
      category: "former",
      notes: "Deterministic E2E fixture for contextual referral navigation.",
    },
  });

  await getDb().insert(job).values([
    {
      id: CLOSED_JOB_ID,
      fingerprint: "e2e:task04-closed",
      contentHash: "e2e:task04-closed",
      sourceId: "ashby:e2e",
      externalId: "task04-closed",
      companyName: "Task 04 Closed Lab",
      title: "Task 04 closed fixture",
      descriptionText: "Closed fixture remains readable as historical context.",
      url: "https://jobs.example.com/task04-closed",
      closedAt: "2026-08-24T00:00:00.000Z",
      raw: { e2e: true },
    },
    {
      id: DELETED_JOB_ID,
      fingerprint: "e2e:task04-deleted",
      contentHash: "e2e:task04-deleted",
      sourceId: "ashby:e2e",
      externalId: "task04-deleted",
      companyName: "Task 04 Deleted Lab",
      title: "Task 04 deleted fixture",
      url: "https://jobs.example.com/task04-deleted",
      raw: { e2e: true },
    },
  ]).onConflictDoNothing({ target: job.id });
  await getDb().delete(job).where(eq(job.id, DELETED_JOB_ID));

  // Contas por papel, cada uma com o próprio candidato quando o papel pede um.
  // O slug deriva do e-mail: apontar duas contas para o mesmo candidato seria
  // dar a uma o dado da outra, que é justamente o que a política impede.
  for (const { email, roles, disabled } of Object.values(E2E_ROLES)) {
    const [existing] = await getDb()
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email))
      .limit(1);
    if (existing) continue;

    const scoped = roles.includes("candidate")
      ? await ensureCandidate({ slug: `e2e-${email.split("@")[0]}`, name: email })
      : null;
    await getDb().insert(authUser).values({ email, roles, candidateId: scoped });
    // Mesma senha da conta principal: o que muda entre os cenários é o PAPEL, e
    // uma senha por conta só acrescentaria variável sem acrescentar cobertura.
    await setPassword(email, PASSWORD);
    if (disabled) {
      await getDb()
        .update(authUser)
        .set({ disabledAt: new Date().toISOString() })
        .where(eq(authUser.email, email));
    }
    if (email === E2E_ROLES.target.email && scoped !== null) {
      await getDb()
        .update(candidate)
        .set({ visibility: "public", publicCv: false })
        .where(eq(candidate.id, scoped));
    }
  }

  const [noCvQueueCandidate] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, E2E_ROLES.noCv.email))
    .limit(1);
  if (noCvQueueCandidate?.candidateId !== null && noCvQueueCandidate?.candidateId !== undefined) {
    // Keep this account in the first-use branch on every isolated run. A
    // previous attempt must not turn the no-CV contract into idle silently.
    await getDb().delete(candidateDocument).where(eq(candidateDocument.candidateId, noCvQueueCandidate.candidateId));
    await getDb().delete(scoreTask).where(eq(scoreTask.candidateId, noCvQueueCandidate.candidateId));
  }

  // O cenário idle precisa representar um candidato que já tem CV, mas não
  // possui uma tarefa de repontuação pendente. `saveDocument` enfileira por
  // design; removemos somente a tarefa desta fixture para manter o estado
  // neutro que o teste quer observar.
  const [idleQueueCandidate] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, E2E_ROLES.candidate.email))
    .limit(1);
  if (idleQueueCandidate?.candidateId !== null && idleQueueCandidate?.candidateId !== undefined) {
    if (!(await currentDocument(idleQueueCandidate.candidateId, "cv"))) {
      await saveDocument({
        candidateId: idleQueueCandidate.candidateId,
        kind: "cv",
        label: "E2E idle queue CV",
        format: "markdown",
        content: "# Idle queue fixture\n\nA valid CV without a pending ranking refresh.",
      });
    }
    await getDb()
      .delete(scoreTask)
      .where(eq(scoreTask.candidateId, idleQueueCandidate.candidateId));
  }

  const [failedQueueCandidate] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, E2E_ROLES.target.email))
    .limit(1);
  if (failedQueueCandidate?.candidateId !== null && failedQueueCandidate?.candidateId !== undefined) {
    await saveDocument({
      candidateId: failedQueueCandidate.candidateId,
      kind: "cv",
      label: "E2E failed queue CV",
      format: "markdown",
      content: "# Failed queue fixture\n\nA valid CV whose queue error must remain private.",
    });
    await getDb()
      .insert(scoreTask)
      .values({
        candidateId: failedQueueCandidate.candidateId,
        status: "failed",
        lastError: "RAW_E2E_QUEUE_ERROR_MUST_NOT_RENDER token=private",
      })
      .onConflictDoUpdate({
        target: scoreTask.candidateId,
        set: {
          status: "failed",
          scored: null,
          lastError: "RAW_E2E_QUEUE_ERROR_MUST_NOT_RENDER token=private",
        },
      });
  }

  const tokenFixtures = [
    {
      raw: process.env.E2E_RESET_EXPIRED_TOKEN ?? TASK04_FIXTURES.resetExpiredToken,
      email: E2E_ROLES.target.email,
      purpose: "reset",
      expiresAt: "2000-01-01T00:00:00.000Z",
      usedAt: null,
    },
    {
      raw: process.env.E2E_RESET_CONSUMED_TOKEN ?? TASK04_FIXTURES.resetConsumedToken,
      email: E2E_ROLES.target.email,
      purpose: "reset",
      expiresAt: "2100-01-01T00:00:00.000Z",
      usedAt: "2026-08-24T00:00:00.000Z",
    },
    {
      raw: process.env.E2E_RESET_RACE_TOKEN ?? TASK04_FIXTURES.resetRaceToken,
      email: E2E_ROLES.target.email,
      purpose: "reset",
      expiresAt: "2100-01-01T00:00:00.000Z",
      usedAt: null,
    },
    {
      raw: process.env.E2E_LOGIN_EXPIRED_TOKEN ?? TASK04_FIXTURES.loginExpiredToken,
      email: E2E_ROLES.candidate.email,
      purpose: "login",
      expiresAt: "2000-01-01T00:00:00.000Z",
      usedAt: null,
    },
    {
      raw: process.env.E2E_LOGIN_RACE_TOKEN ?? TASK04_FIXTURES.loginRaceToken,
      email: E2E_ROLES.candidate.email,
      purpose: "login",
      expiresAt: "2100-01-01T00:00:00.000Z",
      usedAt: null,
    },
  ];
  for (const { raw, ...fixture } of tokenFixtures) {
    await getDb().insert(authLoginToken).values({
      ...fixture,
      tokenHash: hashToken(raw),
    }).onConflictDoUpdate({
      target: authLoginToken.tokenHash,
      set: fixture,
    });
  }

  const cleared = await getDb()
    .delete(authEvent)
    .where(and(eq(authEvent.kind, "login_failed"), eq(authEvent.email, EMAIL)))
    .returning({ id: authEvent.id });

  console.log(
    `e2e: ${EMAIL} + ${Object.keys(E2E_ROLES).length} conta(s) por papel · ` +
      `${cleared.length} tentativa(s) limpa(s)`,
  );
} finally {
  closeDb();
}
