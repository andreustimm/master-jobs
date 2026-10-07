// Área `pipeline-filters` do E2E de navegador: filtros do Funil (#478).
//
// Conta própria com funil fixo (`PIPELINE_FILTER_FIXTURE`, gravado em
// setup.mjs): empresa, texto, busca ampliada, canal e score combinam com o
// estágio, os contadores seguem os filtros, e o estado sobrevive a refresh e
// ao voltar do navegador. Sinônimos ligados só no runner (run-isolated.mjs).
import { PIPELINE_FILTER_FIXTURE } from "../pipeline-filters-fixture.mjs";
import { makePortugueseLeaks } from "./shared.mjs";

const [backend, engenheiro, platform] = PIPELINE_FILTER_FIXTURE.jobs.map((job) => job.id);
const { alpha, beta } = PIPELINE_FILTER_FIXTURE.companies;

const ready = (target) => target.waitForFunction(() => {
  const shell = document.getElementById("application-shell");
  return shell && !shell.hasAttribute("inert") && !shell.hasAttribute("aria-busy")
    && !document.querySelector('[data-testid="navigation-transition"]');
}, null, { timeout: 20_000 });

/** Os ids das linhas do funil, em ordem crescente. */
const listed = async (target) => (await target.locator('[data-testid^="pipeline-job-"]:not([data-testid^="pipeline-job-state-"])')
  .evaluateAll((links) => links.map((link) => Number(link.dataset.testid.slice("pipeline-job-".length)))))
  .sort((a, b) => a - b);

