// Área `pipeline` do E2E de navegador: Funil: recusa não leva o rascunho junto.
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
  check(
    "o seletor oferece só os estágios alcançáveis a partir do atual",
    offered.length === 3 && ["archived", "preparing", "shortlisted"].every((s) => offered.includes(s)),
    offered.join(","),
  );
  check(
    "estágio inalcançável não é oferecido",
    !offered.includes("interviewing") && !offered.includes("offer"),
    offered.join(","),
  );

  // A outra aba leva a candidatura a um estado terminal. A primeira continua
  // aberta e desatualizada — é exatamente assim que a recusa ainda acontece
  // depois de a lista passar a ser derivada.
  const funnelCtx = await browser.newContext();
  await funnelCtx.addCookies(await page.context().cookies());
  const funnelOther = await funnelCtx.newPage();
  await funnelOther.goto(funnelUrl, { waitUntil: "networkidle" });
  await funnelOther.selectOption('[data-testid="track-status"]', "archived");
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
    rejection.includes("Arquivada") && rejection.includes("Preparando"),
    rejection.slice(0, 120),
  );

  // BUG-20260917-stale-stages-after-refusal. O aviso manda escolher um estágio
  // alcançável; antes da correção a lista continuava a de quando a página
  // abriu, e as duas opções restantes eram recusadas de novo — instrução que a
  // própria tela impedia de cumprir.
  // A revalidação chega pela resposta da própria action; esperar o efeito, e não
  // um tempo fixo, é o que separa "atualizou" de "ainda não atualizou".
  // Arquivada sem ter aplicado, a vaga ainda pode ser restaurada: `archived`
  // e `backlog` são os dois estágios alcançáveis.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="track-status"] option').length === 2,
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
    afterRejection.offered.length === 2
      && ["archived", "backlog"].every((status) => afterRejection.offered.includes(status)),
    afterRejection.offered.join(","),
  );
  check(
    "depois da recusa o seletor aponta para o estágio gravado",
    afterRejection.selected === "archived",
    afterRejection.selected,
  );
  check(
    "a revalidação da recusa não apaga a nota digitada",
    afterRejection.note === draft,
    afterRejection.note.slice(0, 40),
  );
}
