// Área `recheck` do E2E de navegador: Reconferência de disponibilidade: botão e enfileiramento.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  /* -------------------- Reconferência: botão e enfileiramento -------------- */

  // Vaga não é permanente, e a sincronização não descobre isso sozinha: várias
  // fontes seguem listando anúncio morto. Medido ao ligar esta fila: 16% dos
  // links do Lever entre os melhores ranqueados devolviam 404.
  //
  // O que só o browser responde é se o clique enfileira de verdade e se o botão
  // passa a dizer isso. As regras de classificação (só 404/410 fecham) estão em
  // `tests/verify-queue.test.ts`, onde não precisam de rede.
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const recheckModalId = await page.evaluate(() => {
    for (const trigger of document.querySelectorAll("button[popovertarget^='job-modal']")) {
      const id = trigger.getAttribute("popovertarget");
      if (id && document.getElementById(id)?.querySelector('[data-testid="recheck-job"]')) {
        return id;
      }
    }
    return null;
  });
  if (recheckModalId) {
    await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
  }
  await page.waitForTimeout(300);

  const recheckBefore = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  check("botão de reconferir presente no detalhe", recheckBefore.label !== null, `${recheckBefore.label}`);

  if (recheckBefore.label && !recheckBefore.disabled) {
    await page.locator('[id^="job-modal"]:popover-open [data-testid="recheck-job"]').click();
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    if (recheckModalId) {
      await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
    }
    await page.waitForTimeout(300);
  }

  const recheckAfter = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  // Enfileirado, o botão desabilita: clicar de novo só duplicaria trabalho
  // contra site de terceiro, que é como se toma bloqueio.
  check(
    "reconferir enfileira e desabilita o botão",
    recheckAfter.disabled === true,
    `${recheckAfter.label}`,
  );
}
