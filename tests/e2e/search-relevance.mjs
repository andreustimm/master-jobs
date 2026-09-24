// E2E-005 (#223, tarefa 05): frase entre aspas + modalidade remota + ordem por
// relevância, com URL compartilhável, explicação por campo e o grupo de termos
// parecidos separado do resultado. Fixtures 906000000–906000002 em `setup.mjs`.
const waitForFilters = (page) => page.waitForFunction(() => {
  const input = document.querySelector('[data-testid="filters-query"]');
  return input && !input.closest("[inert]") && !input.closest("[aria-busy]");
});

export async function checkSearchRelevance(page, base, check) {
  // A empresa isola as fixtures do resto do acervo sem tocar na consulta.
  const query = '"tech lead"';
  const url = `${base}/jobs?fit=&workMode=remote&company=Relevance%20QA&sort=relevance&q=${encodeURIComponent(query)}`;
  const cards = () => page.locator('[data-testid^="job-link-"]');
  const order = async () => (await cards().evaluateAll((links) => links.map((link) => link.dataset.testid)));

  await page.goto(url, { waitUntil: "networkidle" });
  await waitForFilters(page);
  const first = await order();
  check("relevância: frase no título antes da frase na descrição",
    first.join(",") === "job-link-906000000,job-link-906000001");
  check("relevância: total conta só o resultado principal",
    await page.getByTestId("jobs-total").getAttribute("data-total") === "2");
  check("relevância: explicação diz cargo e descrição",
    (await page.getByTestId("job-match-906000000").textContent())?.includes("cargo")
      && (await page.getByTestId("job-match-906000001").textContent())?.includes("descrição"));
  check("relevância: grupo de termos parecidos, separado e rotulado",
    await page.getByTestId("jobs-near").count() === 1
      && await page.getByTestId("jobs-near-906000002").count() === 1
      && await page.getByTestId("job-link-906000002").count() === 0);
  check("relevância: chip de relevância ativo", await page.getByTestId("filters-sort-relevance").count() === 1);

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  await waitForFilters(page);
  check("relevância: 375 px sem estouro horizontal, com o grupo à vista",
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      && await page.getByTestId("jobs-near").isVisible());
  if (viewport) await page.setViewportSize(viewport);
  const params = new URL(page.url()).searchParams;
  check("relevância: refresh preserva URL e ordem",
    params.get("sort") === "relevance" && params.get("q") === query && params.get("workMode") === "remote"
      && (await order()).join(",") === first.join(","));

  await page.getByTestId("filters-query-clear").click();
  await page.waitForURL((next) => !next.searchParams.has("q"));
  await waitForFilters(page);
  check("relevância: sem q, some o chip e o grupo, e a ordem volta ao fit",
    await page.getByTestId("filters-sort-relevance").count() === 0
      && await page.getByTestId("jobs-near").count() === 0
      && await page.locator('[data-testid^="job-match-"]').count() === 0);
}
