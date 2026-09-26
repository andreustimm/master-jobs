// Área `onboarding` do E2E de navegador: Criar o próprio perfil, inclusive pelo PDF do currículo.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { en, makePortugueseLeaks } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, E2E_PASSWORD, browser, check, page, trackConsole } = ctx;
  const portugueseLeaks = makePortugueseLeaks(ctx);
  /* ---------- Criar o próprio perfil (#234): conta sem candidato ---------- */

  // A conta tem papel candidato e nenhum candidato. Antes, `/candidate` dava
  // 403 e ela só via "Vagas". Agora vê o formulário, cria um candidato NOVO e
  // privado, e passa a ver a área do candidato — com o próprio nome, nunca o
  // do dono.
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const onboarding = await context.newPage();
    trackConsole(onboarding);
    await context.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
    await onboarding.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await onboarding.fill('input[name="email"]', "e2e-sem-perfil@local.test");
    await onboarding.fill('input[name="password"]', E2E_PASSWORD);
    await onboarding.locator('[data-testid="login-submit"]').click();
    await onboarding.waitForTimeout(1_500);

    const onboardingLeaks = await portugueseLeaks(["/candidate"], onboarding);
    const form = onboarding.locator('[data-testid="route-candidate-onboarding"]');
    const formShown = (await form.count()) === 1;
    const overflow = await onboarding.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const navLink = await onboarding.locator('[data-testid="nav-create-profile"]').count();
    check("conta sem candidato vê Criar meu perfil em /candidate", formShown);
    check("Criar meu perfil aparece na navegação", navLink >= 1);
    check("Criar meu perfil cabe em 375px", overflow <= 1, `overflow=${overflow}`);
    check("Criar meu perfil não vaza português", onboardingLeaks.length === 0, onboardingLeaks.join(" | "));

    await onboarding.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    check("criar perfil oferece o endereço público", (await onboarding.locator('[data-testid="profile-slug"]').count()) === 1);
    await onboarding.fill('[data-testid="profile-name"]', "Onboarding Person E2E");
    await onboarding.fill('[data-testid="profile-headline"]', "Platform Engineer");
    await onboarding.locator('[data-testid="create-profile"]').click();
    await onboarding.locator('[data-testid="route-candidate"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await onboarding.reload({ waitUntil: "networkidle" });
    const created = (await onboarding.locator('[data-testid="route-candidate"]').count()) === 1;
    const body = (await onboarding.locator("main").textContent()) ?? "";
    const privateChecked = await onboarding
      .locator('input[name="visibility"][value="private"]')
      .isChecked()
      .catch(() => false);
    check("perfil criado sobrevive ao refresh e abre a área do candidato", created);
    check(
      "perfil novo usa o nome digitado, nunca a identidade do dono",
      body.includes("Onboarding Person E2E") && !body.includes("profile/profile.yaml"),
      body.slice(0, 200),
    );
    check("perfil novo nasce privado", privateChecked);

    // Endereço público escolhido (#235): troca, publica e confere que só o
    // novo responde — o derivado do nome passa a 404.
    const chosen = `endereco-e2e-${Date.now().toString(36)}`;
    const derivedSlug = await onboarding
      .locator('[data-testid="public-slug"]')
      .inputValue()
      .catch(() => "");
    check("perfil criado nasce com endereço derivado do nome", /^onboarding-person-e2e/.test(derivedSlug), derivedSlug);
    const savedNotice = onboarding.locator('[data-testid="mutation-feedback"][role="status"]');
    await onboarding.fill('[data-testid="public-slug"]', chosen);
    await onboarding.locator('[data-testid="save-public-slug"]').click();
    await savedNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await onboarding.locator('[data-testid="mutation-feedback-dismiss"]').click().catch(() => undefined);
    await onboarding.locator('input[name="visibility"][value="public"]').check();
    await onboarding.locator('[data-testid="save-visibility"]').click();
    await savedNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await onboarding.reload({ waitUntil: "networkidle" });
    const savedSlug = await onboarding.locator('[data-testid="public-slug"]').inputValue().catch(() => "");
    const addressOverflow = await onboarding.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("endereço público escolhido sobrevive ao refresh", savedSlug === chosen, `${savedSlug} != ${chosen}`);
    check("cartão de endereço público cabe em 375px", addressOverflow <= 1, `overflow=${addressOverflow}`);

    // BUG-20260922-short-address-wrong-reason e -long-address-cut-silently: o
    // navegador não barra nem corta; a recusa de tamanho vem do domínio, com a
    // razão certa, e o endereço atual não muda.
    const refusalNotice = onboarding.locator('[data-testid="mutation-feedback"][role="alert"]');
    const refusal = async (value) => {
      await onboarding.locator('[data-testid="mutation-feedback-dismiss"]').click().catch(() => undefined);
      await onboarding.fill('[data-testid="public-slug"]', value);
      await onboarding.locator('[data-testid="save-public-slug"]').click();
      await refusalNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
      return ((await refusalNotice.textContent().catch(() => "")) ?? "").trim();
    };
    const shortReason = await refusal("ab");
    const longReason = await refusal("a".repeat(41));
    await onboarding.reload({ waitUntil: "networkidle" });
    const afterRefusals = await onboarding.locator('[data-testid="public-slug"]').inputValue().catch(() => "");
    check("endereço curto é recusado pelo tamanho", /at least 3 characters/.test(shortReason), shortReason);
    check("endereço de 41 caracteres é recusado, não cortado", /longer than 40 characters/.test(longReason), longReason);
    check("recusas não mudam o endereço atual", afterRefusals === chosen, afterRefusals);

    // Nome do perfil público: editável, e e-mail não passa.
    const nameCard = onboarding.locator('[data-testid="public-name-card"]');
    check("nome do perfil é editável em /candidate", (await nameCard.count()) === 1);
    await onboarding.fill('[data-testid="public-name"]', "e2e-sem-perfil@local.test");
    await onboarding.locator('[data-testid="save-public-name"]').click();
    await refusalNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
    const nameReason = ((await refusalNotice.textContent().catch(() => "")) ?? "").trim();
    check("e-mail como nome do perfil é recusado com a razão", /no email or phone/.test(nameReason), nameReason);
    await onboarding.locator('[data-testid="mutation-feedback-dismiss"]').click().catch(() => undefined);
    await onboarding.fill('[data-testid="public-name"]', "Onboarding Person Renamed");
    await onboarding.locator('[data-testid="save-public-name"]').click();
    await savedNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await onboarding.reload({ waitUntil: "networkidle" });
    const savedName = await onboarding.locator('[data-testid="public-name"]').inputValue().catch(() => "");
    const nameOverflow = await onboarding.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("nome do perfil sobrevive ao refresh", savedName === "Onboarding Person Renamed", savedName);
    check("cartão de nome do perfil cabe em 375px", nameOverflow <= 1, `overflow=${nameOverflow}`);

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const fresh = await anonPage.goto(`${BASE}/p/${chosen}`, { waitUntil: "domcontentloaded" });
    const freshShown = (await anonPage.locator('[data-testid="route-public-profile"]').count()) === 1;
    const freshHeading = ((await anonPage.locator('[data-testid="route-public-profile"] h1').textContent().catch(() => "")) ?? "").trim();
    const stale = await anonPage.goto(`${BASE}/p/${derivedSlug}`, { waitUntil: "domcontentloaded" });
    check("endereço novo responde ao anônimo", fresh?.status() === 200 && freshShown, String(fresh?.status()));
    check("perfil público mostra o nome editado", freshHeading === "Onboarding Person Renamed", freshHeading);
    check(
      "endereço antigo responde 404 depois da troca",
      derivedSlug !== "" && stale?.status() === 404,
      `${derivedSlug}: ${stale?.status()}`,
    );
    await anon.close();
    await context.close();
  }

  /* ------ Criar o perfil enviando o currículo em PDF (#278), em 375px ------ */

  // O multipart de verdade, pelo mesmo `readCvPdf` do perfil existente. Um
  // arquivo que não é PDF é recusado com a razão e não cria nada; o PDF válido
  // cria o perfil e deixa o texto extraído no editor, para revisão.
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const onboarding = await context.newPage();
    trackConsole(onboarding);
    await context.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
    await onboarding.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await onboarding.fill('input[name="email"]', "e2e-sem-perfil-pdf@local.test");
    await onboarding.fill('input[name="password"]', E2E_PASSWORD);
    await onboarding.locator('[data-testid="login-submit"]').click();
    await onboarding.waitForTimeout(1_500);
    await onboarding.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

    const refusalNotice = onboarding.locator('[data-testid="mutation-feedback"][role="alert"]');
    await onboarding.fill('[data-testid="profile-name"]', "Pdf Onboarding E2E");
    await onboarding.locator('[data-testid="profile-cv-file"]').setInputFiles({
      name: "not-a-cv.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("plain text renamed to look like a PDF"),
    });
    await onboarding.locator('[data-testid="create-profile"]').click();
    await refusalNotice.waitFor({ timeout: 10_000 }).catch(() => undefined);
    const notPdfReason = ((await refusalNotice.textContent().catch(() => "")) ?? "").trim();
    check(
      "onboarding recusa arquivo que não é PDF, com a razão",
      notPdfReason.includes(en.onboarding.pdfNotPdf),
      notPdfReason,
    );
    check(
      "recusa do PDF não cria perfil",
      (await onboarding.locator('[data-testid="route-candidate-onboarding"]').count()) === 1,
    );
    await onboarding.locator('[data-testid="mutation-feedback-dismiss"]').click().catch(() => undefined);

    const { pdfComTexto } = await import("../../support/synthetic-pdf.ts");
    const marker = "Kubernetes platform migration led for the payments team";
    const lines = Array.from({ length: 6 }, (_, i) => `${marker}, release ${i + 1}, with observability`);
    const cvPdf = Buffer.from(pdfComTexto([lines]));
    await onboarding.locator('[data-testid="profile-cv-file"]').setInputFiles({
      name: "e2e-onboarding-cv.pdf",
      mimeType: "application/pdf",
      buffer: cvPdf,
    });
    await onboarding.locator('[data-testid="create-profile"]').click();
    await onboarding.locator('[data-testid="route-candidate"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await onboarding.reload({ waitUntil: "networkidle" });
    const created = (await onboarding.locator('[data-testid="route-candidate"]').count()) === 1;
    const cvText = await onboarding.locator('textarea[name="content"]').inputValue().catch(() => "");
    const cvLabel = await onboarding.locator('input[name="label"]').inputValue().catch(() => "");
    const overflow = await onboarding.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("perfil criado com PDF sobrevive ao refresh", created);
    check("texto extraído do PDF vira o currículo, no editor", cvText.includes(marker), cvText.slice(0, 120));
    check("versão do currículo leva o nome do arquivo", cvLabel === "e2e-onboarding-cv", cvLabel);
    check("perfil criado com PDF cabe em 375px", overflow <= 1, `overflow=${overflow}`);
    await context.close();
  }

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
}
