export async function run({ BASE, page, check }) {
  await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
  const tracks = await page.locator('[data-testid^="track-"][data-primary]').evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.dataset.testid.slice("track-".length),
      primary: card.dataset.primary === "true",
      name: card.querySelector("[data-user-content]")?.textContent.trim(),
    })));
  const original = tracks.find((track) => track.primary);
  const alternate = tracks.find((track) => track.name === "PHP E2E");
  if (!original || !alternate) throw new Error("Trilhas de teste ausentes");
  await page.locator(`[data-testid="track-set-primary-${alternate.id}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="track-${id}"]`)?.dataset.primary === "true", alternate.id);
  try {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/jobs?fit=0`, { waitUntil: "networkidle" });
      await page.reload({ waitUntil: "networkidle" });
      const primary = page.getByTestId("filter-track-primary");
      const named = page.getByTestId(`filter-track-${original.id}`);
      const labels = await Promise.all([primary, named].map((locator) => locator.evaluate((element) => ({
        text: element.textContent.trim(),
        transform: getComputedStyle(element).textTransform,
        user: element.hasAttribute("data-user-content"),
      }))));
      check(`#391 ${width}px distingue rótulo principal do nome da trilha após recarga`,
        labels[0].transform === "uppercase" && labels[1].transform === "none"
          && labels[1].text === original.name && labels[1].user,
        JSON.stringify(labels));
      await named.click();
      await page.waitForURL((url) => url.searchParams.get("track") === original.id);
      await page.reload({ waitUntil: "networkidle" });
      check(`#391 ${width}px seleção da trilha nomeada persiste`,
        await page.getByTestId(`filter-track-${original.id}`).getAttribute("aria-current") === "true");
      check(`#391 ${width}px sem overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  } finally {
    await page.goto(`${BASE}/searches`, { waitUntil: "networkidle" });
    await page.locator(`[data-testid="track-set-primary-${original.id}"]`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="track-${id}"]`)?.dataset.primary === "true", original.id);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
}
