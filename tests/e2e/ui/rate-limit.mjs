// Área `rate-limit` do E2E de navegador: Limite de requisição no portfólio (E-05).
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, browser, check, page } = ctx;
  /* ------------- Limite de requisição no portfólio (E-05, jornada) --------- */

  // T5 e T10 do contrato em
  // `.compozy/tasks/_archived/1787413356948-b5a25d70-perfil-publico-limite/_tests.md`.
  //
  // Um IP exclusivo isola esta prova das demais jornadas. O primeiro acesso
  // retorna 200; os 29 seguintes retornam 404. Juntos eles esgotam exatamente
  // o limite de 30, então a requisição seguinte só pode retornar 429 se 200 e
  // 404 realmente consumirem o mesmo balde.
  let burstCtx = null;
  // O estado que a área `visibility` encontrou; rodando sem ela, o que está na
  // tela antes de publicar.
  let original = ctx.state.visibilityOriginal;
  try {
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    original ??= await page.evaluate(
      () => document.querySelector('input[name="visibility"]:checked')?.value ?? "private",
    );
    await page.check('input[name="visibility"][value="public"]');
    const publishResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && response.request().headers()["next-action"] !== undefined,
    );
    await page.locator('[data-testid="save-visibility"]').click();
    await publishResponse;

    const rateLimitPublicLink = page.locator('a[href^="/p/"]').first();
    await rateLimitPublicLink.waitFor({ state: "visible", timeout: 5000 });
    const rateLimitPublicHref = await rateLimitPublicLink.getAttribute("href");

    const nonce = crypto.randomUUID().replaceAll("-", "");
    const rateLimitClient = `2001:db8:${nonce.slice(0, 4)}:${nonce.slice(4, 8)}:${nonce.slice(8, 12)}:${nonce.slice(12, 16)}::`;
    burstCtx = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": rateLimitClient },
    });
    const burstPage = await burstCtx.newPage();

    let first = null;
    let blocked = null;
    const missingStatuses = [];
    if (rateLimitPublicHref) {
      first = await burstPage.goto(`${BASE}${rateLimitPublicHref}`, {
        waitUntil: "domcontentloaded",
      });
      for (let i = 0; i < 29; i++) {
        const hit = await burstPage.goto(`${BASE}/p/varredura-${nonce}-${i}`, {
          waitUntil: "domcontentloaded",
        });
        missingStatuses.push(hit?.status());
      }
      blocked = await burstPage.goto(`${BASE}/p/varredura-${nonce}-bloqueada`, {
        waitUntil: "domcontentloaded",
      });
    }
    check("acesso isolado ao portfólio não é barrado", first?.status() === 200, `${first?.status()}`);
    check(
      "T5 · respostas 200 e 404 consomem o mesmo balde",
      missingStatuses.length === 29
        && missingStatuses.every((status) => status === 404)
        && blocked?.status() === 429,
      `200=${first?.status()} · 404=${missingStatuses.join(",")} · final=${blocked?.status()}`,
    );
    check("rajada no portfólio é recusada com 429", blocked?.status() === 429);
    check(
      "a recusa diz quando voltar",
      Number(blocked?.headers()["retry-after"] ?? 0) > 0,
      `retry-after=${blocked?.headers()["retry-after"]}`,
    );
  } finally {
    await burstCtx?.close();

    // A restauração fica no `finally`: falha de rede durante a rajada não pode
    // deixar mais público o perfil que o teste encontrou. Sem saber o que
    // encontrou, o menos exposto.
    original ??= "private";
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    await page.check(`input[name="visibility"][value="${original}"]`);
    const restoreResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && response.request().headers()["next-action"] !== undefined,
    );
    await page.locator('[data-testid="save-visibility"]').click();
    await restoreResponse;
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const restoredAfterLimit = await page
      .locator(`input[name="visibility"][value="${original}"]`)
      .isChecked();
    check("prova do limite restaura a visibilidade original", restoredAfterLimit, `${original}`);
  }
}
