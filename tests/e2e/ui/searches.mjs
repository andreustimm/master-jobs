// Área `searches` do E2E de navegador: Buscas: trilha, termo e salário na tela Vagas, saúde das capturas, papéis e arquivamento.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { ENGLISH_SEARCHES_SWEEP, OVERFLOW_SEARCHES_SWEEP } from "../routes.mjs";
import { makePortugueseLeaks, ptBR } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, gotoMeasured, page } = ctx;
  const portugueseLeaks = makePortugueseLeaks(ctx);
  /* ------- term-search task_04: trilha, termo e salário na tela Vagas ------- */
  const payBase = `${BASE}/jobs?q=${encodeURIComponent("Pay fixture")}&fit=0`;
  const payIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="job-link-904"]')].map((link) =>
      link.getAttribute("data-testid").slice("job-link-".length)));
  const payFits = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-testid^="job-link-904"]')].map((link) => [
      link.getAttribute("data-testid").slice("job-link-".length),
      link.closest("article")?.querySelector("div span")?.textContent?.trim() ?? "",
    ]),
  ));
  const settle = async (pattern) => {
    await page.waitForURL(pattern, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    // A soft navigation keeps the shell inert until the transition commits;
    // typing before that is lost, for a person and for `fill` alike.
    await page.waitForFunction(() => {
      // Pronto = sem `inert` (troca de tela) e sem `aria-busy` (mesma tela,
      // #220, que deixa o shell operável enquanto a resposta chega).
      const shell = document.getElementById("application-shell");
      return !shell?.hasAttribute("inert") && !shell?.hasAttribute("aria-busy");
    });
  };

  await page.goto(payBase, { waitUntil: "networkidle" });
  const primaryFits = await payFits();
  await page.locator('[data-testid^="filter-track-"]').filter({ hasText: "PHP E2E" }).click();
  await settle(/track=\d+/);
  const trackUrl = page.url();
  const phpFits = await payFits();
  await page.locator('[data-testid="filter-track-all"]').click();
  await settle(/track=all/);
  const trackLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="job-link-904"]')].map((link) =>
      link.closest("article")?.querySelectorAll('[data-testid^="job-track-"]').length ?? 0));
  await page.reload({ waitUntil: "networkidle" });
  const allKept = await page.locator('[data-testid="filter-track-all"]').getAttribute("aria-current");
  check(
    "term-search E2E-003 trilha principal por padrão, trilha escolhida na URL, todas com rótulo, recarga mantém",
    primaryFits["904000001"] === "60"
      && phpFits["904000001"] === "85"
      && /track=\d+/.test(trackUrl)
      && trackLabels.length === 6
      && trackLabels.every((count) => count === 1)
      && allKept === "true",
    JSON.stringify({ primaryFits, phpFits, trackUrl, trackLabels, allKept }),
  );

  await page.goto(payBase, { waitUntil: "networkidle" });
  await page.locator('[data-testid="filters-pay-min"]').fill("6000");
  await page.locator('[data-testid="filters-pay-currency"]').selectOption("USD");
  await page.locator('[data-testid="filters-pay-period"]').selectOption("month");
  await page.locator('[data-testid="filters-pay-submit"]').click();
  await settle(/pay=6000/);
  const payMarkers = () => page.evaluate(() => ({
    converted: document.querySelectorAll('[data-testid^="job-pay-904"]').length,
    undisclosed: document.querySelectorAll('[data-testid^="job-pay-undisclosed-"]').length,
    notComparable: document.querySelectorAll('[data-testid^="job-pay-not-comparable-"]').length,
    hidden: document.querySelector('[data-testid="jobs-hidden-by-pay-range"]')?.textContent ?? "",
  }));
  const withMinimum = { order: await payIds(), ...(await payMarkers()) };
  await page.locator('[data-testid="filters-pay-form"] a[href*="disclosed=1"]').click();
  await settle(/disclosed=1/);
  const disclosedOnly = { order: await payIds(), ...(await payMarkers()) };
  await page.reload({ waitUntil: "networkidle" });
  const reloaded = { url: page.url(), order: await payIds() };
  const qualifying = new Set(["904000001", "904000002", "904000003"]);
  check(
    "term-search E2E-007 mínimo em USD por mês: qualificadas primeiro e convertidas, marcadas depois, abaixo do mínimo contado; só informado some com as marcadas; recarga mantém",
    withMinimum.order.length === 5
      && withMinimum.order.slice(0, 3).every((id) => qualifying.has(id))
      && withMinimum.converted === 3
      && withMinimum.undisclosed === 1
      && withMinimum.notComparable === 1
      && /\b1\b/.test(withMinimum.hidden)
      && disclosedOnly.order.length === 3
      && disclosedOnly.undisclosed + disclosedOnly.notComparable === 0
      && /pay=6000/.test(reloaded.url)
      && /disclosed=1/.test(reloaded.url)
      && reloaded.order.length === 3,
    JSON.stringify({ withMinimum, disclosedOnly, reloaded }),
  );

  // Faixa com os dois lados. Normalizado em USD por mês a fixture vale 10.000,
  // 12.000, 13.867 e 4.000: um teto de 11.000 deixa uma só de pé.
  await page.goto(payBase, { waitUntil: "networkidle" });
  const thumbs = await page.locator('[data-testid="filters-pay-slider"] input[type="range"]').count();
  await page.locator('[data-testid="filters-pay-min"]').fill("6000");
  await page.locator('[data-testid="filters-pay-max"]').fill("11000");
  // O período padrão vem da trilha principal e aqui é anual: sem escolher o
  // mês, a faixa é lida por ano e o caso mede outra coisa.
  await page.locator('[data-testid="filters-pay-currency"]').selectOption("USD");
  await page.locator('[data-testid="filters-pay-period"]').selectOption("month");
  await page.locator('[data-testid="filters-pay-submit"]').click();
  await settle(/payMax=11000/);
  const withCeiling = { order: await payIds(), ...(await payMarkers()) };
  await page.reload({ waitUntil: "networkidle" });
  const ceilingKept = {
    url: page.url(),
    min: await page.locator('[data-testid="filters-pay-min"]').inputValue(),
    max: await page.locator('[data-testid="filters-pay-max"]').inputValue(),
  };
  check(
    "term-search E2E-010 faixa de 6.000 a 11.000 em USD por mês: uma qualificada, três fora contadas, recarga devolve os dois campos",
    thumbs === 2
      && withCeiling.converted === 1
      && withCeiling.order.length === 3
      && /\b3\b/.test(withCeiling.hidden)
      && /pay=6000/.test(ceilingKept.url)
      && /payMax=11000/.test(ceilingKept.url)
      && ceilingKept.min === "6000"
      && ceilingKept.max === "11000",
    JSON.stringify({ thumbs, withCeiling, ceilingKept }),
  );

  // Vagas repetidas por país: quatro publicações da mesma vaga viram uma linha
  // com três bandeiras, porque as duas brasileiras somam numa marca só.
  const grupoBase = `${BASE}/jobs?q=${encodeURIComponent("Country Fixture")}&fit=0`;
  await page.goto(grupoBase, { waitUntil: "networkidle" });
  const linhasAgrupadas = await page.locator('[data-testid^="job-link-9040001"]').count();
  const bandeiras = page.locator('[data-testid^="job-country-904000101-"]');
  const marcas = await bandeiras.evaluateAll((nos) =>
    nos.map((no) => ({ texto: no.textContent.trim(), rotulo: no.getAttribute("title") })));
  const destinoPrimeiraBandeira = await bandeiras.first().getAttribute("href");
  // Desligar o agrupamento devolve as quatro linhas.
  await page.goto(`${grupoBase}&ungrouped=1`, { waitUntil: "networkidle" });
  const linhasCruas = await page.locator('[data-testid^="job-link-9040001"]').count();
  const semBandeiras = await page.locator('[data-testid^="job-countries-"]').count();
  check(
    "term-search E2E-012 vaga repetida por país vira uma linha com bandeiras; cidades do mesmo país somam numa marca; desligar devolve as quatro",
    linhasAgrupadas === 1
      && marcas.length === 3
      // O rótulo E a bandeira: o caso coletava as duas e afirmava só a primeira,
      // então marca vazia ou bandeira do país errado passava.
      && marcas.some((m) => m.rotulo === "Países Baixos" && m.texto === "\u{1F1F3}\u{1F1F1}")
      && marcas.some((m) => m.rotulo === "França" && m.texto === "\u{1F1EB}\u{1F1F7}")
      // As duas cidades brasileiras somam numa marca só, e o rótulo diz quantas
      // são — `startsWith("Brasil")` passava com "Brasil" puro, que é justamente
      // o caso em que a soma foi perdida.
      && marcas.some((m) => /^Brasil\b.*\b2\b/.test(m.rotulo ?? "") && m.texto === "\u{1F1E7}\u{1F1F7}")
      && (destinoPrimeiraBandeira ?? "").includes("/jobs/904000101")
      && linhasCruas === 4
      && semBandeiras === 0,
    JSON.stringify({ linhasAgrupadas, marcas, destinoPrimeiraBandeira, linhasCruas, semBandeiras }),
  );

  // O hub: a linha agrupada leva ao centralizador, não a um país sorteado.
  await page.goto(grupoBase, { waitUntil: "networkidle" });
  const destinoDoTitulo = await page.locator('[data-testid="job-link-904000101"]').getAttribute("href");
  const acoesNaLinha = await page.locator('[data-testid^="job-link-904000101"]')
    .locator("xpath=ancestor::article")
    .locator("a[target=_blank], button[popovertarget]")
    .count();
  await page.locator('[data-testid="job-link-904000101"]').click();
  await settle(/\/jobs\/904000101\/paises/);
  const noHub = await page.evaluate(() => ({
    rota: !!document.querySelector('[data-testid="route-job-countries"]'),
    chamada: document.querySelector('[data-testid="countries-lead"]')?.textContent?.trim() ?? "",
    publicacoes: [...document.querySelectorAll('[data-testid^="job-link-9040001"]')]
      .map((link) => link.getAttribute("data-testid")),
  }));
  check(
    "term-search E2E-014 a linha agrupada leva ao hub, sem botões de ação, e o hub lista as quatro publicações",
    (destinoDoTitulo ?? "").includes("/jobs/904000101/paises")
      && acoesNaLinha === 0
      && noHub.rota
      && /4/.test(noHub.chamada)
      && noHub.publicacoes.length === 4,
    JSON.stringify({ destinoDoTitulo, acoesNaLinha, noHub }),
  );

  // Fontes em multi-seleção: duas fontes na fixture, uma escolha por vez e as
  // duas juntas, com a URL carregando `source` repetido.
  const sourceBase = `${BASE}/jobs?q=fixture&fit=0`;
  const listedIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="job-link-90"]')].map((link) =>
      link.getAttribute("data-testid").slice("job-link-".length)));
  await page.goto(sourceBase, { waitUntil: "networkidle" });
  const everySource = await listedIds();
  await page.locator('[data-testid="filters-source-summary"]').click();
  await page.locator('[data-testid="filter-source-lever"]').check();
  await page.locator('[data-testid="filters-source-submit"]').click();
  await settle(/source=lever/);
  const onlyLever = await listedIds();
  await page.reload({ waitUntil: "networkidle" });
  const leverStillChecked = await page.locator('[data-testid="filter-source-lever"]').isChecked();
  // Ashby SOZINHO, desmarcando lever primeiro. A medição separada é o que permite
  // afirmar depois que as duas juntas devolvem a união — e a união é o que
  // distingue "o parâmetro repetido funciona" de "a contagem bateu".
  await page.locator('[data-testid="filters-source-summary"]').click();
  await page.locator('[data-testid="filter-source-lever"]').uncheck();
  await page.locator('[data-testid="filter-source-ashby"]').check();
  await page.locator('[data-testid="filters-source-submit"]').click();
  await settle(/\/jobs\?(?!.*source=lever)(?=.*source=ashby)/);
  await page.locator('[data-testid="filters-source-summary"]').click();
  await page.locator('[data-testid="filter-source-lever"]').check();
  await page.locator('[data-testid="filters-source-submit"]').click();
  await settle(/source=lever/);
  const bothUrl = page.url();
  const bothSources = await listedIds();
  await page.locator('[data-testid="filters-source-clear"]').click();
  // Sem a negativa, `waitForURL` casaria com a URL que ainda tem `source=` e a
  // leitura aconteceria antes da navegação — verde por corrida, não por efeito.
  await settle(/\/jobs\?(?!.*source=)/);
  const cleared = { url: page.url(), ids: await listedIds() };

  // A asserção é sobre o TOTAL do filtro, não sobre a página.
  //
  // `listedIds()` lê uma página de cinquenta, e `q=fixture` alcança mais de mil
  // vagas: comparar tamanhos de página dava igualdade trivial, e comparar
  // CONJUNTOS de página é pior ainda — `onlyAshby` traz ids que `everySource` não
  // tem, porque são páginas diferentes do mesmo acervo. Foi o que a execução
  // mostrou, e é a correção deste próprio caso.
  //
  // O número do cabeçalho é o que o filtro produz. Ele reprova se o OR virar AND
  // (total cai para zero), se a segunda fonte for ignorada (total igual ao de
  // lever só), ou se o filtro não filtrar (total igual ao do acervo).
  const totalDoFiltro = () => page.evaluate(() =>
    Number(document.querySelector('[data-testid="jobs-total"]')?.getAttribute("data-total") ?? -1));
  await page.goto(`${sourceBase}&source=lever`, { waitUntil: "networkidle" });
  const totalLever = await totalDoFiltro();
  await page.goto(`${sourceBase}&source=ashby`, { waitUntil: "networkidle" });
  const totalAshby = await totalDoFiltro();
  await page.goto(`${sourceBase}&source=lever&source=ashby`, { waitUntil: "networkidle" });
  const totalAmbas = await totalDoFiltro();
  await page.goto(sourceBase, { waitUntil: "networkidle" });
  const totalSemFiltro = await totalDoFiltro();

  check(
    "term-search E2E-011 fontes em multi-seleção: o TOTAL de duas fontes é a soma das duas, e cada uma filtra o acervo",
    onlyLever.length === 1
      && onlyLever[0] === "904000007"
      && leverStillChecked === true
      && /source=lever/.test(bothUrl)
      && /source=ashby/.test(bothUrl)
      && !/source=/.test(cleared.url)
      // Cada fonte tem vaga, e nenhuma delas é o acervo inteiro.
      && totalLever > 0 && totalAshby > 0
      && totalLever < totalSemFiltro && totalAshby < totalSemFiltro
      // Duas fontes somam as duas: é o OR, e é o que distingue de uma interseção
      // (que daria zero) ou de uma fonte ignorada (que daria uma das duas).
      && totalAmbas === totalLever + totalAshby
      && totalAmbas < totalSemFiltro,
    JSON.stringify({ onlyLever, leverStillChecked, bothUrl, cleared: cleared.url,
      totalLever, totalAshby, totalAmbas, totalSemFiltro }),
  );

  // A faixa de Score vinda da URL, no browser.
  //
  // `fit=abc` estava provado só na unidade, e a unidade não vê o que a tela faz
  // com o resultado: o valor recusado cai no PADRÃO (45), e o campo tem de mostrar
  // esse padrão. Um campo vazio ali diria "todos os scores", que é outra coisa —
  // e um `NaN` no atributo `value` faz o React reclamar e o campo ficar
  // descontrolado.
  const lerFaixa = async (url) => {
    await page.goto(url, { waitUntil: "networkidle" });
    return page.evaluate(() => ({
      min: document.querySelector('[data-testid="filters-score-min"]')?.value ?? null,
      max: document.querySelector('[data-testid="filters-score-max"]')?.value ?? null,
      vagas: document.querySelectorAll('[data-testid^="job-link-"]').length,
    }));
  };

  const fitPadrao = await lerFaixa(`${BASE}/jobs?q=fixture`);
  const fitInvalido = await lerFaixa(`${BASE}/jobs?q=fixture&fit=abc`);
  const fitNegativo = await lerFaixa(`${BASE}/jobs?q=fixture&fit=-30`);
  const fitAcimaDoTeto = await lerFaixa(`${BASE}/jobs?q=fixture&fit=999`);
  const fitVazio = await lerFaixa(`${BASE}/jobs?q=fixture&fit=`);

  check(
    "term-search E2E-015 faixa de Score da URL: valor ilegível cai no padrão, negativo e acima do teto são presos, vazio é «todos os scores»",
    // Ilegível é indistinguível de não ter passado nada.
    fitInvalido.min === fitPadrao.min
      && fitInvalido.min !== null
      && !Number.isNaN(Number(fitInvalido.min))
      // Negativo é preso em zero, e zero é "todos": o campo fica vazio.
      && fitNegativo.min === ""
      // Acima do teto é preso no teto, e o teto filtra mais que o padrão.
      && Number(fitAcimaDoTeto.min) > Number(fitPadrao.min)
      && fitAcimaDoTeto.vagas <= fitPadrao.vagas
      // Campo vazio é escolha declarada, não erro: mostra tudo.
      && fitVazio.min === ""
      && fitVazio.vagas >= fitPadrao.vagas,
    JSON.stringify({ fitPadrao, fitInvalido, fitNegativo, fitAcimaDoTeto, fitVazio }),
  );

  await page.goto(payBase, { waitUntil: "networkidle" });
  await page.locator('a[href*="sort=comp"]').first().click();
  await settle(/sort=comp/);
  const byPay = await payIds();
  check(
    "term-search E2E-008 ordenar por salário segue o valor normalizado entre USD/ano, BRL/mês e USD/hora",
    JSON.stringify(byPay.slice(0, 4)) === JSON.stringify(["904000003", "904000002", "904000001", "904000004"]),
    JSON.stringify(byPay),
  );

  let hostileDialog = false;
  const onDialog = async (dialog) => {
    hostileDialog = true;
    await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  await page.goto(`${BASE}/jobs?q=${encodeURIComponent("<script>alert(1)</script>")}`, { waitUntil: "networkidle" });
  const hostileTerm = await page.evaluate(() => ({
    notice: Boolean(document.querySelector('[data-testid="jobs-notice-term_invalid_char"]')),
    // O payload RSC carrega a URL como string JSON num <script> de dados; o
    // que provaria injeção é um script cujo CÓDIGO seja o do parâmetro.
    injected: [...document.querySelectorAll("script")].some((node) => (node.textContent ?? "").trim() === "alert(1)"),
    field: document.querySelector('[data-testid="filters-query"]')?.value ?? null,
  }));
  await page.goto(`${BASE}/jobs?pay=0`, { waitUntil: "networkidle" });
  const payNotice = await page.locator('[data-testid="jobs-notice-pay_invalid"]').count();
  await page.goto(`${payBase}&track=999`, { waitUntil: "networkidle" });
  const unknownTrack = {
    notice: await page.locator('[data-testid="jobs-notice-track_unknown"]').count(),
    fits: await payFits(),
  };
  page.off("dialog", onDialog);
  check(
    "term-search E2E-015 entrada hostil vira aviso: termo inválido, salário 0 e trilha inexistente caem na principal",
    hostileTerm.notice
      && !hostileTerm.injected
      && !hostileDialog
      && hostileTerm.field === ""
      && payNotice === 1
      && unknownTrack.notice === 1
      && unknownTrack.fits["904000001"] === "60",
    JSON.stringify({ hostileTerm, hostileDialog, payNotice, unknownTrack }),
  );

  await page.goto(`${BASE}/jobs?q=zzqxunmatched`, { waitUntil: "networkidle" });
  const emptyTerm = await page.evaluate(() => ({
    empty: document.querySelector('[data-testid="jobs-empty"]')?.textContent ?? "",
    offer: document.querySelector('[data-testid="jobs-offer-search-link"]')?.getAttribute("href") ?? "",
    emphasized: document.querySelector('[data-testid="jobs-offer-search"]')?.getAttribute("data-emphasized"),
  }));
  check(
    "term-search E2E-020 termo sem vaga: o vazio nomeia o termo e oferece buscar nas plataformas",
    emptyTerm.empty.includes("zzqxunmatched")
      && emptyTerm.offer === "/searches/tracks/new?term=zzqxunmatched"
      && emptyTerm.emphasized === "true",
    JSON.stringify(emptyTerm),
  );

  /* ------ term-search task_05: Buscas, trilhas, saúde das capturas e papéis ------ */
  const notice = page.locator('[data-testid="mutation-feedback"]');
  /**
   * Runs an action and reads the notice it leaves, then clears it for the next one.
   *
   * Quando o aviso NÃO aparece, isto registra um check reprovado e devolve uma
   * leitura vazia, em vez de deixar a exceção subir.
   *
   * A razão é a mesma que isolou o cenário do WebKit: este ajudante é chamado
   * dezenove vezes, e a exceção de uma delas ia para o `catch` da suíte e levava
   * consigo todos os casos seguintes — o relatório parava em 236 de 262 sem dizer
   * nada sobre o resto. A ação que não deixou aviso continua sendo falha, e
   * nomeada; o que ela deixa de ser é o fim da execução.
   */
  const feedbackOf = async (act) => {
    await act();
    try {
      await notice.waitFor({ timeout: 20_000 });
    } catch {
      check(
        "term-search: toda ação deixa um aviso legível",
        false,
        `nenhum [data-testid="mutation-feedback"] em 20s · url=${page.url().replace(BASE, "")}`,
      );
      return { role: null, text: "", link: null };
    }
    const link = page.locator('[data-testid="mutation-feedback-link"]');
    const read = {
      role: await notice.getAttribute("role"),
      text: ((await notice.textContent()) ?? "").trim(),
      link: (await link.count()) > 0 ? await link.getAttribute("href") : null,
    };
    await page.locator('[data-testid="mutation-feedback-dismiss"]').click();
    await notice.waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");
    return read;
  };
  // The notice arrives with the action's answer; the revalidated tree
  // commits a moment later. Reads after an action wait for the state they
  // expect instead of racing that commit, and report `false` on timeout.
  const eventually = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { timeout: 10_000 }).then(() => true, () => false);
  // By the term's own name: every row's "move to" select lists every track
  // name, so a text filter on the row matches the wrong term.
  const findTerm = (wanted) => {
    const row = [...document.querySelectorAll('div[data-state][data-testid^="term-"]')]
      .find((node) => node.querySelector("span[data-user-content]")?.textContent?.trim() === wanted);
    return row ? Number(row.getAttribute("data-testid").slice("term-".length)) : null;
  };
  const termIdOf = (text) =>
    page.waitForFunction(findTerm, text, { timeout: 10_000 }).then((handle) => handle.jsonValue(), () => null);
  const termStateIs = ([id, state]) =>
    document.querySelector(`[data-testid="term-${id}"]`)?.getAttribute("data-state") === state;
  const trackCards = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="track-"][data-primary]')].map((card) => ({
      id: Number(card.getAttribute("data-testid").slice("track-".length)),
      primary: card.getAttribute("data-primary") === "true",
      name: card.querySelector("[data-user-content]")?.textContent?.trim() ?? "",
    })));
  const saveTermOnPage = (term) => feedbackOf(async () => {
    // After a redirect the shell stays inert until the transition commits, and
    // `fill` on it is silently lost: the save goes out empty and no notice comes.
    //
    // O formulário do termo também precisa ter assentado. O aviso é publicado
    // DENTRO da action, antes de a transição dela terminar; o React só
    // reinicia o formulário não controlado quando a transição assenta. Sob
    // carga esse intervalo cresce, e o `fill` do termo seguinte caía nele: o
    // reset apagava o campo, o `required` barrava o envio e nenhum aviso vinha
    // — "techlead" nunca era salvo, e "Tech Lead" passava como termo novo em
    // vez de duplicado. `aria-busy` no formulário é o `pending` da action.
    await page.waitForFunction(() => {
      // Pronto = sem `inert` (troca de tela) e sem `aria-busy` (mesma tela,
      // #220, que deixa o shell operável enquanto a resposta chega).
      const shell = document.getElementById("application-shell");
      const form = document.querySelector('[data-testid="searches-term-input"]')?.closest("form");
      return !shell?.hasAttribute("inert") && !shell?.hasAttribute("aria-busy")
        && Boolean(form) && !form.hasAttribute("aria-busy");
    });
    await page.locator('[data-testid="searches-term-input"]').fill(term);
    await page.locator('[data-testid="searches-term-save"]').click();
  });

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="filters-query"]').fill("Laravel");
  await page.locator('[data-testid="filters-submit"]').click();
  await settle(/q=Laravel/);
  const laravelBoard = await page.evaluate(() => ({
    descriptionOnly: Boolean(document.querySelector('[data-testid="job-link-905000001"]')),
    hint: document.querySelector('[data-testid="filters-query-hint"]')?.textContent?.trim() ?? "",
    offer: document.querySelector('[data-testid="jobs-offer-search-link"]')?.getAttribute("href") ?? "",
  }));
  await page.locator('[data-testid="jobs-offer-search-link"]').click();
  await settle(/\/searches\/tracks\/new\?term=Laravel/);
  const suggested = await page.evaluate(() => ({
    titles: document.querySelector('[data-testid="track-titles"]')?.value ?? "",
    evidence: document.querySelector('[data-testid="track-suggestion-evidence"]')?.textContent?.trim() ?? "",
  }));
  const laravelCreated = await feedbackOf(async () => {
    await page.locator('[data-testid="track-create"]').click();
    await settle(/\/searches$/);
  });
  const laravelTrack = (await trackCards()).find((card) => card.name === "Laravel");
  const laravelTermId = await termIdOf("Laravel");
  const laravelTerm = {
    inTrack: await page.locator(`[data-testid="track-${laravelTrack?.id}"] [data-testid="term-${laravelTermId}"]`).count(),
    platforms: await page.locator(`[data-testid="term-platforms-${laravelTermId}"] li`).allTextContents(),
    coverage: ((await page.locator('[data-testid="searches-coverage"]').textContent()) ?? "").trim(),
  };
  check(
    "term-search E2E-001 Laravel só na descrição aparece, a oferta sugere a trilha e o termo salvo mostra capturas desligadas por plataforma",
    laravelBoard.descriptionOnly
      && laravelBoard.hint === ptBR.filters.searchHint
      && laravelBoard.offer === "/searches/tracks/new?term=Laravel"
      && suggested.titles.length > 0
      && suggested.evidence.length > 0
      && laravelCreated.role === "status"
      && laravelTerm.inTrack === 1
      && laravelTerm.platforms.length > 0
      && laravelTerm.platforms.every((line) => line.includes(ptBR.captureState.captures_off))
      && laravelTerm.coverage === ptBR.searches.coverage,
    JSON.stringify({ laravelBoard, suggested, laravelCreated, laravelTrack, laravelTerm }),
  );

  const tooShort = await saveTermOnPage("a");
  const techleadSaved = await saveTermOnPage("techlead");
  const techleadId = await termIdOf("techlead");
  const duplicate = await saveTermOnPage("Tech Lead");
  check(
    "term-search E2E-017 termo curto é recusado com o limite e a grafia equivalente aponta o termo existente",
    tooShort.role === "alert"
      && tooShort.text.includes(ptBR.searchFeedback.term_too_short)
      && techleadSaved.role === "status"
      && techleadSaved.text.includes(ptBR.searchFeedback.run_captures_off)
      && duplicate.role === "alert"
      && duplicate.text.includes(ptBR.searchFeedback.term_duplicate)
      && duplicate.link === `/searches#term-${techleadId}`
      && (await page.evaluate(findTerm, "Tech Lead")) === null,
    JSON.stringify({ tooShort, techleadSaved, duplicate, techleadId }),
  );

  const pausedResult = await feedbackOf(() => page.locator(`[data-testid="term-toggle-${techleadId}"]`).click());
  const paused = {
    state: await eventually(termStateIs, [techleadId, "paused"]),
    badge: await page.locator(`[data-testid="term-paused-${techleadId}"]`).count(),
  };
  await feedbackOf(() => page.locator(`[data-testid="term-toggle-${techleadId}"]`).click());
  const resumed = await eventually(termStateIs, [techleadId, "active"]);
  await page.locator(`[data-testid="term-move-track-${techleadId}"]`).selectOption(String(laravelTrack?.id));
  const moved = await feedbackOf(() => page.locator(`[data-testid="term-move-${techleadId}"]`).click());
  const movedInto = await eventually(
    ([track, term]) => Boolean(document.querySelector(`[data-testid="track-${track}"] [data-testid="term-${term}"]`)),
    [laravelTrack?.id, techleadId],
  );
  // Same session, second window: the page created by `browser.newPage()`
  // owns its context and cannot open another page in it.
  const staleCtx = await browser.newContext({ storageState: await page.context().storageState() });
  const stalePage = await staleCtx.newPage();
  await stalePage.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const deleted = await feedbackOf(() => page.locator(`[data-testid="term-delete-${techleadId}"]`).click());
  const gone = await eventually((id) => !document.querySelector(`[data-testid="term-${id}"]`), techleadId);
  await stalePage.locator(`[data-testid="term-delete-${techleadId}"]`).click();
  const staleNotice = stalePage.locator('[data-testid="mutation-feedback"]');
  await staleNotice.waitFor({ timeout: 20_000 });
  const staleRole = await staleNotice.getAttribute("role");
  await staleCtx.close();
  check(
    "term-search E2E-006 pausar, retomar, mover e excluir um termo; excluir de novo numa página velha não é erro",
    pausedResult.role === "status"
      && paused.state
      && paused.badge === 1
      && resumed
      && moved.role === "status"
      && movedInto
      && deleted.role === "status"
      && gone
      && staleRole === "status",
    JSON.stringify({ pausedResult, paused, resumed, moved, movedInto, deleted, gone, staleRole }),
  );

  const seededId = await termIdOf("E2E Seeded Stack");
  const seededNew = page.locator(`[data-testid="term-new-${seededId}"]`);
  const newBefore = await seededNew.getAttribute("data-count");
  await seededNew.click();
  await settle(new RegExp(`by=${seededId}`));
  const markedNew = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="job-new-"]')].map((node) => node.getAttribute("data-testid")).sort());
  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  const newAfter = await page.locator(`[data-testid="term-new-${seededId}"]`).getAttribute("data-count");
  check(
    "term-search E2E-009 o termo mostra 2 novas, a lista marca as duas e a contagem zera depois da visita",
    newBefore === "2"
      && JSON.stringify(markedNew) === JSON.stringify(["job-new-905000011", "job-new-905000012"])
      && newAfter === "0",
    JSON.stringify({ newBefore, markedNew, newAfter }),
  );

  const tracksBefore = await trackCards();
  const originalPrimary = tracksBefore.find((card) => card.primary);
  const phpTrackCard = tracksBefore.find((card) => card.name === "PHP E2E");
  await page.locator(`[data-testid="track-edit-${phpTrackCard?.id}"]`).click();
  await settle(new RegExp(`/searches/tracks/${phpTrackCard?.id}$`));
  const evidence = await page.evaluate(() => ({
    supported: document.querySelector('[data-testid="track-evidence-supported"]')?.textContent?.trim() ?? "",
    gaps: document.querySelector('[data-testid="track-evidence-gaps"]')?.textContent?.trim() ?? "",
  }));
  const positives = page.locator('[data-testid="track-positives"]');
  const ranges = page.locator('[data-testid="track-ranges"]');
  const savedRanges = await ranges.inputValue();
  const editedPositives = `${await positives.inputValue()}\nsymfony 6`;
  await positives.fill(editedPositives);
  await ranges.fill("USD month 9000 5000");
  const refusedEdit = await feedbackOf(() => page.locator('[data-testid="track-save"]').click());
  const keptAfterRefusal = { positives: await positives.inputValue(), ranges: await ranges.inputValue() };
  await ranges.fill(savedRanges);
  const savedEdit = await feedbackOf(() => page.locator('[data-testid="track-save"]').click());
  await page.reload({ waitUntil: "networkidle" });
  const persistedPositives = await positives.inputValue();
  const gapsAfterSave = (await page.locator('[data-testid="track-evidence-gaps"]').textContent()) ?? "";
  await page.goto(`${payBase}&track=${phpTrackCard?.id}`, { waitUntil: "networkidle" });
  const recalculating = {
    notice: await page.locator('[data-testid="track-recalculating"]').count(),
    fits: await payFits(),
  };
  check(
    "term-search E2E-002 principal primeiro; a trilha aceita salva a palavra nova, a recusa mantém o digitado e Vagas avisa o recálculo com as notas anteriores",
    tracksBefore[0]?.primary === true
      && /php/i.test(evidence.supported)
      && /symfony/i.test(gapsAfterSave)
      && refusedEdit.role === "alert"
      && refusedEdit.text.includes(ptBR.searchFeedback.range_invalid)
      && keptAfterRefusal.positives === editedPositives
      && keptAfterRefusal.ranges === "USD month 9000 5000"
      && savedEdit.role === "status"
      && persistedPositives.includes("symfony 6")
      && recalculating.notice === 1
      && recalculating.fits["904000001"] === "85",
    JSON.stringify({ tracksBefore, evidence, gapsAfterSave, refusedEdit, keptAfterRefusal, savedEdit, recalculating }),
  );

  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const promoted = await feedbackOf(() =>
    page.locator(`[data-testid="track-set-primary-${phpTrackCard?.id}"]`).click());
  const promotedFirst = await eventually(
    (id) => document.querySelector('[data-testid^="track-"][data-primary]')?.getAttribute("data-testid") === `track-${id}`,
    phpTrackCard?.id,
  );
  await page.goto(payBase, { waitUntil: "networkidle" });
  const onPromoted = await payFits();
  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  await feedbackOf(() => page.locator(`[data-testid="track-set-primary-${originalPrimary?.id}"]`).click());
  await page.goto(payBase, { waitUntil: "networkidle" });
  const onOriginal = await payFits();
  check(
    "term-search E2E-004 promover a trilha aceita faz Vagas abrir nela, e devolver a principal restaura as notas",
    promoted.role === "status"
      && promotedFirst
      && onPromoted["904000001"] === "85"
      && onOriginal["904000001"] === "60",
    JSON.stringify({ promoted, promotedFirst, onPromoted, onOriginal }),
  );

  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const archivedTrack = await feedbackOf(() =>
    page.locator(`[data-testid="track-archive-${phpTrackCard?.id}"]`).click());
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const chipWhileArchived = await page.locator(`[data-testid="filter-track-${phpTrackCard?.id}"]`).count();
  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const restoredTrack = await feedbackOf(() =>
    page.locator(`[data-testid="track-restore-${phpTrackCard?.id}"]`).click());
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const chipAfterRestore = await page.locator(`[data-testid="filter-track-${phpTrackCard?.id}"]`).count();
  check(
    "term-search E2E-005 arquivar tira a trilha do seletor de Vagas e restaurar a devolve",
    archivedTrack.role === "status"
      && chipWhileArchived === 0
      && restoredTrack.role === "status"
      && chipAfterRestore === 1,
    JSON.stringify({ archivedTrack, chipWhileArchived, restoredTrack, chipAfterRestore }),
  );

  await page.goto(`${BASE}/jobs/905000001`, { waitUntil: "networkidle" });
  const detailFits = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="job-track-fit-"][data-computed]')].map((card) => ({
      id: Number(card.getAttribute("data-testid").slice("job-track-fit-".length)),
      computed: card.getAttribute("data-computed") === "true",
      parts: card.querySelectorAll(".jho-bar span[title]").length,
    })));
  const primaryDetail = detailFits.find((fit) => fit.id === originalPrimary?.id);
  const phpDetail = detailFits.find((fit) => fit.id === phpTrackCard?.id);
  check(
    "term-search E2E-010 vaga sem nota da trilha PHP mostra o fit da principal e o da PHP, cada um com a quebra",
    primaryDetail?.computed === false
      && phpDetail?.computed === true
      && primaryDetail.parts > 0
      && phpDetail.parts > 0,
    JSON.stringify(detailFits),
  );

  const hostileTrackName = "<img src=x onerror=alert(1)>";
  let trackDialog = false;
  const onTrackDialog = async (dialog) => {
    trackDialog = true;
    await dialog.dismiss();
  };
  page.on("dialog", onTrackDialog);
  await page.goto(`${BASE}/searches/tracks/new`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="track-name"]').fill(hostileTrackName);
  await page.locator('[data-testid="track-titles"]').fill("Hostile Name Engineer");
  await page.locator('[data-testid="track-positives"]').fill("hostile 5");
  const hostileCreated = await feedbackOf(async () => {
    await page.locator('[data-testid="track-create"]').click();
    await settle(/\/searches$/);
  });
  const hostileTrack = (await trackCards()).find((card) => card.name === hostileTrackName);
  const injectedImages = await page.locator('img[src="x"]').count();
  page.off("dialog", onTrackDialog);
  check(
    "term-search E2E-018 nome de trilha hostil aparece como texto e não abre diálogo",
    hostileCreated.role === "status" && Boolean(hostileTrack) && injectedImages === 0 && !trackDialog,
    JSON.stringify({ hostileCreated, hostileTrack, injectedImages, trackDialog }),
  );

  const withSuiteIds = (path) =>
    path.replace("{track}", String(phpTrackCard?.id)).replace("{term}", String(seededId));
  const searchRoutes = OVERFLOW_SEARCHES_SWEEP.map(withSuiteIds);
  const searchOverflows = [];
  for (const [width, height] of [[375, 812], [768, 1024], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const path of searchRoutes) {
      if (!(await gotoMeasured(page, path, searchOverflows, `${width}px `))) continue;
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) searchOverflows.push(`${width}px ${path}: ${overflow}px`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  check(
    "term-search E2E-013 Buscas, trilhas, Vagas com os controles novos e saúde das capturas cabem em 375, 768 e 1024 px",
    searchOverflows.length === 0,
    searchOverflows.slice(0, 4).join(" · "),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  const searchLeaks = await portugueseLeaks(ENGLISH_SEARCHES_SWEEP.map(withSuiteIds));
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  check(
    "term-search E2E-014 Buscas, editor de trilha, Vagas e saúde das capturas em inglês não vazam português",
    searchLeaks.length === 0,
    searchLeaks.slice(0, 8).join(" | "),
  );

  const capturesResponse = await page.goto(`${BASE}/admin/captures`, { waitUntil: "networkidle" });
  const captureHealth = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid^="capture-health-"][data-red]').length,
    text: document.querySelector('[data-testid="route-admin-captures"]')?.innerText ?? "",
  }));
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  await page
    .locator("li")
    .filter({ hasText: "e2e-alvo@local.test" })
    .first()
    .locator('[data-testid="impersonate-user"]')
    .click();
  await page.waitForSelector('[data-testid="stop-impersonating"]', { timeout: 15_000 });
  const borrowedCaptures = await page.goto(`${BASE}/admin/captures`, { waitUntil: "domcontentloaded" });
  check(
    "term-search E2E-012 saúde das capturas mostra agregados por plataforma sem termo e recusa a sessão emprestada",
    capturesResponse?.status() === 200
      && captureHealth.cards > 0
      && captureHealth.text.includes(ptBR.captures.dayQuota)
      && captureHealth.text.includes(ptBR.captures.lastError)
      && !/Laravel|techlead|E2E Seeded Stack/i.test(captureHealth.text)
      && borrowedCaptures?.status() === 403,
    JSON.stringify({ status: capturesResponse?.status(), cards: captureHealth.cards, borrowed: borrowedCaptures?.status() }),
  );

  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const borrowedSave = await saveTermOnPage("E2E Borrowed");
  const borrowedId = await termIdOf("E2E Borrowed");
  const borrowedPlatforms = await page.locator(`[data-testid="term-platforms-${borrowedId}"] li`).allTextContents();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.click('[data-testid="stop-impersonating"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-impersonating"]'), { timeout: 15_000 });
  check(
    "term-search E2E-019 sessão emprestada salva o termo e deixa a busca para a varredura diária",
    borrowedSave.role === "status"
      && borrowedSave.text.includes(ptBR.searchFeedback.run_waiting_sweep)
      && borrowedPlatforms.length > 0
      && borrowedPlatforms.every((line) => line.includes(ptBR.captureState.waiting_sweep)),
    JSON.stringify({ borrowedSave, borrowedPlatforms }),
  );

  const linkedCtx = await browser.newContext();
  const linkedPage = await linkedCtx.newPage();
  await linkedCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await linkedPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await linkedPage.fill('input[name="email"]', "e2e-recrutador-vinculado@local.test");
  await linkedPage.fill('input[name="password"]', E2E_PASSWORD);
  await linkedPage.locator('[data-testid="login-submit"]').click();
  await linkedPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  const recruiterSearches = await linkedPage.goto(`${BASE}/searches`, { waitUntil: "domcontentloaded" });
  await linkedPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const recruiterTrackChips = await linkedPage.locator('[data-testid^="filter-track-"]').count();
  await linkedPage.goto(`${BASE}/recruiter`, { waitUntil: "networkidle" });
  const followedHref = await linkedPage.locator('[data-testid^="recruiter-candidate-"]').first().getAttribute("href");
  await linkedPage.goto(`${BASE}${followedHref}`, { waitUntil: "networkidle" });
  const followedText = await linkedPage.evaluate(() => document.body.innerText);
  await linkedCtx.close();
  check(
    "term-search E2E-011 recrutador vinculado: Buscas proibida, Vagas sem seletor de trilha e funil sem trilha nem termo",
    recruiterSearches?.status() === 403
      && recruiterTrackChips === 0
      && Boolean(followedHref)
      && !/PHP E2E|Laravel|techlead|E2E Seeded Stack|E2E Borrowed/.test(followedText),
    JSON.stringify({ status: recruiterSearches?.status(), recruiterTrackChips, followedHref }),
  );

  const expiredSearchCtx = await browser.newContext();
  const expiredSearch = await expiredSearchCtx.newPage();
  await expiredSearchCtx.addCookies([
    { name: "jho_locale", value: "pt-BR", url: BASE },
    { name: "jho_session", value: "expired-task05", url: BASE },
  ]);
  await expiredSearch.goto(`${BASE}/searches/tracks/new?term=${encodeURIComponent("Expired Probe")}`, {
    waitUntil: "networkidle",
  });
  const expiredLanded = new URL(expiredSearch.url()).pathname;
  await expiredSearch.fill('input[name="email"]', E2E_EMAIL);
  await expiredSearch.fill('input[name="password"]', E2E_PASSWORD);
  await expiredSearch.locator('[data-testid="login-submit"]').click();
  await expiredSearch.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expiredSearch.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const afterExpired = await expiredSearch.evaluate(() => document.body.innerText);
  await expiredSearchCtx.close();
  check(
    "term-search E2E-016 sessão vencida na sugestão de trilha volta ao login e, depois de entrar, nada foi gravado",
    expiredLanded === "/login" && !afterExpired.includes("Expired Probe"),
    JSON.stringify({ expiredLanded }),
  );

  /* ------------- "Não me interessa": arquivar, esconder e restaurar ------------- */
  const dismissId = 905000021;
  const dismissRow = `[data-testid="job-link-${dismissId}"]`;
  const rowGone = (selector) => !document.querySelector(selector);
  const rowShown = (selector) => Boolean(document.querySelector(selector));
  await page.goto(`${BASE}/jobs?q=Quokkaverse`, { waitUntil: "networkidle" });
  const listedBefore = await page.locator(dismissRow).count();
  const dismissLabel = ((await page.locator(`[data-testid="job-dismiss-${dismissId}"]`).textContent()) ?? "").trim();
  await page.locator(`[data-testid="job-dismiss-${dismissId}"]`).click();
  const hiddenAfterClick = await eventually(rowGone, dismissRow);
  await page.reload({ waitUntil: "networkidle" });
  const hiddenAfterReload = (await page.locator(dismissRow).count()) === 0;
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="preset-archived"]').click();
  await settle(/status=archived/);
  const listedArchived = await eventually(rowShown, dismissRow);
  await page.locator(`[data-testid="job-restore-${dismissId}"]`).click();
  const leftArchived = await eventually(rowGone, dismissRow);
  await page.goto(`${BASE}/jobs?q=Quokkaverse`, { waitUntil: "networkidle" });
  const restored = (await page.locator(dismissRow).count()) === 1
    && (await page.locator(`[data-testid="job-dismiss-${dismissId}"]`).count()) === 1;
  check(
    "não me interessa: some da lista, sobrevive à recarga, fica em Arquivadas e volta ao restaurar",
    listedBefore === 1
      && dismissLabel === ptBR.jobs.notInterested
      && hiddenAfterClick
      && hiddenAfterReload
      && listedArchived
      && leftArchived
      && restored,
    JSON.stringify({ listedBefore, dismissLabel, hiddenAfterClick, hiddenAfterReload, listedArchived, leftArchived, restored }),
  );

  // No detalhe: quem abriu a vaga na origem e viu "US only" decide ali mesmo.
  await page.goto(`${BASE}/jobs/${dismissId}`, { waitUntil: "networkidle" });
  await page.locator(`[data-testid="job-dismiss-${dismissId}"]`).click();
  const detailRestorable = await eventually(rowShown, `[data-testid="job-restore-${dismissId}"]`);
  const detailArchived = await eventually(
    () => document.querySelector('[data-testid="track-status"]')?.value === "archived",
  );
  await page.locator(`[data-testid="job-restore-${dismissId}"]`).click();
  const detailBack = await eventually(rowShown, `[data-testid="job-dismiss-${dismissId}"]`);
  check(
    "não me interessa no detalhe arquiva e oferece restaurar, e restaurar devolve a vaga ao funil",
    detailRestorable && detailArchived && detailBack,
    JSON.stringify({ detailRestorable, detailArchived, detailBack }),
  );
}
