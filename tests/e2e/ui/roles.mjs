// Área `roles` do E2E de navegador: Cenários por papel, ponta a ponta (E-06).
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, changelogRoleSnapshots, changelogSnapshot, check, trackConsole } = ctx;
  /* ------------------- Cenários por papel, ponta a ponta (E-06) ------------ */

  // A matriz de PERMISSÃO já está coberta em teste puro — `auth-policy` afirma
  // papel × ação × posse × visibilidade sem banco nem browser, e reproduzir isso
  // aqui seria testar a mesma função através de seis camadas de framework.
  //
  // O que só o browser responde é a COMPOSIÇÃO: o que cada papel alcança depois
  // de entrar de verdade. E foi aqui que apareceu o defeito — um recrutador
  // entrava com a senha certa e recebia 403 em toda tela, porque
  // `passwordLoginAction` mandava todo mundo para `/` e `/` exige escopo de
  // candidato. Cada metade estava correta sozinha.
  const ROLE_SCENARIOS = [
    {
      role: "recrutador",
      email: "e2e-recrutador@local.test",
      lands: "/jobs",
      allowed: ["/jobs", "/jobs/new", "/account"],
      // Sem escopo de candidato: currículo, funil e cockpit são de outra pessoa.
      denied: ["/candidate", "/pipeline", "/admin/users"],
    },
    {
      role: "candidato",
      email: "e2e-candidato@local.test",
      lands: "/",
      allowed: ["/", "/jobs", "/candidate", "/pipeline", "/jobs/new", "/account"],
      // Candidato puro não administra contas.
      denied: ["/admin/users"],
    },
  ];

  for (const scenario of ROLE_SCENARIOS) {
    const roleCtx = await browser.newContext();
    const rolePage = await roleCtx.newPage();
    trackConsole(rolePage);
    await roleCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

    await rolePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await rolePage.fill('input[name="email"]', scenario.email);
    await rolePage.fill('input[name="password"]', E2E_PASSWORD);
    await rolePage.locator('[data-testid="login-submit"]').click();
    await rolePage.waitForTimeout(2000);

    const landed = rolePage.url().replace(BASE, "") || "/";
    check(
      `${scenario.role} entra e cai numa tela que é dele`,
      landed === scenario.lands,
      `caiu em ${landed}, esperado ${scenario.lands}`,
    );

    if (scenario.role === "recrutador") {
      // A board is global for a recruiter. The default 45+ cut belongs to a
      // candidate score and must not turn the recruiter's unscoped board into
      // an empty result when every score column is intentionally null.
      await rolePage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
      const visibleJobs = await rolePage.locator('[data-testid^="job-link-"]').count();
      check(
        "recrutador vê vagas no acervo global",
        visibleJobs > 0,
        `a tela de vagas exibiu ${visibleJobs} linhas`,
      );

      const firstJobHref = await rolePage.locator('[data-testid^="job-link-"]').first().getAttribute("href");
      const detailResponse = await rolePage.goto(`${BASE}${firstJobHref}`, { waitUntil: "networkidle" });
      check(
        "recrutador abre o detalhe global sem funil privado",
        detailResponse?.status() === 200 && (await rolePage.locator('[data-testid="route-job-detail"]').count()) === 1,
        `${detailResponse?.status()} em ${rolePage.url().replace(BASE, "")}`,
      );
      check(
        "detalhe global não oferece mutação de candidatura ao recrutador",
        (await rolePage.locator('input[name="jobId"]').count()) === 0,
        "formulário de funil presente",
      );
      await rolePage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
      const downloadPromise = rolePage.waitForEvent("download");
      await rolePage.locator('a[download]').click();
      const exportDownload = await downloadPromise;
      check(
        "recrutador exporta o acervo global",
        exportDownload.suggestedFilename().startsWith("vagas-"),
        exportDownload.suggestedFilename(),
      );

      // F-07 E2E-002 — o escopo do recrutador vem do vínculo, e o endereço não
      // o alarga. A fixture não cria vínculo nenhum para esta conta, então a
      // área existe, explica o vazio, e qualquer id na URL responde 404 — o
      // mesmo 404 de um candidato que não existe, para não contar quem existe.
      const scopeFailures = [];
      const followed = await rolePage.goto(`${BASE}/recruiter`, { waitUntil: "networkidle" });
      if (followed?.status() !== 200) scopeFailures.push(`/recruiter deu ${followed?.status()}`);
      if ((await rolePage.locator('[data-testid="recruiter-empty"]').count()) !== 1) {
        scopeFailures.push("sem vínculo, a área não explica o vazio");
      }
      if ((await rolePage.locator('[data-testid^="recruiter-candidate-"]').count()) !== 0) {
        scopeFailures.push("lista trouxe candidato sem vínculo");
      }

      // Requisição direta, e não navegação: o que se mede aqui é o STATUS, e
      // um 404 navegado entra no coletor de erros de console da E2E-025 como
      // se a aplicação tivesse quebrado. O contexto é o mesmo, então a sessão
      // do recrutador vai junto — é ela que está sendo testada.
      // As sondas de 404 navegam num contexto PRÓPRIO, com sessão própria. Num
      // 404 o navegador registra "Failed to load resource" no console, e a
      // E2E-025 coleta o console de `rolePage` para a suíte inteira: sondar
      // ali reprovaria aquela verificação com um 404 que este teste pediu.
      // Requisição direta também não serve — ela não leva o cookie de sessão e
      // o proxy devolve 307, que mede o login e não o escopo.
      const probeCtx = await browser.newContext();
      const probePage = await probeCtx.newPage();
      await probeCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
      await probePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await probePage.fill('input[name="email"]', scenario.email);
      await probePage.fill('input[name="password"]', E2E_PASSWORD);
      await probePage.locator('[data-testid="login-submit"]').click();
      await probePage.waitForTimeout(2000);

      for (const probe of ["1", "999999", "abc"]) {
        const denied = await probePage.goto(`${BASE}/recruiter/${probe}`, {
          waitUntil: "networkidle",
        });
        if (denied?.status() !== 404) {
          scopeFailures.push(`/recruiter/${probe} respondeu ${denied?.status()}, esperado 404`);
        }
      }
      await probeCtx.close();

      check(
        "F-07 E2E-002 recrutador sem vínculo não alcança funil por deep link",
        scopeFailures.length === 0,
        scopeFailures.join(" | "),
      );
    }

    // `start_url` do manifest é "/" e não pode variar por papel. Instalada, a
    // PWA abre ali — então `/` precisa LEVAR cada papel a uma tela dele, e não
    // negar. É o defeito da E-06 tentando voltar pela porta do manifest.
    const fromStartUrl = await rolePage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check(
      `${scenario.role}: abrir pelo start_url da PWA leva a uma tela dele`,
      fromStartUrl?.status() === 200,
      `${fromStartUrl?.status()} em ${rolePage.url().replace(BASE, "")}`,
    );

    const wrong = [];
    for (const path of scenario.allowed) {
      const status = (await rolePage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status();
      if (status !== 200) wrong.push(`${path}=${status} (deveria abrir)`);
    }
    for (const path of scenario.denied) {
      const status = (await rolePage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status();
      // 403 ou 404; o que não pode é 200. Um 500 aqui também reprova: negação
      // que parece crash não distingue "não pode" de "quebrou".
      if (status === 200 || (status ?? 500) >= 500) wrong.push(`${path}=${status} (deveria negar)`);
    }
    check(`${scenario.role} alcança o que é dele e só isso`, wrong.length === 0, wrong.join(" | "));

    await rolePage.goto(`${BASE}${scenario.allowed[0]}`, { waitUntil: "networkidle" });
    changelogRoleSnapshots.push({
      role: scenario.role,
      snapshot: await changelogSnapshot(rolePage),
    });

    await roleCtx.close();
  }
}
