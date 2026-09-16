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
  console.log("Manual QA accounts and career data prepared in isolated PostgreSQL.");
} finally { await closeDb(); }
