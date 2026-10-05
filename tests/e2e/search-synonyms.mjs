// E2E-007 (#370, Fase 0): com SEARCH_SYNONYMS_ENABLED ligada no ambiente do
// runner, a consulta "engenheiro" acha a vaga publicada só em inglês, a linha
// diz qual sinônimo casou, a frase entre aspas continua literal, e nada estoura
// em 375 px. Fixtures 907000000–907000001 em `setup.mjs`.
const waitForFilters = (page) => page.waitForFunction(() => {
  const input = document.querySelector('[data-testid="filters-query"]');
  return input && !input.closest("[inert]") && !input.closest("[aria-busy]");
});

export async function checkSearchSynonyms(page, base, check) {
  // A empresa isola as fixtures do resto do acervo sem tocar na consulta.
  const url = (query) =>
    `${base}/jobs?fit=&company=Synonym%20QA&sort=relevance&q=${encodeURIComponent(query)}`;
  const linked = async () => (await page.locator('[data-testid^="job-link-"]').evaluateAll(
    (links) => links.map((link) => link.dataset.testid.slice("job-link-".length)).sort(),
  ));

  await page.goto(url("engenheiro"), { waitUntil: "networkidle" });
  await waitForFilters(page);
  check("sinônimos: 'engenheiro' acha a vaga em português e a só em inglês",
    (await linked()).join(",") === "907000000,907000001");
  check("sinônimos: total conta as duas",
    await page.getByTestId("jobs-total").getAttribute("data-total") === "2");
  const note = page.getByTestId("job-synonym-907000000");
  check("sinônimos: a vaga em inglês diz qual termo da lista casou",
    await note.count() === 1
      && (await note.textContent())?.includes("também buscou")
      && (await note.textContent())?.includes("engineer"));
  check("sinônimos: a vaga que casou pelo termo digitado não leva a nota",
    await page.getByTestId("job-synonym-907000001").count() === 0);
  check("sinônimos: o termo da lista é marcado como conteúdo, não como texto da tela",
    await note.locator("[data-user-content]").count() === 1);
  check("sinônimos: nenhuma menção a semântico",
    !/seman/i.test(await page.getByTestId("job-match-907000000").textContent() ?? ""));

  await page.goto(url('"engenheiro"'), { waitUntil: "networkidle" });
  await waitForFilters(page);
  check("sinônimos: a frase entre aspas é literal e não expande",
    (await linked()).join(",") === "907000001" && await page.locator('[data-testid^="job-synonym-"]').count() === 0);

  await page.goto(url("engenheiro"), { waitUntil: "networkidle" });
  await waitForFilters(page);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  await waitForFilters(page);
  check("sinônimos: 375 px sem estouro horizontal, com a nota à vista",
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      && await page.getByTestId("job-synonym-907000000").isVisible());
  if (viewport) await page.setViewportSize(viewport);
  check("sinônimos: refresh preserva o resultado",
    (await linked()).join(",") === "907000000,907000001"
      && new URL(page.url()).searchParams.get("q") === "engenheiro");
}
