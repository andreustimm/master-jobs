import { ptBR, transitionHelpers } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, page, check } = ctx;
  const { routerPush } = transitionHelpers(ctx);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/transition-test`, { waitUntil: "networkidle" });
    await routerPush("/transition-test?delay=prolonged");
    await page.waitForFunction((text) => document.querySelector('[data-testid="navigation-soft-status"]')?.textContent === text,
      ptBR.transition.prolonged, { timeout: 6000 });
    const waiting = await page.evaluate(() => ({
      overlay: Boolean(document.querySelector('[data-testid="navigation-transition"]')),
      inert: document.getElementById("application-shell")?.hasAttribute("inert"),
      busy: document.getElementById("application-shell")?.getAttribute("aria-busy"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    check(`#394 ${width}px espera na mesma rota continua operável após três segundos`,
      !waiting.overlay && !waiting.inert && waiting.busy === "true" && !waiting.overflow,
      JSON.stringify(waiting));
    await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("aria-busy"));
    for (const preset of ["untriaged", "withSalary", "recent"]) {
      await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
      const link = page.getByTestId(`preset-${preset}`);
      const target = new URL(await link.getAttribute("href"), BASE);
      await link.click();
      await page.waitForURL((url) => url.pathname === target.pathname && url.search === target.search);
      await page.waitForFunction(() => !document.getElementById("application-shell")?.hasAttribute("aria-busy"));
      check(`#394 ${width}px ${preset} conclui sem overlay`, await page.getByTestId("navigation-transition").count() === 0);
      await page.reload({ waitUntil: "networkidle" });
      check(`#394 ${width}px ${preset} filtro persiste após recarga`, new URL(page.url()).search === target.search);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
