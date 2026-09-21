import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/core/db/client.ts";
import { runMigrations } from "../../src/core/db/migrate.ts";
import { authUser, candidate, scoreTask } from "../../src/core/db/schema.ts";
import { ensureCandidate, saveDocument, syncCandidateFromProfile } from "../../src/core/candidate.ts";
import { setPassword } from "../../src/contexts/auth/infra/password-login.ts";
import { ensureImportSource, upsertRawJob } from "../../src/core/ingest/manual.ts";
import { seedCatalog } from "../../src/contexts/skills/index.ts";
import { ensureMatchingProfile } from "../../src/contexts/matching/index.ts";
import { scoreOne } from "../../src/core/scoring/apply.ts";
import type { Role } from "../../src/contexts/auth/domain/types.ts";

// This fixture is never a production seed. Refuse before migrations or writes.
const refusal = "Manual QA requires a freshly provisioned isolated test database";
let url: URL;
try { url = new URL(process.env.DATABASE_URL ?? ""); }
catch { throw new Error(refusal); }
if (url.hostname !== "127.0.0.1" || !/^\/jho_test_[a-f0-9]{32}$/.test(url.pathname) ||
    process.env.DATABASE_MIGRATION_URL !== process.env.DATABASE_URL ||
    process.env.JHO_TEST_DATABASE_URL !== process.env.DATABASE_URL) {
  throw new Error(refusal);
}

try {
  await runMigrations();
  const owner = await syncCandidateFromProfile();
  await getDb().update(candidate).set({ name: "Alex Ribeiro" }).where(eq(candidate.id, owner));
  const accounts: { email: string; name: string; roles: Role[]; state: "owner" | "idle" | "failed" | "empty" | "recruiter" }[] = [
    { email: "alex@local.test", name: "Alex Ribeiro", roles: ["admin", "candidate"], state: "owner" },
    { email: "bruno@local.test", name: "Bruno Lima", roles: ["candidate"], state: "idle" },
    { email: "carla@local.test", name: "Carla Mendes", roles: ["candidate"], state: "failed" },
    { email: "daniel@local.test", name: "Daniel Costa", roles: ["candidate"], state: "empty" },
    { email: "renata@local.test", name: "Renata Souza", roles: ["recruiter"], state: "recruiter" },
  ];
  for (const account of accounts) {
    const candidateId = account.state === "recruiter" ? null : account.state === "owner" ? owner :
      await ensureCandidate({ slug: account.email.split("@")[0]!, name: account.name });
    await getDb().insert(authUser).values({ email: account.email, roles: account.roles, candidateId });
    await setPassword(account.email, "somente-local-42-jornada");
    if (candidateId !== null && account.state !== "empty") {
      await saveDocument({ candidateId, kind: "cv", label: "Currículo", format: "markdown",
        content: `# ${account.name}\n\nSenior Software Architect. Experiência com TypeScript, Python, serviços distribuídos, arquitetura cloud, observabilidade e liderança técnica. Busca trabalho remoto no Brasil.` });
      if (account.state === "idle") await getDb().delete(scoreTask).where(eq(scoreTask.candidateId, candidateId));
      if (account.state === "failed") await getDb().update(scoreTask)
        .set({ status: "failed", lastError: "upstream connection unavailable", scored: null })
        .where(eq(scoreTask.candidateId, candidateId));
    }
  }
  await seedCatalog();
  await ensureMatchingProfile(owner);
  await ensureImportSource("manual:career", "manual", "career", "Carreiras");
  const result = await upsertRawJob({
    externalId: "software-architect", companyName: "Aurora Sistemas", title: "Senior Software Architect",
    locationRaw: "Remoto · Brasil", url: "https://example.com/careers/software-architect",
    descriptionText: "Arquitetura de serviços distribuídos em TypeScript e Python. Trabalho remoto no Brasil, colaboração com produto, documentação de decisões técnicas e observabilidade. Experiência em cloud, segurança, qualidade e liderança de engenharia.",
    raw: {},
  }, "manual:career");
  await scoreOne(owner, result.jobId);

  /**
   * A mesma vaga publicada em vários países, e uma com empregador não nomeado.
   *
   * Sem isto, quatro cenários da jornada `J-trust-the-filtered-board` não têm o
   * que percorrer no ambiente manual: `JOBS-group-repeated-countries`,
   * `JOBS-country-hub`, `JOBS-group-canonical-survives-filter` e
   * `JOBS-anonymous-employer-never-groups`. Eles ficaram sem veredito duas vezes,
   * e a segunda foi por isto — o `setup.mjs` do E2E automatizado tem as fixtures,
   * o manual não tinha.
   *
   * A forma reproduz o acervo real: quatro linhas do mesmo anúncio, duas delas no
   * mesmo país, porque é assim que o Jobgether publica — a mesma vaga chega a
   * aparecer em 42 linhas.
   *
   * O empregador não nomeado é o caso separado, e é o que o charter pede: quando o
   * nome da empresa É o rótulo da fonte, o quadro não pode agrupar, senão junta
   * vagas de empresas diferentes numa linha só.
   */
  await ensureImportSource("manual:grupo", "manual", "grupo", "Grupo QA");
  const grupo = [
    { externalId: "country-fixture-nl", locationRaw: "Netherlands" },
    { externalId: "country-fixture-fr", locationRaw: "France" },
    { externalId: "country-fixture-br-sp", locationRaw: "São Paulo, State of São Paulo, Brazil" },
    { externalId: "country-fixture-br-rj", locationRaw: "Rio de Janeiro, Rio de Janeiro, Brazil" },
  ];
  for (const linha of grupo) {
    const publicacao = await upsertRawJob({
      externalId: linha.externalId,
      companyName: "Country Fixture Lab",
      title: "Engineering Manager Country Fixture",
      locationRaw: linha.locationRaw,
      url: `https://example.com/careers/${linha.externalId}`,
      descriptionText:
        "Mesma vaga, uma linha por país, para a jornada de agrupamento. Arquitetura " +
        "de serviços distribuídos em TypeScript, trabalho remoto, liderança técnica.",
      raw: {},
    }, "manual:grupo");
    await scoreOne(owner, publicacao.jobId);
  }

  // Empregador não nomeado: o nome da empresa é o rótulo da fonte.
  const anonima = await upsertRawJob({
    externalId: "anonimo-sem-agrupar",
    companyName: "Grupo QA",
    title: "Staff Engineer Anonymous Fixture",
    locationRaw: "Remote · Europe",
    url: "https://example.com/careers/anonimo-sem-agrupar",
    descriptionText:
      "Vaga cujo empregador é o nome da fonte: o quadro a marca como não nomeada, " +
      "e ela não pode entrar em grupo com nenhuma outra.",
    raw: {},
  }, "manual:grupo");
  await scoreOne(owner, anonima.jobId);

  console.log("Manual QA accounts, career data and grouping fixtures prepared in isolated PostgreSQL.");
} finally { await closeDb(); }
