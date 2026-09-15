export async function checkWorkModes(page, base, check) {
  const query = "Work mode fixture";
  const cards = () => page.locator('[data-testid^="job-link-"]');
  const ready = () => page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="filters-query"]');
    return input && !input.closest("[inert]");
  });
  const select = async (mode) => {
    await page.getByTestId(`filter-work-mode-${mode}`).click();
    await page.waitForURL((url) => url.searchParams.get("workMode") === (mode === "all" ? null : mode));
    await page.getByTestId(`filter-work-mode-${mode}`).waitFor();
    await ready();
  };
  await page.goto(`${base}/?q=${encodeURIComponent(query)}`, { waitUntil: "networkidle" });
  await page.getByTestId("filter-cut-0").click();
  await page.waitForURL((url) => url.searchParams.get("fit") === "0");
  await ready();
  await select("remote");
  await page.reload({ waitUntil: "networkidle" });
  check("modalidade: cockpit mantém remoto após reload", await cards().count() === 12
    && await page.getByTestId("filter-work-mode-remote").getAttribute("aria-current") === "true");
  await page.getByTestId("cockpit-see-all").click();
  await page.waitForURL((url) => url.pathname === "/jobs");
  await ready();
  check("modalidade: ver todas preserva busca e filtro", new URL(page.url()).searchParams.get("workMode") === "remote"
    && new URL(page.url()).searchParams.get("q") === query
    && new URL(page.url()).searchParams.get("fit") === "0" && await cards().count() === 13);
  await page.getByTestId("filters-query").fill("Work Mode QA");
  await page.getByTestId("filters-submit").click();
  await page.waitForURL((url) => url.searchParams.get("q") === "Work Mode QA");
  await ready();
  check("modalidade: busca GET preserva remoto", new URL(page.url()).searchParams.get("workMode") === "remote"
    && await cards().count() === 13);

  for (const [mode, id] of [["hybrid", 903000013], ["onsite", 903000014]]) {
    await select(mode);
    await page.reload({ waitUntil: "networkidle" });
    check(`modalidade: ${mode} mostra apenas sua vaga`, await cards().count() === 1
      && await page.getByTestId(`job-link-${id}`).count() === 1);
  }
  await page.goBack({ waitUntil: "networkidle" });
  await ready();
  check("modalidade: voltar restaura híbrido", new URL(page.url()).searchParams.get("workMode") === "hybrid"
    && await page.getByTestId("filter-work-mode-hybrid").getAttribute("aria-current") === "true");
  await select("all");
  check("modalidade: todas inclui informação ausente", await cards().count() === 16
    && await page.getByTestId("job-link-903000015").count() === 1);

  await page.goto(`${base}/jobs?workMode=remote&q=${encodeURIComponent(query)}&size=10`, { waitUntil: "networkidle" });
  await page.getByTestId("pagination-next").click();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  await ready();
  check("modalidade: paginação mantém filtro e contagem", new URL(page.url()).searchParams.get("workMode") === "remote"
    && new URL(page.url()).searchParams.get("size") === "10"
    && await cards().count() === 3);
  await select("hybrid");
  check("modalidade: troca reinicia paginação", !new URL(page.url()).searchParams.has("page") && await cards().count() === 1);
  await page.getByTestId("filters-query").fill("no-work-mode-result");
  await page.getByTestId("filters-submit").click();
  await page.waitForURL((url) => url.searchParams.get("q") === "no-work-mode-result");
  await ready();
  check("modalidade: recorte sem resultado fica vazio", await cards().count() === 0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/jobs?workMode=remote&q=${encodeURIComponent(query)}`, { waitUntil: "networkidle" });
  check("modalidade: quatro opções cabem no celular", await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
    && await page.getByTestId("filter-work-mode-onsite").isVisible());
  await page.setViewportSize({ width: 1280, height: 900 });
}
