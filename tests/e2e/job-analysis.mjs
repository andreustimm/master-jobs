// E2E-006 — análise estruturada da vaga (#223, tarefa 06).
//
// Candidato pede → pendente sobrevive a refresh → o processador roda com
// provedor falso → campos, desconhecidos e evidências na tela → admin vê
// versão e custo, o candidato não → texto da vaga muda e aparece o aviso.
//
// O processador é o mesmo `processNextAnalysis` que `jho analysis run` chama;
// só a porta do LLM é falsa, na borda. Rodar o binário da CLI exigiria uma
// chave de provedor de verdade, e nenhum teste aponta para provedor real.
import { eq } from "drizzle-orm";
import { getDb } from "../../src/core/db/client.ts";
import { job, source } from "../../src/core/db/schema.ts";
import { processNextAnalysis } from "../../src/core/llm/job-analysis.ts";

const TITLE = "Arquiteta de Soluções E2E Análise";
const DESCRIPTION = "Contrato PJ com empresa de São Paulo. Trabalho 100% remoto.";

/** Responde com trechos copiados do próprio texto enviado: evidência que confere. */
const fakePort = {
  name: "fake",
  model: "fake-e2e",
  async complete() {
    return {
      text: JSON.stringify({
        fields: {
          seniority: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
          employmentType: { value: "PJ", provenance: "explicit", confidence: 0.9, evidence: ["Contrato PJ"] },
          workModel: { value: "remote", provenance: "normalized", confidence: 0.8, evidence: ["100% remoto"] },
          locationRestriction: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
          timezone: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
          compensation: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
          requiredSkills: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
        },
      }),
      inputTokens: 1200,
      outputTokens: 300,
      model: "fake-e2e",
    };
  },
};

async function login(browser, base, email, password) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

const fitsPhone = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

export async function checkJobAnalysis(browser, base, accounts, check) {
  const db = getDb();
  const [anySource] = await db.select({ id: source.id }).from(source).limit(1);
  const [created] = await db
    .insert(job)
    .values({
      sourceId: anySource.id,
      externalId: "e2e-analise",
      companyName: "Acme Análise",
      title: TITLE,
      url: "https://example.test/e2e-analise",
      fingerprint: "e2e-analise-fp",
      contentHash: "e2e-analise-h",
      descriptionText: DESCRIPTION,
      raw: {},
    })
    .returning({ id: job.id });
  const jobId = created.id;
  const path = `${base}/jobs/${jobId}`;

  const candidate = await login(browser, base, accounts.candidate.email, accounts.candidate.password);
  try {
    const { page } = candidate;
    await page.goto(path, { waitUntil: "networkidle" });
    check("E2E-006 vaga sem análise explica e oferece o pedido",
      (await page.getByTestId("job-analysis-none").count()) === 1 && (await page.getByTestId("job-analysis-request").count()) === 1);

    await page.getByTestId("job-analysis-request").click();
    await page.getByTestId("job-analysis-pending").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-006 pendente sobrevive a refresh", (await page.getByTestId("job-analysis-pending").count()) === 1);

    const processed = await processNextAnalysis(
      { port: fakePort, providerSlug: "fake", modelId: "fake-e2e", inputCostPerMTok: 3, outputCostPerMTok: 15, maxOutputTokens: 1000 },
      { now: () => new Date().toISOString() },
    );
    check("E2E-006 processador conclui a análise", processed?.status === "succeeded", JSON.stringify(processed));

    await page.reload({ waitUntil: "networkidle" });
    const employment = page.getByTestId("job-analysis-field-employmentType");
    check("E2E-006 campo sustentado mostra valor e trecho",
      (await employment.getAttribute("data-provenance")) === "explicit" && (await employment.innerText()).includes("Contrato PJ"));
    check("E2E-006 campo sem evidência aparece como desconhecido",
      (await page.getByTestId("job-analysis-field-compensation").getAttribute("data-provenance")) === "unknown");
    check("E2E-006 versão visível para o candidato", (await page.getByTestId("job-analysis-version").innerText()).includes("v1"));
    check("E2E-006 candidato não vê custo, modelo nem tentativas", (await page.getByTestId("job-analysis-admin").count()) === 0
      && !(await page.getByTestId("job-analysis").innerText()).includes("fake-e2e"));
    check("E2E-006 seção cabe em 375 px", await fitsPhone(page));
  } finally {
    await candidate.context.close();
  }

  const admin = await login(browser, base, accounts.admin.email, accounts.admin.password);
  try {
    const { page } = admin;
    await page.goto(path, { waitUntil: "networkidle" });
    const panel = page.getByTestId("job-analysis-admin");
    check("E2E-006 admin vê modelo, versão e custo",
      (await panel.count()) === 1 && (await panel.innerText()).includes("fake-e2e")
        && (await page.locator('[data-testid^="job-analysis-cost-"]').count()) === 1);

    await db.update(job).set({ descriptionText: `${DESCRIPTION} Agora híbrido.` }).where(eq(job.id, jobId));
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-006 texto alterado mostra o aviso de análise desatualizada",
      (await page.getByTestId("job-analysis-outdated").count()) === 1);
  } finally {
    await admin.context.close();
    // A vaga é desta verificação; as seguintes contam vagas do acervo. A
    // análise sai junto, em cascata.
    await db.delete(job).where(eq(job.id, jobId));
  }
}
