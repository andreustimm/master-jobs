// Filtros que se aplicam sozinhos (#218).
//
// Conta as navegações RSC de /jobs, que são o custo real: cada uma é uma
// leitura da lista. O pré-carregamento (`next-router-prefetch`) fica fora da
// conta — ele não refaz a lista. Contexto próprio, com o service worker
// bloqueado, porque requisição atendida pelo worker não passa por
// `page.route` e a retenção da resposta não aconteceria.

const isNavigationRsc = (request) => {
  const headers = request.headers();
  return headers.rsc === "1" && !headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"];
};

const ready = (page) => page.waitForFunction(() => {
  const shell = document.getElementById("application-shell");
  return shell && !shell.hasAttribute("inert") && !shell.hasAttribute("aria-busy")
    && !document.querySelector('[data-testid="navigation-transition"]');
}, null, { timeout: 20_000 });

const param = (page, name) => new URL(page.url()).searchParams.get(name);

export async function checkFilterAutoApply(browser, base, { email, password }, check) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  try {
    await runChecks(await context.newPage(), base, { email, password }, check);
  } finally {
    await context.close();
  }
}

async function runChecks(page, base, { email, password }, check) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  let navigations = 0;
  let holdMs = 0;
  const jobsUrl = (url) => url.pathname === "/jobs";
  const count = async (route) => {
    if (isNavigationRsc(route.request())) {
      navigations += 1;
      if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    await route.continue();
  };
  await page.route(jobsUrl, count);

  try {
    await page.goto(`${base}/jobs`, { waitUntil: "networkidle" });
    await ready(page);
    const query = page.getByTestId("filters-query");

    // 1. Dois caracteres não pedem a lista; o terceiro pede, sem clique.
    navigations = 0;
    await query.click();
    await page.keyboard.type("Wo", { delay: 60 });
    await page.waitForTimeout(900);
    const shortTyped = { navigations, q: param(page, "q") };
    await page.keyboard.type("r");
    await page.waitForURL((url) => url.searchParams.get("q") === "Wor", { timeout: 10_000 });
    await ready(page);
    check(
      "#218 busca espera três caracteres e aplica sozinha depois da pausa",
      shortTyped.navigations === 0 && shortTyped.q === null && navigations === 1,
      JSON.stringify({ shortTyped, navigations }),
    );

    // 2. Digitação contínua vira UMA leitura, com a palavra inteira.
    navigations = 0;
    await page.keyboard.type("k mode fixture", { delay: 60 });
    await page.waitForURL((url) => url.searchParams.get("q") === "Work mode fixture", { timeout: 10_000 });
    await ready(page);
    await page.waitForTimeout(600);
    check(
      "#218 digitação contínua gera uma navegação só, e o campo segue com foco",
      navigations === 1
        && (await query.inputValue()) === "Work mode fixture"
        && (await query.evaluate((element) => element === document.activeElement)),
      JSON.stringify({ navigations, value: await query.inputValue() }),
    );

    // 3. Resposta lenta não apaga o que ainda está sendo digitado, e a última
    //    digitação vence.
    navigations = 0;
    holdMs = 1_500;
    await query.fill("");
    await page.keyboard.type("Work", { delay: 30 });
    await page.waitForTimeout(700);
    await page.keyboard.type(" mode fixture", { delay: 30 });
    const values = [];
    const recordValue = setInterval(() => {
      query.inputValue().then((value) => values.push(value), () => undefined);
    }, 100);
    // Primeiro a busca retida ("Work") confirma, depois a última digitação.
    await page.waitForURL((url) => url.searchParams.get("q") === "Work", { timeout: 20_000 });
    await page.waitForURL((url) => url.searchParams.get("q") === "Work mode fixture", { timeout: 20_000 });
    await ready(page);
    clearInterval(recordValue);
    holdMs = 0;
    const lastWins = {
      navigations,
      value: await query.inputValue(),
      focused: await query.evaluate((element) => element === document.activeElement),
      clobbered: values.some((value) => value === "Work"),
      q: param(page, "q"),
    };
    check(
      "#218 resposta atrasada não sobrescreve a digitação e a última busca vence",
      lastWins.value === "Work mode fixture" && lastWins.focused && !lastWins.clobbered
        && lastWins.q === "Work mode fixture" && lastWins.navigations === 2,
      JSON.stringify(lastWins),
    );

    // 4. Enter aplica na hora, inclusive abaixo do mínimo — é assim que se
    //    busca "HP".
    navigations = 0;
    await query.fill("HP");
    await query.press("Enter");
    await page.waitForURL((url) => url.searchParams.get("q") === "HP", { timeout: 10_000 });
    await ready(page);
    await page.waitForTimeout(700);
    check("#218 Enter aplica na hora, mesmo com dois caracteres, sem envio duplicado", navigations === 1, String(navigations));

    // 5. Slider: arrastar não navega; soltar aplica uma vez.
    await page.goto(`${base}/jobs`, { waitUntil: "networkidle" });
    await ready(page);
    const fitBefore = Number(param(page, "fit") ?? (await page.getByTestId("filters-score-min").inputValue()) ?? 0);
    // O papel `slider` é implícito no `input[type=range]` do polegar; a caixa
    // visível é a do elemento em volta dele.
    const thumb = page.getByTestId("filters-score-slider").getByRole("slider").first();
    const box = await thumb.locator("xpath=..").boundingBox();
    navigations = 0;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(box.x + box.width / 2 + step * 12, box.y + box.height / 2);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    const whileDragging = navigations;
    await page.mouse.up();
    await page.waitForURL((url) => Number(url.searchParams.get("fit")) > fitBefore, { timeout: 10_000 });
    await ready(page);
    await page.waitForTimeout(600);
    check(
      "#218 arrastar o slider não navega; soltar aplica uma vez",
      whileDragging === 0 && navigations === 1 && Number(param(page, "fit")) === Number(await page.getByTestId("filters-score-min").inputValue()),
      JSON.stringify({ whileDragging, navigations, fit: param(page, "fit") }),
    );

    // 6. Teclado no slider: setas seguidas viram uma leitura.
    navigations = 0;
    const fitBeforeKeys = Number(param(page, "fit"));
    await thumb.focus();
    for (let press = 0; press < 5; press += 1) await page.keyboard.press("ArrowRight");
    await page.waitForURL((url) => Number(url.searchParams.get("fit")) === fitBeforeKeys + 5, { timeout: 10_000 });
    await ready(page);
    await page.waitForTimeout(600);
    check("#218 setas seguidas no slider aplicam uma vez", navigations === 1, JSON.stringify({ navigations, fit: param(page, "fit") }));

    // 7. Campo numérico: passar do piso ao teto é o mesmo gesto; sair da faixa aplica.
    navigations = 0;
    await page.getByTestId("filters-score-min").fill("50");
    await page.getByTestId("filters-score-min").press("Tab");
    await page.waitForTimeout(700);
    const betweenFields = navigations;
    await page.getByTestId("filters-score-max").fill("90");
    await page.locator("h1").first().click();
    await page.waitForURL((url) => url.searchParams.get("fitMax") === "90" && url.searchParams.get("fit") === "50", { timeout: 10_000 });
    await ready(page);
    check(
      "#218 campos da faixa aplicam ao sair da faixa, não ao passar de um para o outro",
      betweenFields === 0 && navigations === 1,
      JSON.stringify({ betweenFields, navigations }),
    );

    // 8. Recarregar e voltar mantêm o contrato da URL.
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    const reloaded = {
      fit: await page.getByTestId("filters-score-min").inputValue(),
      fitMax: await page.getByTestId("filters-score-max").inputValue(),
    };
    await page.goBack({ waitUntil: "networkidle" });
    await ready(page);
    check(
      "#218 recarregar mantém o filtro aplicado sozinho, e voltar devolve o anterior aos campos",
      reloaded.fit === "50" && reloaded.fitMax === "90"
        && !param(page, "fitMax")
        && (await page.getByTestId("filters-score-max").inputValue()) === "",
      JSON.stringify({ reloaded, back: page.url() }),
    );
  } finally {
    holdMs = 0;
    await page.unroute(jobsUrl, count);
  }
}
