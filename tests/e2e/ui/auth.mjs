// Área `auth` do E2E de navegador: Autenticação: nada responde sem sessão, e a sessão do dono nasce aqui.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, check, page } = ctx;
  // Fixa o idioma para o texto ser previsível. Onde o alvo é um controle e não
  // uma frase, o teste usa `data-testid`: buscar botão por texto num sistema
  // bilíngue é um teste que quebra quando alguém traduz uma palavra.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  /* ------------------------------ Autenticação ----------------------------- */

  // Antes de qualquer coisa: nada deve responder sem sessão.
  const anonymous = await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  check("página protegida redireciona para login", page.url().includes("/login"), page.url());
  void anonymous;

  const exportResponse = await page.request.get(`${BASE}/api/export`, { maxRedirects: 0 });
  // O export carrega o acervo inteiro em CSV; ele vazando é o pior caso.
  check(
    "API de export não responde sem sessão",
    exportResponse.status() >= 300 && exportResponse.status() < 400,
    String(exportResponse.status()),
  );

  await page.context().addCookies([
    { name: "jho_session", value: "cookie-forjado", url: BASE },
  ]);
  const forgedExport = await page.request.get(`${BASE}/api/export`, { maxRedirects: 0 });
  check(
    "API de export rejeita cookie forjado",
    forgedExport.status() >= 300 && forgedExport.status() < 400,
    String(forgedExport.status()),
  );
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check(
    "modal de novidades não aparece sem sessão",
    (await page.locator('[data-testid="changelog-open"]').count()) === 0,
  );
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', "senha-propositalmente-errada");
  await page.click('[data-testid="login-submit"]');
  await page.waitForTimeout(900);
  check("senha errada não entra", page.url().includes("/login"), page.url());
  check(
    "erro aparece na tela",
    (await page.locator("form").textContent())?.includes("incorretos") ?? false,
  );

  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('[data-testid="login-submit"]');
  await page.waitForTimeout(1400);
  check("senha correta entra", !page.url().includes("/login"), page.url());

  const sessionCookie = (await page.context().cookies()).find((c) => c.name === "jho_session");
  // A área `design` abre o WebKit com esta mesma sessão.
  ctx.state.sessionCookie = sessionCookie;
  // httpOnly é o que impede um XSS de ler a sessão.
  check("cookie de sessão é httpOnly", sessionCookie?.httpOnly === true);
  check("cookie de sessão é sameSite lax", (sessionCookie?.sameSite ?? "").toLowerCase() === "lax");

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}
