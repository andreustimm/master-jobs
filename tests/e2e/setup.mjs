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
import { application, authEvent, authLoginToken, authUser, candidate, candidateDocument, fxRate, job, jobScore, savedTerm, scoreTask, targetAccount, termAttribution } from "../../src/core/db/schema.ts";
import { linkRecruiterToCandidate } from "../../src/contexts/auth/index.ts";
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
import {
  createTrack,
  ensurePrimaryTrack,
  listCandidateTracks,
  saveTerm,
  setMatchingProfile,
  suggestTrack,
} from "../../src/contexts/matching/index.ts";
import { runMigrations } from "../../src/core/db/migrate.ts";
import { loadProfile } from "../../src/core/profile/load.ts";
import { scoreOne } from "../../src/core/scoring/apply.ts";
import { TASK04_FIXTURES } from "./task04-fixtures.mjs";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";
const CLOSED_JOB_ID = Number(process.env.E2E_CLOSED_JOB_ID ?? TASK04_FIXTURES.closedJobId);
const DELETED_JOB_ID = Number(process.env.E2E_DELETED_JOB_ID ?? TASK04_FIXTURES.deletedJobId);
const FUNNEL_JOB_ID = Number(process.env.E2E_FUNNEL_JOB_ID ?? TASK04_FIXTURES.funnelJobId);
const ARCHIVED_JOB_ID = Number(process.env.E2E_ARCHIVED_JOB_ID ?? TASK04_FIXTURES.archivedJobId);

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
  // Vinculado ao dono: lê o funil dele e nunca as trilhas nem os termos.
  linkedRecruiter: { email: "e2e-recrutador-vinculado@local.test", roles: ["recruiter"] },
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
  // A segunda fonte existe para o filtro de fontes ter o que escolher: com uma
  // só, o combo não aparece e a jornada não teria como ser percorrida.
  await ensureImportSource("lever:e2e", "lever", "e2e", "E2E Lever Jobs");
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
    ...Array.from({ length: 16 }, (_, index) => ({
      id: 903000000 + index,
      title: `Work mode fixture ${index + 1}`,
      companyName: "Work Mode QA",
      locationRaw: index < 13 ? "Remote · Brazil" : index === 13 ? "São Paulo · Hybrid" : index === 14 ? "São Paulo · On-site" : "São Paulo",
      remote: index < 13 ? true : null,
    })),
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
  // Notas são por trilha (ADR-008): as fixtures entram na trilha principal do
  // dono, que o profile.yaml define.
  const primaryTrack = await ensurePrimaryTrack(candidateId);
  if (!primaryTrack) throw new Error("E2E owner has no primary track");
  for (let offset = 0; offset < resultFixtures.length; offset += 100) {
    const batch = resultFixtures.slice(offset, offset + 100);
    await getDb().insert(job).values(batch.map((fixture) => ({
      id: fixture.id,
      fingerprint: `e2e:${fixture.id}`,
      contentHash: `e2e:${fixture.id}`,
      sourceId: "ashby:e2e",
      externalId: String(fixture.id),
      companyName: fixture.companyName,
      locationRaw: fixture.locationRaw,
      remote: fixture.remote,
      title: fixture.title,
      descriptionText: "Task 04 deterministic result-cardinality fixture.",
      url: `https://jobs.example.com/${fixture.id}`,
      raw: { e2e: true },
    }))).onConflictDoNothing({ target: job.id });
    await getDb().insert(jobScore).values(batch.map((fixture) => ({
      candidateId,
      trackId: primaryTrack.id,
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
    }))).onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });
  }

  // Busca por termo e trilhas (term-search-target-tracks, task_04): uma trilha
  // aceita, cotações para converter salário e vagas com pagamento em várias
  // moedas e períodos. Ids fixos, para os percursos lerem a mesma vaga sempre.
  await getDb().insert(fxRate).values(
    Object.entries({ BRL: 5, EUR: 0.9 }).map(([currency, rate]) => ({
      date: "2026-09-18",
      base: "USD",
      currency,
      rate,
      provider: "manual",
    })),
  ).onConflictDoNothing();
  let phpTrack = (await listCandidateTracks(candidateId)).find((track) => track.name === "PHP E2E");
  if (!phpTrack) {
    const created = await createTrack(candidateId, {
      name: "PHP E2E",
      target: suggestTrack({ term: "PHP", catalog: [], primary: primaryTrack.target }).target,
    });
    if (!created.ok) throw new Error(`E2E track: ${created.code}`);
    phpTrack = created.track;
    // As notas das fixtures são fixas; a repontuação que criar a trilha pede
    // não pode rodar por cima delas nem aparecer como pendente na tela.
    await getDb().delete(scoreTask).where(eq(scoreTask.candidateId, candidateId));
  }
  const payFixtures = [
    { id: 904000001, title: "Pay fixture USD year", compMax: 120000, compCurrency: "USD", compPeriod: "year", php: 85 },
    { id: 904000002, title: "Pay fixture BRL month", compMax: 60000, compCurrency: "BRL", compPeriod: "month", php: 80 },
    { id: 904000003, title: "Pay fixture USD hour", compMax: 80, compCurrency: "USD", compPeriod: "hour", php: 75 },
    { id: 904000004, title: "Pay fixture USD low", compMax: 4000, compCurrency: "USD", compPeriod: "month" },
    { id: 904000005, title: "Pay fixture undisclosed" },
    { id: 904000006, title: "Pay fixture ARS", compMax: 900000, compCurrency: "ARS", compPeriod: "month" },
  ];
  await getDb().insert(job).values(payFixtures.map((fixture) => ({
    id: fixture.id,
    fingerprint: `e2e:${fixture.id}`,
    contentHash: `e2e:${fixture.id}`,
    sourceId: "ashby:e2e",
    externalId: String(fixture.id),
    companyName: "Pay Fixture Lab",
    title: fixture.title,
    descriptionText: "Pay normalization fixture for the Jobs screen.",
    url: `https://jobs.example.com/${fixture.id}`,
    compMax: fixture.compMax ?? null,
    compCurrency: fixture.compCurrency ?? null,
    compPeriod: fixture.compPeriod ?? null,
    raw: { e2e: true },
  }))).onConflictDoNothing({ target: job.id });
  const fixtureScore = (jobId, trackId, fit) => ({
    candidateId, trackId, jobId, fit,
    titleScore: 10, keywordScore: 10, seniorityScore: 10, geoScore: 10, compScore: 4,
    freshnessScore: 5, benefitScore: 5, penalty: 0, cluster: "other",
    matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
    scorerVersion: "e2e", profileHash: "e2e",
  });
  await getDb().insert(jobScore).values([
    ...payFixtures.map((fixture) => fixtureScore(fixture.id, primaryTrack.id, 60)),
    ...payFixtures.filter((fixture) => fixture.php).map((fixture) => fixtureScore(fixture.id, phpTrack.id, fixture.php)),
  ]).onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });

  // Três publicações da mesma vaga em países diferentes, mais uma quarta que
  // repete o país: é o caso real do acervo, onde a mesma vaga aparece em até
  // 42 linhas. Fora de "Pay fixture" para não mexer nas contagens de salário.
  const grupoFixtures = [
    { id: 904000101, locationRaw: "Netherlands" },
    { id: 904000102, locationRaw: "France" },
    { id: 904000103, locationRaw: "São Paulo, State of São Paulo, Brazil" },
    { id: 904000104, locationRaw: "Rio de Janeiro, Rio de Janeiro, Brazil" },
  ];
  await getDb().insert(job).values(grupoFixtures.map((fixture) => ({
    id: fixture.id,
    fingerprint: `e2e:${fixture.id}`,
    contentHash: `e2e:${fixture.id}`,
    sourceId: "ashby:e2e",
    externalId: String(fixture.id),
    companyName: "Country Fixture Lab",
    title: "Engineering Manager Country Fixture",
    locationRaw: fixture.locationRaw,
    descriptionText: "Same posting, one line per country, for the grouping journey.",
    url: `https://jobs.example.com/${fixture.id}`,
    raw: { e2e: true },
  }))).onConflictDoNothing({ target: job.id });
  // A publicação de São Paulo é a que as varreduras de vazamento abrem na tela
  // de detalhe: a localização acentuada só passa por causa de
  // `data-user-content`, e as palavras-chave fazem renderizar as duas linhas
  // do cartão de score, que ficavam fora da varredura com listas vazias.
  await getDb()
    .insert(jobScore)
    .values(grupoFixtures.map((fixture) => ({
      ...fixtureScore(fixture.id, primaryTrack.id, 60),
      ...(fixture.id === 904000103
        ? { matchedKeywords: ["TypeScript"], missingKeywords: ["Kubernetes"] }
        : {}),
    })))
    .onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });

  // Uma vaga da segunda fonte, fora do termo "Pay fixture" para não mexer nas
  // contagens da jornada de salário, e dentro de "fixture" para a de fontes.
  const leverFixtureId = 904000007;
  await getDb().insert(job).values([{
    id: leverFixtureId,
    fingerprint: `e2e:${leverFixtureId}`,
    contentHash: `e2e:${leverFixtureId}`,
    sourceId: "lever:e2e",
    externalId: String(leverFixtureId),
    companyName: "Lever Fixture Lab",
    title: "Source fixture Lever",
    descriptionText: "Second source fixture for the Jobs screen source filter.",
    url: `https://jobs.example.com/${leverFixtureId}`,
    raw: { e2e: true },
  }]).onConflictDoNothing({ target: job.id });
  await getDb()
    .insert(jobScore)
    .values([fixtureScore(leverFixtureId, primaryTrack.id, 60)])
    .onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });

  // Tela Buscas (task_05): uma vaga que cita "Laravel" só na descrição e um
  // termo salvo que já trouxe duas vagas que o dono ainda não viu.
  const searchFixtures = [
    {
      id: 905000001,
      title: "Backend Platform Engineer",
      companyName: "Description Only Lab",
      descriptionText: "Owns the billing services, written in Laravel on PostgreSQL.",
    },
    { id: 905000011, title: "Seeded term fixture one", companyName: "Seeded Term Lab", descriptionText: "Brought in by a saved term." },
    { id: 905000012, title: "Seeded term fixture two", companyName: "Seeded Term Lab", descriptionText: "Brought in by a saved term." },
    // "Não me interessa": sem candidatura, para o fluxo arquivar e restaurar.
    { id: 905000021, title: "Platform Engineer", companyName: "Quokkaverse Labs", descriptionText: "Remote platform role for the dismiss flow." },
  ];
  await getDb().insert(job).values(searchFixtures.map((fixture) => ({
    ...fixture,
    fingerprint: `e2e:${fixture.id}`,
    contentHash: `e2e:${fixture.id}`,
    sourceId: "ashby:e2e",
    externalId: String(fixture.id),
    url: `https://jobs.example.com/${fixture.id}`,
    raw: { e2e: true },
  }))).onConflictDoNothing({ target: job.id });
  await getDb().insert(jobScore).values(searchFixtures.map((fixture) => fixtureScore(fixture.id, primaryTrack.id, 60)))
    .onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });
  // Título de board que não tem onde quebrar: em 320px o `h1` da tela de
  // detalhe passava da borda e a página rolava para o lado, porque item de
  // flex não encolhe abaixo do próprio conteúdo. Vem de uma vaga real
  // (Himalayas) achada na revisão da 1.15.2 em produção.
  const longTitleFixture = {
    id: 905000031,
    title: "Werkstudent*in Finance (Schwerpunkt Accounting/Controlling) Vollzeit/Teilzeit",
    companyName: "Langtitel Werkstudierendenvermittlung",
    descriptionText: "Long unbreakable title fixture for the width sweep.",
  };
  await getDb().insert(job).values({
    ...longTitleFixture,
    fingerprint: `e2e:${longTitleFixture.id}`,
    contentHash: `e2e:${longTitleFixture.id}`,
    sourceId: "ashby:e2e",
    externalId: String(longTitleFixture.id),
    url: `https://jobs.example.com/${longTitleFixture.id}`,
    raw: { e2e: true },
  }).onConflictDoNothing({ target: job.id });
  await getDb().insert(jobScore).values(fixtureScore(longTitleFixture.id, primaryTrack.id, 60))
    .onConflictDoNothing({ target: [jobScore.candidateId, jobScore.trackId, jobScore.jobId] });

  const seededTerm = await saveTerm(
    { candidateId },
    { term: "E2E Seeded Stack", trackId: primaryTrack.id },
    { now: new Date(), impersonated: false },
  );
  if (!seededTerm.ok && seededTerm.code !== "term_duplicate") throw new Error(`E2E term: ${seededTerm.code}`);
  // "Novas desde a última visita" parte do zero a cada execução.
  // Busca pedida agora: o termo mostra "de novo a partir de…", o rótulo mais
  // longo da tela Buscas, que é o que estourava o cartão no celular.
  const [seededRow] = await getDb()
    .update(savedTerm)
    .set({ lastVisitAt: null, lastRunRequestedAt: new Date().toISOString() })
    .where(eq(savedTerm.id, seededTerm.termId))
    .returning({ termKey: savedTerm.termKey });
  await getDb().insert(termAttribution).values(
    [905000011, 905000012].map((jobId) => ({ termKey: seededRow.termKey, jobId, platform: "remotive" })),
  ).onConflictDoNothing();

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
      id: FUNNEL_JOB_ID,
      fingerprint: "e2e:task04-funnel",
      contentHash: "e2e:task04-funnel",
      sourceId: "ashby:e2e",
      externalId: "task04-funnel",
      companyName: "Task 04 Funnel Lab",
      title: "Task 04 funnel fixture",
      descriptionText: "Funnel fixture exists to be moved through the pipeline.",
      url: "https://jobs.example.com/task04-funnel",
      raw: { e2e: true },
    },
    {
      id: ARCHIVED_JOB_ID,
      fingerprint: "e2e:task04-archived",
      contentHash: "e2e:task04-archived",
      sourceId: "ashby:e2e",
      externalId: "task04-archived",
      companyName: "Task 04 Archived Lab",
      title: "Task 04 archived fixture",
      descriptionText: "Archived fixture proves the application survives the posting.",
      url: "https://jobs.example.com/task04-archived",
      closedAt: "2026-03-01T00:00:00.000Z",
      archivedAt: "2026-07-01T00:00:00.000Z",
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

  const [ownerUser] = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, EMAIL)).limit(1);
  const [linkedRecruiter] = await getDb()
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, E2E_ROLES.linkedRecruiter.email))
    .limit(1);
  await linkRecruiterToCandidate(linkedRecruiter.id, candidateId, ownerUser.id);

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

  // Candidatura numa vaga já arquivada, para a conta que a suíte usa na sessão
  // principal. É estado de partida do cenário, não atalho de verificação: o
  // teste continua lendo o histórico pela tela.
  const [sessionCandidate] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, EMAIL))
    .limit(1);
  if (sessionCandidate?.candidateId) {
    await getDb()
      .insert(application)
      .values({
        candidateId: sessionCandidate.candidateId,
        jobId: ARCHIVED_JOB_ID,
        status: "applied",
        appliedAt: "2026-02-10T00:00:00.000Z",
      })
      .onConflictDoNothing();
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
    // Salvar termo pede trilha principal, e a sessão emprestada (E2E-019)
    // assume esta conta: ela recebe o perfil de matching do dono.
    await setMatchingProfile(failedQueueCandidate.candidateId, await loadProfile(true));
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
  await closeDb();
}
