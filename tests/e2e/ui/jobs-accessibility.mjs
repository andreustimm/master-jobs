export async function run({ BASE, page, browser, E2E_PASSWORD, check }) {
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await loginPage.locator('input[name="email"]').fill("e2e-candidato@local.test");
  await loginPage.locator('input[name="password"]').fill(E2E_PASSWORD);
  await loginPage.keyboard.press("Enter");
  await loginPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  await loginPage.waitForLoadState("networkidle");
  await loginPage.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("inert") && !document.querySelector('[data-testid="navigation-transition"]'));
  await loginPage.keyboard.press("Tab");
  const firstFocus = await loginPage.evaluate(() => ({
    shortcut: document.activeElement?.getAttribute("data-testid") === "skip-to-header",
    header: document.getElementById("application-header")?.contains(document.activeElement),
    text: document.activeElement?.textContent?.slice(0, 100),
    url: location.pathname,
  }));
  check("#398 primeiro Tab após login permite alcançar o cabeçalho",
    firstFocus.shortcut || firstFocus.header, JSON.stringify(firstFocus));
  if (firstFocus.shortcut) {
    await loginPage.keyboard.press("Enter");
    check("#398 Enter após login devolve foco ao cabeçalho",
      await loginPage.evaluate(() => document.activeElement?.id === "application-header"));
  }
  await loginContext.close();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/jobs?sort=relevance`, { waitUntil: "networkidle" });
    check(`#398 ${width}px fallback de relevância anuncia aderência`,
      await page.getByTestId("filters-sort-fit").getAttribute("aria-current") === "true");
    const grouping = page.getByTestId("filters-grouped");
    check(`#398 ${width}px agrupamento expõe estado ativo`,
      await grouping.count() === 1 && await grouping.getAttribute("aria-current") === "true");
    const shortcut = page.getByTestId("skip-to-header");
    check(`#398 ${width}px lista oferece atalho ao cabeçalho`, await shortcut.count() === 1);
    if (await shortcut.count()) {
      await shortcut.focus();
      await page.keyboard.press("Enter");
      check(`#398 ${width}px atalho transfere foco ao cabeçalho`,
        await page.evaluate(() => document.activeElement?.id === "application-header"));
    }
    const recent = page.getByTestId("filters-sort-recent");
    if (await recent.count()) {
      await recent.click();
      await page.waitForURL((url) => url.searchParams.get("sort") === "recent");
      await page.reload({ waitUntil: "networkidle" });
      check(`#398 ${width}px ordem ativa persiste após reload`,
        await recent.getAttribute("aria-current") === "true" && await page.getByTestId("filters-sort-fit").getAttribute("aria-current") === null);
      await grouping.click();
      await page.waitForURL((url) => url.searchParams.get("ungrouped") === "1");
      await page.reload({ waitUntil: "networkidle" });
      check(`#398 ${width}px agrupamento desligado não anuncia ativo`, await grouping.getAttribute("aria-current") === null);
    }
    check(`#398 ${width}px sem overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
