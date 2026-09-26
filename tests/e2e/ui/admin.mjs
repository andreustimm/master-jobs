// Área `admin` do E2E de navegador: Administração e impersonação.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, changelogRoleSnapshots, changelogSnapshot, check, consoleErrors, page, readModalSpacing } = ctx;
  /* -------------------- Administração e impersonação ----------------------- */

  // O ciclo inteiro de assumir identidade, porque cada peça dele pode passar
  // isolada e a combinação falhar. Foi o que aconteceu: o campo
  // `impersonated_by` não estava no INSERT, então a sessão emprestada era
  // indistinguível de uma normal — sem banner, com o menu de administração
  // intacto e com poder de admin. A política estava certa; o dado que ela lê
  // nunca chegava.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const adminPage = await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  check("admin alcança a administração de contas", adminPage?.status() === 200);

  const accountRows = await page.locator("li").count();
  check("administração lista as contas", accountRows > 0, `${accountRows} conta(s)`);

  const adminDeleteSnapshots = [];
  for (const width of [375, 812]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 375 });
    await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    const buttons = await page.locator('[data-testid="user-delete-open"]').evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { height: rect.height, right: rect.right, viewport: innerWidth };
      }),
    );
    adminDeleteSnapshots.push({ width, buttons });
  }
  check(
    "ação excluir administrativa mantém alvo e largura no mobile retrato e paisagem",
    adminDeleteSnapshots.every(({ buttons }) =>
      buttons.length > 0 && buttons.every(({ height, right, viewport }) => height >= 44 && right <= viewport + 1),
    ),
    JSON.stringify(adminDeleteSnapshots),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });

  // Conta-alvo dedicada, criada pelo setup. Antes era "a primeira que não é a
  // de teste", e numa base recém-criada não havia nenhuma — a verificação
  // passava por falta de alvo em vez de por funcionar.
  const target = page.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
  const assume = target.locator('[data-testid="impersonate-user"]').first();

  const editTrigger = target.locator('[data-testid="user-edit-open"]').first();
  const editId = await editTrigger.getAttribute("popovertarget");
  check("conta-alvo oferece edição", Boolean(editId));

  if (editId) {
    const editModal = page.locator(`#${editId}`);
    async function readEditValues(modal) {
      return {
        fullName: await modal.locator('input[name="fullName"]').inputValue(),
        email: await modal.locator('input[name="email"]').inputValue(),
        roles: await modal.locator('input[name="roles"]:checked').evaluateAll(
          (roles) => roles.map((role) => role.value),
        ),
      };
    }

    async function delayNextEditAction() {
      const seenGate = Promise.withResolvers();
      const releaseGate = Promise.withResolvers();
      let waiting = true;
      const handler = async (route) => {
        const request = route.request();
        if (
          waiting &&
          request.method() === "POST" &&
          request.headers()["next-action"]
        ) {
          waiting = false;
          seenGate.resolve();
          await releaseGate.promise;
        }
        await route.continue();
      };
      await page.route("**/admin/users", handler);
      return {
        seen: seenGate.promise,
        release: releaseGate.resolve,
        stop: () => page.unroute("**/admin/users", handler),
      };
    }

    const adminModalSpacing = [];
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await editTrigger.click();
      const spacing = await readModalSpacing(editModal);
      adminModalSpacing.push({ width, ...spacing });
      await editModal.locator('[data-testid="user-edit-close"]').click();
    }
    check(
      "modal de usuário respeita topo e padding no desktop e no mobile",
      adminModalSpacing.every(
        ({
          top,
          bottom,
          left,
          right,
          viewportWidth,
          viewportHeight,
          headerPaddingTop,
          headerPaddingBottom,
        }) =>
          top >= 16 &&
          bottom <= viewportHeight - 16 &&
          left >= 0 &&
          right <= viewportWidth &&
          headerPaddingTop === "24px" &&
          headerPaddingBottom === "24px",
      ),
      JSON.stringify(adminModalSpacing),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    await editTrigger.click();
    const originalEditValues = await readEditValues(editModal);
    await editModal.locator('input[name="fullName"]').fill("Alteração abandonada");
    await editModal.locator('input[name="email"]').fill("abandonada@local.test");
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.setChecked(!(await role.isChecked()), { force: true });
    }
    await editModal.locator('[data-testid="user-edit-cancel"]').click();
    await editTrigger.click();
    const reopenedEditValues = await readEditValues(editModal);
    check(
      "fechar sem salvar restaura todos os campos",
      JSON.stringify(reopenedEditValues) === JSON.stringify(originalEditValues),
      JSON.stringify({ originalEditValues, reopenedEditValues }),
    );

    const delayedSave = await delayNextEditAction();
    await editModal.locator('input[name="fullName"]').fill("E2E Alvo atualizado");
    const delayedSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await delayedSave.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    await editModal.locator('input[name="fullName"]').fill("Rascunho depois de reabrir");
    delayedSave.release();
    await delayedSubmitClick;
    await page.locator('[data-testid="user-edit-notice"][role="status"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await delayedSave.stop();

    check(
      "salvamento anterior não fecha uma nova abertura da modal",
      (await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await editModal.locator('input[name="fullName"]').inputValue()) ===
          "Rascunho depois de reabrir",
    );
    check(
      "salvamento concluído depois de fechar ainda anuncia o sucesso",
      (await page.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
    );
    await page.waitForTimeout(5_200);
    check(
      "notificação de sucesso desaparece sozinha depois de cinco segundos",
      (await page.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 0,
    );
    await editModal.locator('[data-testid="user-edit-cancel"]').click();

    const secondTarget = page.locator("li").filter({ hasText: "e2e-candidato@local.test" }).first();
    const secondTrigger = secondTarget.locator('[data-testid="user-edit-open"]').first();
    const secondId = await secondTrigger.getAttribute("popovertarget");
    check("segunda conta oferece edição", Boolean(secondId));
    if (secondId) {
      const secondModal = page.locator(`#${secondId}`);
      await secondTrigger.click();
      await secondModal.locator('input[name="fullName"]').fill("E2E Candidato atualizado");
      await secondModal.locator('[data-testid="user-edit-submit"]').click();
      await page.waitForFunction(
        (id) => !document.getElementById(id)?.matches(":popover-open"),
        secondId,
        { timeout: 15_000 },
      ).catch(() => {});
      check(
        "editar usuário fecha a modal depois do sucesso",
        !(await secondModal.evaluate((element) => element.matches(":popover-open"))),
      );
      check(
        "segunda edição substitui a confirmação anterior",
        (await target.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 0 &&
          (await secondTarget.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
      );
      await secondTarget.locator('[data-testid="user-edit-notice-dismiss"]').click();
      check(
        "notificação de sucesso pode ser fechada",
        (await page.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 0,
      );
    }

    await page.reload({ waitUntil: "networkidle" });
    check(
      "editar usuário persiste o valor depois de recarregar",
      (await target.locator('[data-user-content]').filter({ hasText: "E2E Alvo atualizado" }).count()) >= 1,
    );

    if (await editModal.evaluate((element) => element.matches(":popover-open"))) {
      await editModal.locator('[data-testid="user-edit-close"]').click();
    }

    await editTrigger.click();
    const closedSaveErrorsBefore = consoleErrors.length;
    const closedSave = await delayNextEditAction();
    await editModal.locator('input[name="fullName"]').fill("E2E Alvo salvo fechado");
    const closedSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await closedSave.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    closedSave.release();
    await closedSubmitClick;
    await target.locator('[data-testid="user-edit-notice"][role="status"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await closedSave.stop();
    check(
      "salvamento concluído com a modal fechada anuncia sem reabri-la",
      !(await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await target.locator('[data-testid="user-edit-notice"][role="status"]').count()) === 1,
    );
    check(
      "salvamento concluído com a modal fechada não causa erro no cliente",
      consoleErrors.length === closedSaveErrorsBefore,
      consoleErrors.slice(closedSaveErrorsBefore).join(" | "),
    );

    await editTrigger.click();
    check(
      "reabrir depois do salvamento fechado mostra o valor persistido",
      (await editModal.locator('input[name="fullName"]').inputValue()) ===
        "E2E Alvo salvo fechado",
    );
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const staleError = await delayNextEditAction();
    const staleErrorSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await staleError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    staleError.release();
    await staleErrorSubmitClick;
    await page.waitForFunction(
      (id) => !document.querySelector(`#${id} [data-testid="user-edit-submit"]`)?.disabled,
      editId,
      { timeout: 15_000 },
    );
    await staleError.stop();
    check(
      "erro de uma abertura anterior não aparece na nova modal",
      (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );

    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const closedError = await delayNextEditAction();
    const closedErrorSubmitClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await closedError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    closedError.release();
    await closedErrorSubmitClick;
    await target.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await closedError.stop();
    check(
      "erro concluído com a modal fechada aparece como notificação",
      !(await editModal.evaluate((element) => element.matches(":popover-open"))) &&
        (await target.locator('[data-testid="user-edit-notice"][role="alert"]').textContent())
          ?.includes("Escolha ao menos um papel."),
    );
    await target.locator('[data-testid="user-edit-notice-dismiss"]').click();
    check(
      "notificação de erro pode ser fechada",
      (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0,
    );

    await editTrigger.click();
    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    const clearedClosedError = await delayNextEditAction();
    const clearedClosedErrorClick = editModal.locator('[data-testid="user-edit-submit"]').click();
    await clearedClosedError.seen;
    await editModal.locator('[data-testid="user-edit-close"]').click();
    clearedClosedError.release();
    await clearedClosedErrorClick;
    await target.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await clearedClosedError.stop();
    await editTrigger.click();
    await page.locator('[data-testid="user-edit-notice"][role="alert"]').waitFor({
      state: "detached",
      timeout: 15_000,
    });
    check(
      "reabrir a modal limpa a notificação de erro anterior",
      (await page.locator('[data-testid="user-edit-notice"][role="alert"]').count()) === 0 &&
        (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );

    for (const role of await editModal.locator('input[name="roles"]').all()) {
      await role.uncheck({ force: true });
    }
    await editModal.locator('[data-testid="user-edit-submit"]').click();
    await editModal.locator('[role="alert"]').waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});

    check(
      "erro de edição mantém a modal aberta",
      await editModal.evaluate((element) => element.matches(":popover-open")),
    );
    check(
      "erro de edição é anunciado dentro da modal",
      (await editModal.locator('[role="alert"]').count()) === 1,
    );
    check(
      "erro de edição usa a mensagem localizada esperada",
      (await editModal.locator('[role="alert"]').textContent())?.trim() === "Escolha ao menos um papel.",
    );
    check(
      "erro de edição preserva os campos inválidos",
      (await editModal.locator('input[name="roles"]:checked').count()) === 0,
    );

    await editModal.locator('[data-testid="user-edit-close"]').click();
    await editTrigger.click();
    check(
      "reabrir depois de erro inline limpa alerta e restaura o cadastro",
      (await editModal.locator('[role="alert"]').count()) === 0 &&
        (await editModal.locator('input[name="fullName"]').inputValue()) ===
          "E2E Alvo salvo fechado" &&
        (await editModal.locator('input[name="roles"]:checked').count()) > 0,
    );
    await editModal.locator('[data-testid="user-edit-close"]').click();

  }

  if ((await assume.count()) > 0) {
    await assume.click();
    // Espera pelo RESULTADO, não por `networkidle`: uma Server Action com
    // redirect termina depois que a rede sossega, e a verificação corria antes
    // da página nova existir.
    await page.waitForSelector('[data-testid="stop-impersonating"]', { timeout: 15_000 })
      .catch(() => {});

    const borrowed = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sessão emprestada mostra o aviso", borrowed.banner);
    // Operar como outra pessoa sem perceber é como se escreve no dado errado.
    check("sessão emprestada esconde o menu de administração", borrowed.adminLink === false);

    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    changelogRoleSnapshots.push({
      role: "impersonado",
      snapshot: await changelogSnapshot(page),
    });

    const denied = await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
    // 403 e não 500: negação que parece crash mostra stack em desenvolvimento e
    // não distingue "não pode" de "quebrou".
    check("sessão emprestada recebe 403 na administração", denied?.status() === 403,
      `${denied?.status()}`);

    // A conta do alvo abre para leitura, sem formulário nenhum: trocar senha,
    // e-mail ou nome de outra pessoa com a cara dela é tomar a conta.
    const borrowedAccount = await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    const borrowedForms = await page.locator('[data-testid="route-account"] form').count();
    const borrowedNote = await page.locator('[data-testid="account-borrowed"]').count();
    check(
      "sessão emprestada vê Minha conta sem formulário de senha nem de nome",
      borrowedAccount?.status() === 200 && borrowedForms === 0 && borrowedNote === 1,
      JSON.stringify({ status: borrowedAccount?.status(), borrowedForms, borrowedNote }),
    );

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.click('[data-testid="stop-impersonating"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="stop-impersonating"]'),
      { timeout: 15_000 },
    ).catch(() => {});

    const restored = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sair devolve o admin à própria sessão", !restored.banner && restored.adminLink);

    const roleReference = JSON.stringify(changelogRoleSnapshots[0]?.snapshot ?? null);
    const roleDrift = changelogRoleSnapshots.filter(
      ({ snapshot }) => JSON.stringify(snapshot) !== roleReference,
    );
    check(
      "E2E-023 conteúdo e disclosures são equivalentes entre papéis",
      changelogRoleSnapshots.length === 4 && roleDrift.length === 0 &&
        !roleReference.includes("@local.test"),
      `${changelogRoleSnapshots.map(({ role }) => role).join(", ")} · drift=${roleDrift.length}`,
    );
  } else {
    check("há uma conta para assumir", false, "nenhuma conta além da de teste");
  }
}
