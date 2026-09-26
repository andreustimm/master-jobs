// Área `cv-versions` do E2E de navegador: Histórico de versões do CV.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  /* ---------------------- Histórico de versões do CV ----------------------- */

  // As regras (não excluir a atual, não excluir versão citada pelo funil,
  // restaurar acrescentando) estão travadas em `tests/candidate-versions.test.ts`,
  // onde é barato exercitá-las. O que só o browser responde é se o modal abre,
  // prende o foco, fecha no Escape — e se o botão destrutivo simplesmente NÃO
  // existe na linha da versão atual, que é a defesa que o usuário enxerga.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const historyTrigger = page.locator('[data-testid="version-history-open"]').first();
  check("botão de histórico presente", (await historyTrigger.count()) > 0);

  if ((await historyTrigger.count()) > 0) {
    await historyTrigger.click();
    const dialog = page.locator("dialog[open]");
    check("modal de versões abre", (await dialog.count()) === 1);

    // `<dialog>` nativo move o foco para dentro ao abrir com `showModal()`.
    const focusInside = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      return Boolean(d && d.contains(document.activeElement));
    });
    check("modal prende o foco", focusInside);

    const rows = dialog.locator("li");
    const rowCount = await rows.count();
    check("modal lista as versões", rowCount > 0, `${rowCount} versão(ões)`);

    await page.setViewportSize({ width: 375, height: 812 });
    const deleteButton = dialog.locator('[data-testid="version-delete"]').first();
    const deleteBox = await deleteButton.boundingBox();
    check(
      "ação excluir mantém alvo de toque confortável no celular",
      Boolean(deleteBox) && deleteBox.height >= 44,
      deleteBox ? `${Math.round(deleteBox.width)}x${Math.round(deleteBox.height)}` : "não encontrada",
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // A linha da versão atual não pode oferecer excluir nem restaurar.
    const currentRow = rows.filter({ hasText: "atual" }).first();
    if ((await currentRow.count()) > 0) {
      const destructive = await currentRow.locator('[data-testid="version-delete"]').count();
      const restore = await currentRow.locator('[data-testid="version-restore"]').count();
      check("versão atual não oferece excluir nem restaurar", destructive === 0 && restore === 0);
    }

    // Visualizar carrega o conteúdo pela ação de servidor.
    await rows.first().locator('[data-testid="version-view-action"]').first().click();
    // `data-testid` e não um seletor por atributo genérico: `data-user-content`
    // também marca o rótulo da versão, e a primeira medição pegou os 40
    // caracteres do rótulo achando que era o documento.
    await page.waitForSelector('[data-testid="version-view"]', { timeout: 5000 });
    const viewed = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="version-view"]');
      return (panel?.textContent ?? "").trim().length;
    });
    check("visualizar mostra o conteúdo da versão", viewed > 50, `${viewed} caracteres`);

    await page.keyboard.press("Escape");
    check("modal fecha com Escape", (await page.locator("dialog[open]").count()) === 0);
  }


  // Volta ao padrão para não deixar o cookie sujo para a próxima execução.
  await page.context().addCookies([
    { name: "jho_theme", value: "hp", url: BASE },
    { name: "jho_mode", value: "system", url: BASE },
  ]);
}