const count = async (target, stage) => {
  const chip = target.getByTestId(`pipeline-filter-${stage}`);
  return (await chip.count()) === 0 ? null : Number(await chip.getAttribute("data-count"));
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Abre o seletor (`<details>`) se estiver fechado; clicar no resumo aberto o fecharia. */
const openPicker = async (target, testId) => {
  if (!(await target.getByTestId(`${testId}-combo`).evaluate((details) => details.open))) {
    await target.getByTestId(`${testId}-summary`).click();
  }
};

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, trackConsole, gotoMeasured } = ctx;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  trackConsole(page);
  try {
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', PIPELINE_FILTER_FIXTURE.email);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      page.getByTestId("login-submit").click(),
    ]);

    await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
    await ready(page);
    check("E2E-478 sem filtro, o funil mostra as três candidaturas",
      same(await listed(page), [backend, engenheiro, platform]) && (await count(page, "all")) === 3,
      JSON.stringify(await listed(page)));

    // E2E-478-01: empresa pelo seletor, depois texto pelo campo.
    await page.getByTestId("pipeline-company-summary").click();
    await page.getByTestId(`pipeline-company-option-${alpha}`).check();
    await page.getByTestId("pipeline-company-submit").click();
    await page.waitForURL((url) => url.searchParams.getAll("company").join() === alpha, { timeout: 15_000 });
    await ready(page);
    check("E2E-478-01 empresa: só as candidaturas da Alpha, e os contadores seguem",
      same(await listed(page), [backend, engenheiro])
        && (await count(page, "all")) === 2 && (await count(page, "applied")) === 1 && (await count(page, "shortlisted")) === 1,
      JSON.stringify({ rows: await listed(page), applied: await count(page, "applied") }));

    const query = page.getByTestId("pipeline-query");
    await query.fill("engenheiro");
    await query.press("Enter");
    await page.waitForURL((url) => url.searchParams.get("q") === "engenheiro", { timeout: 15_000 });
    await ready(page);
    check("E2E-478-01 texto literal: 'engenheiro' acha só o cargo em português, contador 1",
      same(await listed(page), [engenheiro]) && (await count(page, "all")) === 1 && (await count(page, "applied")) === null,
      JSON.stringify(await listed(page)));

    // E2E-478-03: ampliar acha "Engineer" pelo sinônimo.
    await page.getByTestId("pipeline-broaden").click();
    await page.waitForURL((url) => url.searchParams.get("semantic") === "1", { timeout: 15_000 });
    await ready(page);
    const broadened = await listed(page);
    check("E2E-478-03 busca ampliada: 'engenheiro' também acha 'Engineer'",
      same(broadened, [backend, engenheiro]) && (await count(page, "applied")) === 1,
      JSON.stringify(broadened));
    check("E2E-478-03 a tela não promete busca semântica",
      !/sem[aâ]nti/i.test(await page.getByTestId("pipeline-filters").textContent() ?? ""));

    // E2E-478-02: refresh e voltar mantêm o estado e o resultado.
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    const afterReload = new URL(page.url()).searchParams;
    check("E2E-478-02 refresh preserva filtros, campo e resultado",
      same(await listed(page), [backend, engenheiro])
        && afterReload.get("q") === "engenheiro" && afterReload.get("semantic") === "1"
        && afterReload.getAll("company").join() === alpha
        && (await query.inputValue()) === "engenheiro",
      page.url());

    await page.goBack({ waitUntil: "networkidle" });
    await ready(page);
    check("E2E-478-02 voltar devolve a busca literal",
      new URL(page.url()).searchParams.get("semantic") === null && same(await listed(page), [engenheiro]),
      page.url());

    // Canal + score + estágio, por URL compartilhada.
    const shared = `${BASE}/pipeline?stage=applied&channel=direct&channel=referral&fit=60`;
    await page.goto(shared, { waitUntil: "networkidle" });
    await ready(page);
    check("E2E-478-02 canal, score e estágio combinam: Alpha 85 e Beta 70 aplicadas",
      same(await listed(page), [backend, platform]) && (await count(page, "applied")) === 2 && (await count(page, "all")) === 2,
      JSON.stringify(await listed(page)));
    await page.goto(`${shared}&fitMax=80`, { waitUntil: "networkidle" });
    await ready(page);
    check("E2E-478-02 teto de score corta a de 85",
      same(await listed(page), [platform]) && (await page.getByTestId("pipeline-score-max").inputValue()) === "80",
      JSON.stringify(await listed(page)));

    await page.goto(`${BASE}/pipeline?company=${encodeURIComponent(beta)}&q=engenheiro`, { waitUntil: "networkidle" });
    await ready(page);
    check("E2E-478 filtros sem resultado dizem isso e oferecem limpar",
      (await page.getByTestId("pipeline-empty-filtered").count()) === 1,
    );
    await page.getByTestId("pipeline-clear-filters").click();
    await page.waitForURL((url) => url.pathname === "/pipeline" && url.search === "", { timeout: 15_000 });
    await ready(page);
    check("E2E-478 limpar filtros devolve o funil inteiro", same(await listed(page), [backend, engenheiro, platform]));

    // E2E-492: marcas e campos seguem a URL depois de voltar, avançar, limpar
    // e de uma faixa trocada pelo servidor — sem refresh entre os passos, que
    // remontaria a tela e esconderia o defeito.
    await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
    await ready(page);
    const companyParam = () => new URL(page.url()).searchParams.getAll("company").join("|");
    const channelParam = () => new URL(page.url()).searchParams.getAll("channel").join("|");

    await openPicker(page, "pipeline-company");
    await page.getByTestId(`pipeline-company-option-${alpha}`).check();
    await page.getByTestId("pipeline-company-submit").click();
    await page.waitForURL(() => companyParam() === alpha, { timeout: 15_000 });
    await ready(page);
    await page.goBack();
    await page.waitForURL(() => companyParam() === "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 voltar desmarca a empresa que saiu da URL",
      !(await page.getByTestId(`pipeline-company-option-${alpha}`).isChecked()));
    await page.goForward();
    await page.waitForURL(() => companyParam() === alpha, { timeout: 15_000 });
    await ready(page);
    check("E2E-492 avançar marca de novo a empresa que voltou à URL",
      await page.getByTestId(`pipeline-company-option-${alpha}`).isChecked());
    await page.goBack();
    await page.waitForURL(() => companyParam() === "", { timeout: 15_000 });
    await ready(page);
    await openPicker(page, "pipeline-company");
    await page.getByTestId(`pipeline-company-option-${beta}`).check();
    await page.getByTestId("pipeline-company-submit").click();
    await page.waitForURL(() => companyParam() !== "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 o Aplicar depois de voltar não ressuscita a empresa desfeita",
      companyParam() === beta && same(await listed(page), [platform]), page.url());

    await page.getByTestId("pipeline-company-clear").click();
    await page.waitForURL(() => companyParam() === "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 limpar desmarca a empresa",
      !(await page.getByTestId(`pipeline-company-option-${beta}`).isChecked()));

    await openPicker(page, "pipeline-channel");
    await page.getByTestId("pipeline-channel-option-direct").check();
    await page.getByTestId("pipeline-channel-submit").click();
    await page.waitForURL(() => channelParam() === "direct", { timeout: 15_000 });
    await ready(page);
    await page.goBack();
    await page.waitForURL(() => channelParam() === "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 voltar desmarca o canal que saiu da URL",
      !(await page.getByTestId("pipeline-channel-option-direct").isChecked()));
    await openPicker(page, "pipeline-channel");
    await page.getByTestId("pipeline-channel-option-referral").check();
    await page.getByTestId("pipeline-channel-submit").click();
    await page.waitForURL(() => channelParam() !== "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 o Aplicar depois de voltar não ressuscita o canal desfeito",
      channelParam() === "referral", page.url());
    await page.getByTestId("pipeline-channel-clear").click();
    await page.waitForURL(() => channelParam() === "", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 limpar desmarca o canal",
      !(await page.getByTestId("pipeline-channel-option-referral").isChecked()));

    // Faixa invertida igual à já aplicada: o servidor troca, e os campos também.
    await page.goto(`${BASE}/pipeline?fit=60&fitMax=80`, { waitUntil: "networkidle" });
    await ready(page);
    const scoreParams = () => {
      const params = new URL(page.url()).searchParams;
      return `${params.get("fit")}/${params.get("fitMax")}`;
    };
    await page.getByTestId("pipeline-score-min").fill("80");
    await page.getByTestId("pipeline-score-max").fill("60");
    await page.getByTestId("pipeline-score-submit").click();
    await page.waitForURL(() => scoreParams() === "80/60", { timeout: 15_000 });
    await ready(page);
    const swapped = {
      notice: await page.getByTestId("pipeline-notice-range_swapped").count(),
      min: await page.getByTestId("pipeline-score-min").inputValue(),
      max: await page.getByTestId("pipeline-score-max").inputValue(),
    };
    check("E2E-492 faixa invertida: aviso e campos já na ordem trocada",
      swapped.notice === 1 && swapped.min === "60" && swapped.max === "80", JSON.stringify(swapped));
    await page.getByTestId("pipeline-score-submit").click();
    await page.waitForURL(() => scoreParams() === "60/80", { timeout: 15_000 });
    await ready(page);
    check("E2E-492 o Aplicar seguinte envia a faixa na ordem certa, sem aviso",
      (await page.getByTestId("pipeline-notice-range_swapped").count()) === 0 && same(await listed(page), [platform]),
      page.url());

    // E2E-478-04: 375 px com o seletor aberto, e inglês sem português.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/pipeline?q=engineer&semantic=1&company=${encodeURIComponent(alpha)}`, { waitUntil: "networkidle" });
    await ready(page);
    await page.getByTestId("pipeline-company-summary").click();
    check("E2E-478-04 375 px sem rolagem horizontal, com o seletor de empresa aberto",
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    await context.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
    const leaks = await makePortugueseLeaks({ page, gotoMeasured })([
      `/pipeline?q=engineer&semantic=1&company=${encodeURIComponent(alpha)}&channel=direct&fit=10`,
    ]);
    check("E2E-478-04 filtros em inglês não vazam português", leaks.length === 0, leaks.slice(0, 6).join(" | "));
  } finally {
    await context.close();
  }
}
