// Área `jobs-new` do E2E de navegador: Cadastro de vaga com rótulo de origem.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { basePrivateMarkers } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, check, page, rememberCreatedJob } = ctx;
  /* ------------------ Cadastro de vaga com rótulo de origem ---------------- */

  // O acervo é global e `job:write` é dos três papéis; o que distingue esta
  // vaga não é quem a criou, é a fonte que ela cria — `recruiter:<host>`, de
  // onde o rótulo deriva na leitura.
  const newJob = await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle" });
  check("formulário de cadastro responde", newJob?.status() === 200, `${newJob?.status()}`);

  const marker = `Recrutador E2E ${Date.now()}`;
  const privateMarkers = [...basePrivateMarkers(ctx), marker];
  // As áreas `canonical-flows` e `pwa` conferem que nada disto vaza para cache.
  ctx.state.privateMarkers = privateMarkers;
  await page.fill('input[name="title"]', "Staff AI Engineer");
  await page.fill('input[name="companyName"]', marker);
  await page.fill('input[name="location"]', "Remote · Brazil");
  await page.fill(
    'textarea[name="description"]',
    "Staff AI Engineer com LangGraph, Python, observability e liderança técnica. " +
      "Remoto no Brasil, contrato B2B. Equity e plano de saúde.",
  );
  // `data-testid` e não `button[type=submit]`: o primeiro submit da página é o
  // "sair" do cabeçalho, e o teste passou a fazer logout achando que cadastrava.
  await page.locator('[data-testid="post-job"]').click();
  await page.waitForURL(/\/jobs\/\d+/, { timeout: 20_000 }).catch(() => {});
  rememberCreatedJob(page.url(), "Staff AI Engineer", marker);
  check("cadastrar leva à vaga criada", /\/jobs\/\d+/.test(page.url()), page.url());

  await page.goto(`${BASE}/jobs?q=${encodeURIComponent(marker)}`, { waitUntil: "networkidle" });
  const posted = await page.evaluate((needle) => {
    const article = [...document.querySelectorAll("article")].find((a) =>
      (a.textContent ?? "").includes(needle),
    );
    return { listed: Boolean(article), labelled: /recrutador/i.test(article?.textContent ?? "") };
  }, marker);

  // Pontuada na hora: sem score a vaga não entra em lista nenhuma e quem
  // cadastrou conclui que falhou.
  check("a vaga cadastrada aparece na lista", posted.listed);
  check("e vem rotulada como recrutador", posted.labelled);
}
