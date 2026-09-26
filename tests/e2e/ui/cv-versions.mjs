// Área `cv-versions` do E2E de navegador: Histórico de versões do CV e ações na tabela de versões (#312).
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

  /* ------------------ Ações na tabela de versões (#312) ------------------- */

  // Atalho ADICIONAL ao modal acima. O que a tabela promete e só o browser
  // prova: o usuário sabe o que o ícone faz antes de agir (tooltip no hover e
  // no foco, nome acessível, rótulo visível no toque), e nada com efeito
  // acontece sem um segundo gesto — Cancelar e Esc deixam tudo como estava.
  // As versões-alvo nascem em `setup.mjs`, só no banco isolado desta execução.
  // Bloco próprio: os nomes abaixo repetem os de outras seções do arquivo.
  {
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const tableRows = page.locator('[data-testid="version-table-row"]');
  const tableRow = (label) => tableRows.filter({ hasText: label }).first();
  const focusedTestId = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  const shellReady = () =>
    page.waitForFunction(() => {
      const shell = document.getElementById("application-shell");
      return !shell?.hasAttribute("inert") && !shell?.hasAttribute("aria-busy");
    });
  check("tabela de versões lista as versões", (await tableRows.count()) >= 3, `${await tableRows.count()} linha(s)`);
  check(
    "modal Histórico continua presente ao lado da tabela",
    (await page.locator('[data-testid="version-history-open"]').count()) === 1,
  );

  const currentActions = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="version-table-row"][data-current="true"]');
    return row
      ? [...row.querySelectorAll("button[data-testid^='version-table-']")].map((b) => b.getAttribute("data-testid"))
      : null;
  });
  check(
    "linha atual da tabela oferece só Ver e Renomear",
    JSON.stringify(currentActions) === JSON.stringify(["version-table-view", "version-table-rename"]),
    JSON.stringify(currentActions),
  );

  async function accessibleNames(expected) {
    const row = tableRow("E2E CV anterior (excluir)");
    const found = [];
    for (const name of expected) {
      found.push(await row.getByRole("button", { name, exact: true }).count());
    }
    return found;
  }
  const namesPt = await accessibleNames(["Ver", "Renomear", "Restaurar", "Excluir"]);
  check("ícones da tabela têm nome acessível em pt-BR", namesPt.every((n) => n === 1), JSON.stringify(namesPt));

  // Tooltip acima do ícone, no hover e no foco por teclado.
  const deleteIcon = tableRow("E2E CV anterior (excluir)").locator('[data-testid="version-table-delete"]');
  await deleteIcon.hover();
  const hoverTip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Excluir" });
  let hoverOk = false;
  let hoverDetail = "tooltip não abriu";
  try {
    await hoverTip.waitFor({ state: "visible", timeout: 3000 });
    // A entrada anima de baixo para cima (`slide-in-from-bottom-2`): medida no
    // meio da transição, a caixa ainda cobre o ícone. Mede depois de assentar,
    // como o teste dos chips.
    await page.waitForTimeout(350);
    const [tip, icon] = [await hoverTip.boundingBox(), await deleteIcon.boundingBox()];
    hoverDetail = JSON.stringify({ tip, icon });
    hoverOk = Boolean(tip && icon && tip.y + tip.height / 2 < icon.y + icon.height / 2 && tip.y + tip.height <= icon.y + 2);
  } catch {}
  check("tooltip nomeia a ação acima do ícone no hover", hoverOk, hoverDetail);

  await page.mouse.move(0, 0);
  await tableRow("E2E CV anterior (excluir)").locator('[data-testid="version-table-view"]').focus();
  await page.keyboard.press("Tab");
  let focusTipOk = false;
  try {
    await page
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "Renomear" })
      .waitFor({ state: "visible", timeout: 3000 });
    focusTipOk = (await focusedTestId()) === "version-table-rename";
  } catch {}
  check("tooltip nomeia a ação ao focar o ícone pelo teclado", focusTipOk);
  await page.keyboard.press("Escape");

  // Ver: modal próprio com o conteúdo, alternância, Esc e foco de volta.
  const viewIcon = tableRow("E2E CV anterior (excluir)").locator('[data-testid="version-table-view"]');
  await viewIcon.click();
  const viewDialog = page.locator('[data-testid="version-table-dialog"][open]');
  check("Ver pela tabela abre o modal da versão", (await viewDialog.count()) === 1);
  let viewedLength = 0;
  try {
    await page.locator('[data-testid="version-table-view-content"]').waitFor({ timeout: 5000 });
    viewedLength = ((await page.locator('[data-testid="version-table-view-content"]').textContent()) ?? "").trim().length;
  } catch {}
  check("modal da tabela mostra o conteúdo da versão", viewedLength > 50, `${viewedLength} caracteres`);
  const headerLabel = await viewDialog.locator("h2[data-user-content]").textContent();
  check("modal da tabela nomeia a versão", headerLabel === "E2E CV anterior (excluir)", String(headerLabel));
  await viewDialog.getByRole("button", { name: "Markdown", exact: true }).click();
  check(
    "modal da tabela alterna para Markdown",
    (await page.locator('[data-testid="version-table-view-content"] pre').count()) === 1,
  );
  await page.keyboard.press("Escape");
  check("modal da tabela fecha com Escape", (await viewDialog.count()) === 0);
  const viewFocus = await page.evaluate(() => ({
    id: document.activeElement?.getAttribute("data-testid"),
    row: document.activeElement?.closest("[data-testid='version-table-row']")?.textContent ?? "",
  }));
  check(
    "fechar o modal devolve o foco ao ícone Ver",
    viewFocus.id === "version-table-view" && viewFocus.row.includes("E2E CV anterior (excluir)"),
    JSON.stringify(viewFocus),
  );

  // Excluir: Cancelar e Esc não mudam nada; Confirmar exclui e sobrevive a refresh.
  const rowsBefore = await tableRows.count();
  await deleteIcon.click();
  const confirmPanel = page.locator('[data-testid="version-table-confirm-panel"]');
  const confirmText = (await confirmPanel.textContent()) ?? "";
  check(
    "confirmação de excluir nomeia a versão e foca Cancelar",
    confirmText.includes("E2E CV anterior (excluir)") && (await focusedTestId()) === "version-table-cancel",
    `${confirmText} | foco=${await focusedTestId()}`,
  );
  await page.locator('[data-testid="version-table-cancel"]').click();
  check(
    "Cancelar excluir não altera nada e devolve o foco",
    (await confirmPanel.count()) === 0 && (await tableRows.count()) === rowsBefore &&
      (await focusedTestId()) === "version-table-delete",
  );
  await deleteIcon.click();
  await page.keyboard.press("Escape");
  check(
    "Esc cancela a exclusão",
    (await confirmPanel.count()) === 0 && (await tableRows.count()) === rowsBefore,
  );
  await deleteIcon.click();
  await page.locator('[data-testid="version-table-confirm"]').click();
  let deleted = false;
  try {
    await page.waitForFunction(
      (label) => ![...document.querySelectorAll('[data-testid="version-table-row"]')].some((r) => r.textContent?.includes(label)),
      "E2E CV anterior (excluir)",
      { timeout: 15_000 },
    );
    await page.reload({ waitUntil: "networkidle" });
    deleted = (await tableRow("E2E CV anterior (excluir)").count()) === 0 && (await tableRows.count()) === rowsBefore - 1;
  } catch {}
  check("Confirmar exclui pela tabela e sobrevive a refresh", deleted);

  // Restaurar: Cancelar não cria versão; Confirmar cria a nova atual.
  await shellReady();
  const restoreIcon = tableRow("E2E CV anterior (restaurar)").locator('[data-testid="version-table-restore"]');
  const rowsBeforeRestore = await tableRows.count();
  await restoreIcon.click();
  check("confirmação de restaurar foca Cancelar", (await focusedTestId()) === "version-table-cancel");
  await page.locator('[data-testid="version-table-cancel"]').click();
  check("Cancelar restaurar não cria versão", (await tableRows.count()) === rowsBeforeRestore);
  await restoreIcon.click();
  await page.locator('[data-testid="version-table-confirm"]').click();
  let restored = false;
  try {
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="version-table-row"]').length === count,
      rowsBeforeRestore + 1,
      { timeout: 15_000 },
    );
    await page.reload({ waitUntil: "networkidle" });
    const current = (await page.locator('[data-testid="version-table-row"][data-current="true"]').textContent()) ?? "";
    restored = current.includes("E2E CV anterior (restaurar) (restaurada)");
  } catch {}
  check("Confirmar restaura pela tabela e sobrevive a refresh", restored);

  // Renomear: Esc descarta; Salvar grava.
  await shellReady();
  // A linha original, não a cópia restaurada que virou a atual.
  const renameRow = page.locator('[data-testid="version-table-row"]:not([data-current="true"])').filter({ hasText: "E2E CV anterior (restaurar)" }).first();
  await renameRow.locator('[data-testid="version-table-rename"]').click();
  const renameField = page.locator('[data-testid="version-table-rename-field"]');
  await renameField.fill("E2E rótulo descartado");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  check(
    "Esc no renomear não grava",
    (await renameField.count()) === 0 && (await tableRow("E2E rótulo descartado").count()) === 0,
  );
  await renameRow.locator('[data-testid="version-table-rename"]').click();
  await renameField.fill("E2E CV renomeada pela tabela");
  await page.locator('[data-testid="version-table-rename-save"]').click();
  let renamed = false;
  let renameFocus = null;
  try {
    await tableRow("E2E CV renomeada pela tabela").waitFor({ timeout: 15_000 });
    await page
      .waitForFunction(
        () => document.activeElement?.getAttribute("data-testid") === "version-table-rename",
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    renameFocus = await focusedTestId();
    await page.reload({ waitUntil: "networkidle" });
    renamed = (await tableRow("E2E CV renomeada pela tabela").count()) === 1;
  } catch {}
  check("Salvar renomeia pela tabela e sobrevive a refresh", renamed);
  check("após renomear o foco volta ao ícone Renomear", renameFocus === "version-table-rename", String(renameFocus));

  // 375px: alvo de toque, rótulo visível no lugar do tooltip, sem rolagem lateral.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: "networkidle" });
  const mobileActions = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid='version-table-row'] button[data-testid^='version-table-']")].map((b) => {
      const r = b.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: (b.textContent ?? "").trim(), name: b.getAttribute("aria-label") };
    }),
  );
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(
    "ações da tabela em 375px: alvo ≥ 44px, rótulo visível e sem rolagem lateral",
    mobileActions.length > 0 && mobileOverflow <= 0 &&
      mobileActions.every((a) => a.w >= 44 && a.h >= 44 && a.text === a.name),
    `overflow=${mobileOverflow} ${JSON.stringify(mobileActions.slice(0, 4))}`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });

  // Nome acessível no outro idioma.
  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  await page.reload({ waitUntil: "networkidle" });
  const namesEn = [];
  const enRow = page.locator('[data-testid="version-table-row"]:not([data-current="true"])').first();
  for (const name of ["View", "Rename", "Restore", "Delete"]) {
    namesEn.push(await enRow.getByRole("button", { name, exact: true }).count());
  }
  check("ícones da tabela têm nome acessível em inglês", namesEn.every((n) => n === 1), JSON.stringify(namesEn));
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  }


  // Volta ao padrão para não deixar o cookie sujo para a próxima execução.
  await page.context().addCookies([
    { name: "jho_theme", value: "hp", url: BASE },
    { name: "jho_mode", value: "system", url: BASE },
  ]);
}
