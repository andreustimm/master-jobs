// Área `public-profile` do E2E de navegador: Portfólio público, sem sessão.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, browser, check, page } = ctx;
  /* ---------------------- Portfólio público, sem sessão -------------------- */

  // A única rota que responde sem sessão. Verificada de um contexto ANÔNIMO —
  // testá-la com o cookie de sessão presente provaria outra coisa.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();

  const privateHit = await anonPage.goto(`${BASE}/p/default`, { waitUntil: "domcontentloaded" });
  // 404 e não 403: 403 confirmaria que o slug existe, e existência é informação.
  check("perfil não público responde 404 para anônimo", privateHit?.status() === 404,
    `${privateHit?.status()}`);

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  const publicHref = await page.evaluate(
    () => document.querySelector('a[href^="/p/"]')?.getAttribute("href") ?? null,
  );

  if (publicHref) {
    const publicHit = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("perfil público responde a quem não tem sessão", publicHit?.status() === 200,
      `${publicHit?.status()}`);

    const shown = await anonPage.evaluate(() => ({
      body: document.body.textContent ?? "",
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    }));
    // O que a página MOSTRA se corrige depois; o que ela VAZA não tem desfazer.
    check("perfil público não expõe e-mail", !/@zorbit|@local\.test/.test(shown.body));
    // Sem o segundo consentimento o currículo não sai, nem o piso salarial que
    // ele costuma conter — que é a posição de negociação do candidato.
    check("sem o segundo consentimento o currículo não sai", !/SUMMARY|EXPERIENCE/i.test(shown.body));
    // Alcançável sem sessão não é o mesmo que "quero aparecer no Google".
    check("perfil público pede noindex", shown.robots.includes("noindex"), shown.robots);
  } else {
    check("a tela mostra o endereço público", false, "link ausente");
  }

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  if (publicHref) {
    const closed = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("voltar a privado fecha a porta na hora", closed?.status() === 404, `${closed?.status()}`);
  }
  await anon.close();
}
