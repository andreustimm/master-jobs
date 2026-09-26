// Área `visibility` do E2E de navegador: Visibilidade do perfil do candidato.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, check, page } = ctx;
  /* ------------------- Visibilidade do perfil do candidato ----------------- */

  // A escolha que decide se um currículo é legível pela internet inteira. O
  // teste vai e volta para não deixar o perfil exposto se falhar no meio.
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const visibility = await page.evaluate(() => ({
    options: [...document.querySelectorAll('input[name="visibility"]')].map((i) => i.value),
    checked: document.querySelector('input[name="visibility"]:checked')?.value ?? null,
    warned: /legível por qualquer um/.test(document.body.textContent ?? ""),
  }));
  check(
    "candidato escolhe quem vê o perfil",
    visibility.options.join(",") === "private,recruiters,public",
    visibility.options.join(","),
  );
  // "Público" soa inofensivo; o que ele significa não. O aviso fica sempre
  // visível, inclusive para quem JÁ está público — que é quem mais precisa lê-lo.
  check("o que 'público' significa está escrito na tela", visibility.warned);

  const original = visibility.checked ?? "private";
  // A área `rate-limit` publica o perfil de novo e devolve a este estado.
  ctx.state.visibilityOriginal = original;
  await page.check('input[name="visibility"][value="recruiters"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.locator('[data-testid="mutation-feedback"][role="status"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
  check(
    "mutação de perfil anuncia sucesso com o feedback global",
    (await page.locator('[data-testid="mutation-feedback"][role="status"]').count()) === 1,
  );
  await page.waitForTimeout(5_200);
  check(
    "feedback global desaparece sozinho depois de cinco segundos",
    (await page.locator('[data-testid="mutation-feedback"]').count()) === 0,
  );
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const saved = await page.evaluate(
    () => document.querySelector('input[name="visibility"]:checked')?.value ?? null,
  );
  check("a escolha persiste", saved === "recruiters", `${saved}`);

  // Devolve ao estado anterior: um teste que deixa o perfil mais exposto do que
  // encontrou é pior que teste nenhum.
  await page.check(`input[name="visibility"][value="${original}"]`);
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
}
