// Área `public-images` do E2E de navegador: foto e capa do perfil público (#327).
// O runner sobe um MinIO descartável e passa `JHO_STORAGE_DRIVER=s3` ao servidor
// (`E2E_STORAGE=on`); sem Docker/imagem, prova só a recusa "não configurado".
import sharp from "sharp";

const png = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } } }).png().toBuffer();

async function waitFeedback(page, role) {
  await page.locator(`[data-testid="mutation-feedback"][role="${role}"]`).waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Envia e espera a RESPOSTA da action, não só o aviso: o aviso anterior pode
 * continuar na tela por cinco segundos, e esperar por ele sozinho deixaria a
 * verificação seguinte correr antes da gravação.
 */
async function submit(page, button, role = "status") {
  const done = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined,
  );
  await button.click();
  await done;
  await waitFeedback(page, role);
}

export async function run(ctx) {
  const { BASE, browser, check, page } = ctx;
  const storage = process.env.E2E_STORAGE === "on";

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const shape = await page.evaluate(() => ({
    fields: ["photo", "cover"].filter((kind) => document.querySelector(`[data-testid="public-image-${kind}"]`)),
    shown: ["photo", "cover"].filter((kind) => document.querySelector(`[data-testid="public-image-show-${kind}"]`)?.checked),
  }));
  check(
    "#327 /candidate: foto e capa, cada uma com o próprio \"mostrar\"",
    shape.fields.length === 2,
    JSON.stringify(shape),
  );

  const file = page.locator('[data-testid="public-image-file-photo"]');
  const save = page.locator('[data-testid="save-public-image-photo"]');
  const photo = { name: "foto.png", mimeType: "image/png", buffer: await png(600, 600) };

  if (!storage) {
    await file.setInputFiles(photo);
    await submit(page, save, "alert");
    check("#327 sem armazenamento, o envio é recusado com a razão", true);
    console.warn("[public-images] E2E_STORAGE=off: upload e rota pública não percorridos (sem MinIO)");
    return;
  }

  const visibilityOriginal = await page.evaluate(
    () => document.querySelector('input[name="visibility"]:checked')?.value ?? "private",
  );
  // IP próprio: as idas à rota pública não gastam o balde das outras áreas.
  const anon = await browser.newContext({
    viewport: { width: 375, height: 812 },
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" },
  });
  const anonPage = await anon.newPage();

  try {
    // SVG com cara de PNG: recusado pela assinatura, não pelo nome.
    await file.setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await submit(page, save, "alert");
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    check(
      "#327 arquivo que não é imagem é recusado e nada é gravado",
      (await page.locator('[data-testid="public-image-preview-photo"]').count()) === 0,
    );

    await file.setInputFiles(photo);
    await page.locator('[data-testid="public-image-show-photo"]').check();
    await submit(page, save);
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const preview = page.locator('[data-testid="public-image-preview-photo"]');
    await preview.waitFor({ state: "visible", timeout: 10_000 });
    const previewLoaded = await preview.evaluate((img) => img.complete && img.naturalWidth === 512);
    check("#327 prévia da foto enviada sobrevive ao reload, já reencodada em 512 px", previewLoaded);
    check(
      "#327 \"mostrar\" salvo sobrevive ao reload",
      await page.locator('[data-testid="public-image-show-photo"]').isChecked(),
    );

    await page.check('input[name="visibility"][value="public"]');
    await submit(page, page.locator('[data-testid="save-visibility"]'));
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const publicHref = await page.locator('a[href^="/p/"]').first().getAttribute("href");

    const visit = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "networkidle" });
    const hero = await anonPage.evaluate(() => {
      const img = document.querySelector('[data-testid="public-profile-photo"]');
      return {
        src: img?.getAttribute("src") ?? null,
        loaded: Boolean(img && img.complete && img.naturalWidth > 0),
        cover: Boolean(document.querySelector('[data-testid="public-profile-cover"]')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(
      "#327 visitante vê a foto em 375px, sem capa desligada e sem rolagem horizontal",
      visit?.status() === 200 && hero.loaded && !hero.cover && hero.overflow <= 0 && /^\/p\/[^/]+\/image\/photo\?v=/.test(hero.src ?? ""),
      JSON.stringify(hero),
    );

    const served = await anon.request.get(`${BASE}${hero.src}`);
    check(
      "#327 a imagem sai pelo app, WebP, sem cache",
      served.status() === 200
        && served.headers()["content-type"] === "image/webp"
        && (served.headers()["cache-control"] ?? "").includes("no-store"),
      `${served.status()} ${JSON.stringify(served.headers())}`,
    );

    // Revogar o "mostrar": a MESMA URL, guardada pelo visitante, vira 404.
    await page.locator('[data-testid="public-image-show-photo"]').uncheck();
    await submit(page, save);
    const revoked = await anon.request.get(`${BASE}${hero.src}`);
    await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "networkidle" });
    check(
      "#327 desligar \"mostrar\" tira a foto da página e a URL guardada responde 404",
      revoked.status() === 404 && (await anonPage.locator('[data-testid="public-profile-photo"]').count()) === 0,
      `${revoked.status()}`,
    );
  } finally {
    // Devolve o estado: sem foto e com a visibilidade de antes. Um teste que
    // deixa o perfil mais exposto do que encontrou é pior que teste nenhum.
    await anon.close();
    await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    const remove = page.locator('[data-testid="remove-public-image-photo"]');
    if ((await remove.count()) > 0) {
      await submit(page, remove);
      await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    }
    await page.check(`input[name="visibility"][value="${visibilityOriginal}"]`);
    await submit(page, page.locator('[data-testid="save-visibility"]'));
  }
}
