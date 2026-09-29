// Área `public-facts` do E2E de navegador: editar os fatos opt-in do perfil público em /candidate (#327).
// O HTML de /p/<slug> com fatos ligados e desligados é medido na área `public-cv-format`.

const FACT_KEYS = ["workModel", "experienceLevel", "availability", "startTimeframe", "openToRelocation", "area", "languages"];

export async function run(ctx) {
  const { BASE, check, page } = ctx;

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const card = page.locator('[data-testid="public-facts-card"]');
  const shape = await card.evaluate((node, keys) => ({
    fields: keys.filter((key) => node.querySelector(`[data-testid="public-fact-field-${key}"]`)),
    toggles: keys.filter((key) => node.querySelector(`[data-testid="public-fact-show-${key}"]`)),
  }), FACT_KEYS);
  check(
    "#327 /candidate: os sete fatos com o próprio \"mostrar no perfil público\"",
    shape.fields.length === 7 && shape.toggles.length === 7,
    JSON.stringify(shape),
  );

  // Estado original, para devolver no fim: um teste que deixa o perfil mais
  // exposto do que encontrou é pior que teste nenhum.
  const area = page.locator('[data-testid="public-fact-area"]');
  const showArea = page.locator('[data-testid="public-fact-show-area"]');
  const level = page.locator('[data-testid="public-fact-experienceLevel"]');
  const original = {
    area: await area.inputValue(),
    showArea: await showArea.isChecked(),
    level: await level.inputValue(),
  };

  try {
    // Acentuado de propósito: a mesma tela é varrida em inglês (G30).
    const typed = "Plataformas de dados e IA aplicada à decisão";
    await area.fill(typed);
    await showArea.check();
    await level.selectOption("staff");
    await page.locator('[data-testid="save-public-facts"]').click();
    await page.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({ state: "visible", timeout: 15_000 });

    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const saved = {
      area: await area.inputValue(),
      showArea: await showArea.isChecked(),
      level: await level.inputValue(),
    };
    check(
      "#327 /candidate: fato e opt-in salvos sobrevivem ao reload",
      saved.area === typed && saved.showArea && saved.level === "staff",
      JSON.stringify(saved),
    );

    // Recusa com a razão: e-mail no texto livre não é gravado.
    await area.fill("fale comigo: e2e-fatos@local.test");
    await page.locator('[data-testid="save-public-facts"]').click();
    const refusal = page.locator('[data-testid="mutation-feedback"][role="alert"]');
    await refusal.waitFor({ state: "visible", timeout: 15_000 });
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    check(
      "#327 /candidate: contato no texto livre é recusado e não substitui o valor salvo",
      (await area.inputValue()) === typed,
      await area.inputValue(),
    );
  } finally {
    // Devolve o estado original mesmo se uma verificação ou espera acima
    // lançar: recarrega a tela (o formulário pode estar no meio de uma
    // recusa) e grava os três valores que o teste mexeu.
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    await area.fill(original.area);
    if (original.showArea) await showArea.check();
    else await showArea.uncheck();
    await level.selectOption(original.level);
    await page.locator('[data-testid="save-public-facts"]').click();
    await page.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({ state: "visible", timeout: 15_000 });
  }
}
