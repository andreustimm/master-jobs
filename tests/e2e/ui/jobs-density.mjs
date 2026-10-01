export async function run({ BASE, page, check }) {
  const assertDense = async (label) => {
    await page.reload({ waitUntil: "networkidle" });
    check(`#397 ${label} preserva densidade após reload`,
      new URL(page.url()).searchParams.get("dense") === "1"
      && await page.getByTestId("density-compact").getAttribute("aria-current") === "page");
  };
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/jobs?fit=0&status=any&ungrouped=1&size=10&sort=recent`, { waitUntil: "networkidle" });
    await page.getByTestId("density-compact").click();
    await page.waitForURL((url) => url.searchParams.get("dense") === "1");
    const next = page.getByTestId("pagination-next");
    check(`#397 ${width}px fixture permite paginar`, await next.count() === 1);
    if (await next.count()) {
      await next.click();
      await page.waitForURL((url) => url.searchParams.get("page") === "2");
      await assertDense(`${width}px paginação`);
    }
    await page.getByTestId("filters-sort-fit").click();
    await page.waitForURL((url) => !url.searchParams.has("sort"));
    await assertDense(`${width}px ordem`);
    await page.getByTestId("filter-work-mode-remote").click();
    await page.waitForURL((url) => url.searchParams.get("workMode") === "remote");
    await assertDense(`${width}px filtro`);
    await page.getByTestId("filters-query").fill("Engineer");
    await page.getByTestId("filters-submit").click();
    await page.waitForURL((url) => url.searchParams.get("q") === "Engineer");
    await assertDense(`${width}px formulário GET`);
    await page.getByTestId("preset-untriaged").click();
    await page.waitForURL((url) => url.searchParams.get("status") === "unfiled");
    await assertDense(`${width}px preset`);
    check(`#397 ${width}px sem overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
