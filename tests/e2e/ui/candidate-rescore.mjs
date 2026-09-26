// Área `candidate-rescore` do E2E de navegador: Estado da repontuação do candidato e a comparação de vaga.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { COMPARISON_TEXT } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, page, rememberCreatedJob, trackConsole } = ctx;
  /* ---------------- Estado da repontuação do candidato (task 03) --------- */

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  // O shell fica `inert` até a transição confirmar, e digitação perdida ali não
  // muda o currículo — sem mudança não há repontuação para enfileirar, e o
  // cartão aparece `idle`. Foi o que reprovou este caso em três de cinco
  // execuções antes desta espera existir.
  await page.waitForFunction(() => {
      // Pronto = sem `inert` (troca de tela) e sem `aria-busy` (mesma tela,
      // #220, que deixa o shell operável enquanto a resposta chega).
      const shell = document.getElementById("application-shell");
      return !shell?.hasAttribute("inert") && !shell?.hasAttribute("aria-busy");
    });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  // `textContent` nos DOIS lados da comparação. A versão anterior lia o estado
  // inicial com `innerText` e comparava com `textContent`: o CodeMirror põe cada
  // linha numa div, então `innerText` traz `\n` entre elas e `textContent` não —
  // as duas leituras do MESMO documento já diferiam, e a espera era satisfeita
  // antes de qualquer tecla entrar. O caso media a fila de um currículo que
  // ninguém havia editado.
  const FRASE_DIGITADA = "E2E queue visibility change.";
  const antes = await page
    .locator(".cm-content")
    .evaluate((element) => element.textContent ?? "");
  await page.keyboard.type(`\n\n${FRASE_DIGITADA}`, { delay: 0 });
  // A digitação entrou mesmo: o texto mudou E contém o que foi digitado. A
  // segunda metade é o que torna a espera incapaz de passar por acidente.
  await page.waitForFunction(
    ({ texto, frase }) => {
      const atual = document.querySelector(".cm-content")?.textContent ?? "";
      return atual !== texto && atual.includes(frase);
    },
    { texto: antes, frase: FRASE_DIGITADA },
  );
  await page.fill('input[name="label"]', "E2E queue visibility");
  await page.locator('[data-testid="save-cv"]').click();
  await page.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const queuedStatus = page.locator('[data-testid="score-queue-status"]');
  await queuedStatus.waitFor();
  // Espera o ESTADO, não o aviso.
  //
  // `mutation-feedback` aparece quando a Server Action responde, e isso é ANTES
  // de a árvore revalidada chegar: o cartão lido logo depois ainda é o do render
  // anterior, que dizia `idle` porque antes de salvar não havia nada na fila. Com
  // a espera de digitação consertada, o caso passou a reprovar aqui — e reprovava
  // por ler cedo, não porque a repontuação deixou de ser enfileirada.
  //
  // Qualquer estado diferente de `idle` prova o enfileiramento: `pending` é o
  // comum, e `scoring`/`done` aparecem se o worker for mais rápido que a leitura.
  // Esperar especificamente por `pending` reintroduziria a corrida ao contrário.
  let estadoDaFila = await queuedStatus.getAttribute("data-state");
  try {
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="score-queue-status"]')
          ?.getAttribute("data-state") ?? "idle") !== "idle",
      undefined,
      { timeout: 15_000 },
    );
    estadoDaFila = await queuedStatus.getAttribute("data-state");
  } catch {
    // Deixa `estadoDaFila` como está: o check abaixo reprova mostrando o que
    // ficou na tela, em vez de a exceção abortar a suíte inteira.
  }
  check(
    "E2E-001 salvar CV mostra atualização enfileirada no próximo render",
    estadoDaFila !== null && estadoDaFila !== "idle" &&
      ((await queuedStatus.textContent()) ?? "").trim() !== "",
    `${estadoDaFila}: ${await queuedStatus.textContent()}`,
  );

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  await page.reload({ waitUntil: "networkidle" });
  const englishQueueText = (await queuedStatus.textContent()) ?? "";
  // Desde a #280 a fatia de repontuação roda logo depois de salvar, então o
  // estado já pode ter passado de `pending`: o rótulo esperado é o do estado
  // que está na tela, lido do atributo — nunca o rótulo português.
  const englishQueueLabel = {
    pending: "Queued",
    scoring: "Scoring",
    done: "Up to date",
    failed: "Refresh failed",
    refused: "Track not built",
  }[(await queuedStatus.getAttribute("data-state")) ?? ""];
  check(
    "E2E-001 estado da fila usa o locale selecionado",
    englishQueueText.includes("Ranking refresh") && englishQueueLabel !== undefined &&
      englishQueueText.includes(englishQueueLabel) && !englishQueueText.includes("candidate.queue"),
    englishQueueText,
  );

  async function queueStateView(email) {
    const context = await browser.newContext();
    const targetPage = await context.newPage();
    trackConsole(targetPage);
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await targetPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await targetPage.fill('input[name="email"]', email);
    await targetPage.fill('input[name="password"]', E2E_PASSWORD);
    await targetPage.locator('[data-testid="login-submit"]').click();
    await targetPage.waitForTimeout(1_500);

    const samples = [];
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ]) {
      await targetPage.setViewportSize(viewport);
      await targetPage.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
      const status = targetPage.locator('[data-testid="score-queue-status"]');
      samples.push({
        viewport: `${viewport.width}x${viewport.height}`,
        state: await status.getAttribute("data-state"),
        text: (await status.textContent()) ?? "",
        overflow: await targetPage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      });
    }
    await context.close();
    return samples;
  }

  const idleQueue = await queueStateView("e2e-candidato@local.test");
  const failedQueue = await queueStateView("e2e-alvo@local.test");
  const noCvQueue = await queueStateView("e2e-sem-cv@local.test");
  check(
    "E2E-002 idle e failed ficam isolados por candidato em todos os viewports",
    idleQueue.every((sample) => sample.state === "idle") &&
      failedQueue.every((sample) => sample.state === "failed"),
    JSON.stringify({ idleQueue, failedQueue }),
  );
  check(
    "E2E-002 375 portrait, 812 landscape, tablet e desktop não transbordam",
    [...idleQueue, ...failedQueue, ...noCvQueue].every((sample) => sample.overflow <= 1),
    JSON.stringify([...idleQueue, ...failedQueue, ...noCvQueue].filter((sample) => sample.overflow > 1)),
  );
  check(
    "E2E-002 falha é localizada e nunca expõe erro bruto ou chave literal",
    failedQueue.every((sample) =>
      sample.text.includes("Falha na atualização") &&
      !sample.text.includes("RAW_E2E_QUEUE_ERROR_MUST_NOT_RENDER") &&
      !sample.text.includes("candidate.queue")
    ),
    JSON.stringify(failedQueue),
  );
  check(
    "E2E-003 candidato sem CV recebe estado neutro localizado",
    noCvQueue.every((sample) => sample.state === "noCv") &&
      noCvQueue.every((sample) =>
        sample.text.includes("Aguardando currículo") &&
        !sample.text.includes("candidate.queue") &&
        !sample.text.includes("Ranking refresh")
      ),
    JSON.stringify(noCvQueue),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  check("comparar vaga oferece descrição", (await page.locator('textarea[name="description"]').count()) === 1);
  check("comparar vaga oferece upload", (await page.locator('input[name="file"][type="file"]').count()) === 1);
  check("comparar vaga envia pela ação", (await page.locator('[data-testid="compare-submit"]').count()) === 1);

  const comparisonText = COMPARISON_TEXT;
  const fillComparisonIdentity = async () => {
    await page.fill('input[name="title"]', "Senior AI Software Architect E2E");
    await page.fill('input[name="companyName"]', "E2E Comparison Lab");
    await page.fill('input[name="location"]', "Remote · Brazil");
    await page.fill('input[name="url"]', "https://e2e.invalid/comparison");
  };

  await fillComparisonIdentity();
  await page.fill('textarea[name="description"]', comparisonText);
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  // A área `canonical-flows` reabre esta comparação e o detalhe da vaga criada.
  ctx.state.comparisonJobId = rememberCreatedJob(
    page.url(),
    "Senior AI Software Architect E2E",
    "E2E Comparison Lab",
  );
  check("comparação colada persiste e redireciona", /[?&]job=\d+/.test(page.url()), page.url());
  check("comparação exibe score canônico", (await page.locator('[data-testid="comparison-score"]').count()) === 1);
  check("comparação exibe cobertura do currículo", (await page.locator('[data-testid="comparison-cv-coverage"]').count()) === 1);

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await fillComparisonIdentity();
  await page.locator('input[name="file"]').setInputFiles({
    name: "e2e-job.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`${comparisonText}\nUploaded through the real multipart form.`),
  });
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  rememberCreatedJob(page.url(), "Senior AI Software Architect E2E", "E2E Comparison Lab");
  check(
    "upload percorre extração, persistência e score",
    (await page.locator('[data-testid="comparison-result"]').textContent())?.includes("e2e-job.txt") ?? false,
  );

  await page.setViewportSize({ width: 375, height: 812 });
  const resultOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("resultado da comparação cabe no celular", resultOverflow <= 1, `${resultOverflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });
}
