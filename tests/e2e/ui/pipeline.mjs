// Área `pipeline` do E2E de navegador: Funil: recusa não leva o rascunho junto; voltar de estágio e desfazer (#316).
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { TASK04_FIXTURES } from "../task04-fixtures.mjs";

export async function run(ctx) {
  const { BASE, browser, check, page } = ctx;
  /* ------------- Funil: recusa não pode levar o rascunho junto ------------- */

  // BUG-20260910. O seletor oferecia os dez status; de `preparing` alguém
  // escolhia `interviewing`, o domínio recusava, e o formulário limpava a nota
  // digitada junto com a tentativa. Duas afirmações separadas: o que a tela
  // OFERECE só contém o alcançável, e quando o servidor recusa mesmo assim —
  // outra aba mudou o estágio no meio — o texto digitado continua na tela.
  const funnelUrl = `${BASE}/jobs/${TASK04_FIXTURES.funnelJobId}`;
  await page.goto(funnelUrl, { waitUntil: "networkidle" });
  await page.selectOption('[data-testid="track-status"]', "shortlisted");
  await page.locator('[data-testid="track-submit"]').click();
  await page.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });

  // Depois de uma gravação aceita, o React limpa o formulário e o `select`
  // controlado volta à primeira opção sem que o estado mude — a tela passava a
  // exibir um estágio que não é o gravado, com Salvar ao lado pronto para
  // mover a candidatura para onde ninguém pediu.
  const afterSave = await page.evaluate(
    () => document.querySelector('[data-testid="track-status"]')?.value ?? "",
  );
  check("depois de salvar, o seletor mostra o estágio gravado", afterSave === "shortlisted", afterSave);

  await page.goto(funnelUrl, { waitUntil: "networkidle" });
  const offered = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="track-status"] option')].map((o) => o.value),
  );
  // Ordem de funil, agrupada (#316): o atual, avançar, voltar, encerrar.
  check(
    "o seletor oferece só os estágios alcançáveis a partir do atual, em ordem de funil",
    offered.join(",") === "shortlisted,preparing,backlog,archived",
    offered.join(","),
  );
  check(
    "estágio inalcançável não é oferecido",
    !offered.includes("interviewing") && !offered.includes("offer"),
    offered.join(","),
  );

  // A outra aba devolve a candidatura para "A fazer". A primeira continua
  // aberta e desatualizada, e de "A fazer" não se pula para "Preparando" —
  // avançar é um passo de cada vez, então a recusa continua alcançável mesmo
  // com as arestas de volta.
  const funnelCtx = await browser.newContext();
  await funnelCtx.addCookies(await page.context().cookies());
  const funnelOther = await funnelCtx.newPage();
  await funnelOther.goto(funnelUrl, { waitUntil: "networkidle" });
  await funnelOther.selectOption('[data-testid="track-status"]', "backlog");
  await funnelOther.locator('[data-testid="track-submit"]').click();
  await funnelOther.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await funnelOther.close();
  await funnelCtx.close();

  const draft = "Entrevista técnica marcada para sexta-feira às 14h.";
  await page.fill('[data-testid="track-note"]', draft);
  await page.selectOption('[data-testid="track-status"]', "preparing");
  await page.locator('[data-testid="track-submit"]').click();
  await page.locator('[data-testid="mutation-feedback"][role="alert"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const rejection = (await page.locator('[data-testid="mutation-feedback"]').textContent()) ?? "";
  const keptDraft = await page.inputValue('[data-testid="track-note"]');
  check(
    "transição recusada preserva a nota digitada",
    keptDraft === draft,
    `${keptDraft.slice(0, 40)}`,
  );
  check(
    "a recusa nomeia os dois estágios em vez de falhar em geral",
    rejection.includes("A fazer") && rejection.includes("Preparando"),
    rejection.slice(0, 120),
  );

  // BUG-20260917-stale-stages-after-refusal: a lista acompanha o estágio
  // gravado. A revalidação chega pela resposta da própria action; esperar o
  // efeito, e não um tempo fixo, separa "atualizou" de "ainda não atualizou".
  await page.waitForFunction(
    () => document.querySelector('[data-testid="track-status"]')?.value === "backlog",
    undefined,
    { timeout: 15_000 },
  );
  const afterRejection = await page.evaluate(() => ({
    offered: [...document.querySelectorAll('[data-testid="track-status"] option')].map((o) => o.value),
    selected: document.querySelector('[data-testid="track-status"]')?.value ?? "",
    note: document.querySelector('[data-testid="track-note"]')?.value ?? "",
  }));
  check(
    "depois da recusa a lista acompanha o estágio realmente gravado",
    afterRejection.offered.join(",") === "backlog,shortlisted,archived",
    afterRejection.offered.join(","),
  );
  check(
    "depois da recusa o seletor aponta para o estágio gravado",
    afterRejection.selected === "backlog",
    afterRejection.selected,
  );
  check(
    "a revalidação da recusa não apaga a nota digitada",
    afterRejection.note === draft,
    afterRejection.note.slice(0, 40),
  );
  await page.fill('[data-testid="track-note"]', "");

  /* ------------- Funil: voltar de estágio e desfazer (#316) ------------- */

  // Avança dois passos; de "Preparando" os estágios anteriores aparecem no grupo
  // "Voltar", e a trilha marca onde a candidatura está.
  const savedStage = async (target, status) => {
    await target.waitForFunction(
      (expected) => document.querySelector('[data-testid="stage-trail"] [aria-current="step"]')
        ?.getAttribute("data-testid") === `stage-trail-${expected}`,
      status,
      { timeout: 15_000 },
    );
  };
  for (const status of ["shortlisted", "preparing"]) {
    await page.selectOption('[data-testid="track-status"]', status);
    await page.locator('[data-testid="track-submit"]').click();
    await savedStage(page, status);
  }
  const grouped = await page.evaluate(() => ({
    back: [...document.querySelectorAll('[data-testid="track-group-back"] option')].map((o) => o.value),
    close: [...document.querySelectorAll('[data-testid="track-group-close"] option')].map((o) => o.value),
  }));
  check(
    "de Preparando, Voltar lista os estágios anteriores e Encerrar oferece Arquivar",
    grouped.back.join(",") === "backlog,shortlisted" && grouped.close.join(",") === "archived",
    JSON.stringify(grouped),
  );

  // Desfazer pelo aviso: volta ao estágio anterior e o histórico marca o
  // evento desfeito, sem apagar linha nenhuma.
  const eventsBefore = await page.locator('[data-testid="application-timeline-event"]').count();
  await page.selectOption('[data-testid="track-status"]', "applied");
  await page.locator('[data-testid="track-submit"]').click();
  await page.locator('[data-testid="track-undo"]').waitFor({ state: "visible", timeout: 15_000 });
  await savedStage(page, "applied");
  await page.locator('[data-testid="track-undo"]').click();
  await savedStage(page, "preparing");
  await page.reload({ waitUntil: "networkidle" });
  const undone = {
    stage: await page.inputValue('[data-testid="track-status"]'),
    events: await page.locator('[data-testid="application-timeline-event"]').count(),
    marked: await page.locator('[data-testid="application-timeline-event"][data-undone="true"]').count(),
  };
  check(
    "desfazer pelo aviso volta ao estágio anterior, acrescenta um evento e marca o desfeito",
    undone.stage === "preparing" && undone.events === eventsBefore + 2 && undone.marked === 1,
    JSON.stringify({ ...undone, eventsBefore }),
  );

  // Desfazer pela linha mais recente do histórico, sem prazo: agora o alvo é a
  // entrada em "Preparando".
  await page.locator('[data-testid="application-undo"]').click();
  await savedStage(page, "shortlisted");
  await page.reload({ waitUntil: "networkidle" });
  check(
    "desfazer pelo histórico recua mais um passo e sobrevive à recarga",
    (await page.inputValue('[data-testid="track-status"]')) === "shortlisted"
      && (await page.locator('[data-testid="application-timeline-event"][data-undone="true"]').count()) === 2,
    await page.inputValue('[data-testid="track-status"]'),
  );
}
