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
import { authEvent, authUser, job } from "../../src/core/db/schema.ts";
import { seedOwner } from "../../src/contexts/auth/app/seed.ts";
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
import { runMigrations } from "../../src/core/db/migrate.ts";
import { scoreOne } from "../../src/core/scoring/apply.ts";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";

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
