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
import { authEvent, job } from "../../src/core/db/schema.ts";
import { seedOwner } from "../../src/contexts/auth/app/seed.ts";
import {
  currentDocument,
  saveDocument,
  syncCandidateFromProfile,
} from "../../src/core/candidate.ts";
import {
  ensureImportSource,
  upsertRawJob,
} from "../../src/core/ingest/manual.ts";
import { runMigrations } from "../../src/core/db/migrate.ts";
import { scoreOne } from "../../src/core/scoring/apply.ts";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";

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

  const [{ count }] = await getDb()
    .select({ count: sql`count(*)` })
    .from(job);
  if (Number(count) === 0) {
    await ensureImportSource("ashby:e2e", "ashby", "e2e", "E2E Public Jobs");
    const seeded = await upsertRawJob(
      {
        externalId: "public-role",
        companyName: "E2E Public Jobs",
        title: "Senior AI Software Architect",
        locationRaw: "Remote · Brazil",
        descriptionText:
          "Senior AI Software Architect for TypeScript, Python, distributed systems, LLM products, cloud architecture, observability, and technical leadership. Remote in Brazil and LATAM.",
        url: "https://jobs.example.com/e2e-public-role",
        applyUrl: "https://jobs.example.com/e2e-public-role/apply",
        raw: { e2e: true },
      },
      "ashby:e2e",
    );
    await scoreOne(candidateId, seeded.jobId);
  }

  const cleared = await getDb()
    .delete(authEvent)
    .where(and(eq(authEvent.kind, "login_failed"), eq(authEvent.email, EMAIL)))
    .returning({ id: authEvent.id });

  console.log(`e2e: conta ${EMAIL} pronta · ${cleared.length} tentativa(s) limpa(s)`);
} finally {
  closeDb();
}
