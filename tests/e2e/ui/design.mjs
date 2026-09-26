// Área `design` do E2E de navegador: Tipografia, modal de novidades, tooltips e outras telas.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { webkit } from "playwright";

export async function run(ctx) {
  const { BASE, PACKAGE_VERSION, browser, changelogRoleSnapshots, changelogSnapshot, check, openChangelog, page, readModalSpacing, trackConsole } = ctx;
  const { sessionCookie } = ctx.state;
  /* ------------------------------- Tipografia ------------------------------ */

  const typography = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
        size: cs.fontSize,
        weight: cs.fontWeight,
      };
    };
    return {
      body: read("body"),
      h1: read("h1"),
      loaded: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family))],
    };
  });

  // Declarar a fonte não é aplicá-la: a CSP pode bloquear o download e a
  // página cair no fallback sem nenhum sinal no CSS.
  check("fonte do DESIGN.md realmente carregada", typography.loaded.includes("Inter"), typography.loaded.join(", "));
  check("body renderiza na fonte do sistema de design", typography.body?.family === "Inter", typography.body?.family);
  // A escala é Minor Third (1.2×) a partir de 16px, e o PESO vem do tema —
  // HP em 500, Huly em 600, Graphy em 700. Fixar o peso aqui obrigaria a
  // mudar o teste a cada tema novo, que é exatamente o acoplamento que o
  // sistema de temas existe para evitar.
  check(
    "h1 segue a escala tipográfica (display-md, 30px)",
    typography.h1?.size === "30px",
    JSON.stringify(typography.h1),
  );
  check(
    "peso do display vem do tema",
    ["500", "600", "700"].includes(typography.h1?.weight ?? ""),
    typography.h1?.weight,
  );

  const spacingSnapshots = [];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const mainPadding = {};
    for (const path of ["/", "/jobs", "/compare"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      mainPadding[path] = await page.locator("main").evaluate(
        (main) => getComputedStyle(main).paddingTop,
      );
    }
    const expectedMainPadding = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const value =
        Number.parseFloat(style.getPropertyValue("--spacing-xl")) +
        Number.parseFloat(style.getPropertyValue("--spacing-md"));
      return `${value}px`;
    });

    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const { dialog } = await openChangelog(page);
    const changelogSpacing = await readModalSpacing(dialog);
    await page.locator('[data-testid="changelog-close"]').click();
    spacingSnapshots.push({ width, mainPadding, expectedMainPadding, changelogSpacing });
  }
  check(
    "espaçamento principal segue a referência no desktop e no mobile",
    spacingSnapshots.every(
      ({ mainPadding, expectedMainPadding }) =>
        Object.values(mainPadding).every((padding) => padding === expectedMainPadding),
    ),
    JSON.stringify(spacingSnapshots),
  );
  check(
    "modal de novidades respeita topo e padding no desktop e no mobile",
    spacingSnapshots.every(
      ({ changelogSpacing }) =>
        changelogSpacing.top >= 24 &&
        changelogSpacing.bottom <= changelogSpacing.viewportHeight - 24 &&
        changelogSpacing.headerPaddingTop === "24px" &&
        changelogSpacing.headerPaddingBottom === "24px" &&
        changelogSpacing.left >= 0 &&
        changelogSpacing.right <= changelogSpacing.viewportWidth,
    ),
    JSON.stringify(spacingSnapshots),
  );
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--safe-area-top", "47px");
    root.setProperty("--safe-area-right", "20px");
    root.setProperty("--safe-area-bottom", "34px");
    root.setProperty("--safe-area-left", "44px");
  });
  const { dialog: asymmetricDialog } = await openChangelog(page);
  const asymmetricSpacing = await readModalSpacing(asymmetricDialog);
  await page.locator('[data-testid="changelog-close"]').click();
  await page.evaluate(() => {
    const root = document.documentElement.style;
    for (const property of [
      "--safe-area-top",
      "--safe-area-right",
      "--safe-area-bottom",
      "--safe-area-left",
    ]) {
      root.removeProperty(property);
    }
  });
  check(
    "modal respeita safe areas assimétricas de uma PWA móvel",
    asymmetricSpacing.top === 47 &&
      asymmetricSpacing.bottom === 812 - 34 &&
      asymmetricSpacing.left === 44 &&
      asymmetricSpacing.right === 375 - 20,
    JSON.stringify(asymmetricSpacing),
  );

  check(
    "aba comum não ativa o modo instalado",
    !(await page.evaluate(() => document.documentElement.classList.contains("pwa-standalone"))),
  );

  // Alguns WebViews e launchers expõem a área segura, mas não informam
  // `display-mode` nem `navigator.standalone`. É exatamente o estado da
  // regressão: o relógio do sistema continua sobre o viewport, enquanto a
  // classe que habilitava o padding fica ausente.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.documentElement.style.setProperty("--safe-area-top", "47px");
  });
  const browserSafeAreaHeader = await page.locator("#application-shell > header").evaluate((header) => {
    const brand = header.querySelector(":scope > div > [data-nav-brand]");
    const headerRect = header.getBoundingClientRect();
    const brandRect = brand?.getBoundingClientRect();
    return {
      standalone: document.documentElement.classList.contains("pwa-standalone"),
      paddingTop: Number.parseFloat(getComputedStyle(header).paddingTop),
      brandTop: brandRect?.top ?? -1,
      headerTop: headerRect.top,
    };
  });
  check(
    "cabeçalho reserva o inset exposto mesmo sem sinal de modo instalado",
    !browserSafeAreaHeader.standalone &&
      browserSafeAreaHeader.paddingTop >= 47 &&
      browserSafeAreaHeader.brandTop >= browserSafeAreaHeader.headerTop + 47,
    JSON.stringify(browserSafeAreaHeader),
  );
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--safe-area-top");
  });

  const headerSafeAreaContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  await headerSafeAreaContext.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = nativeMatchMedia(query);
      if (query === "(display-mode: standalone)") {
        Object.defineProperty(result, "matches", { configurable: true, value: true });
      }
      return result;
    };
  });
  const headerSafeAreaPage = await headerSafeAreaContext.newPage();
  trackConsole(headerSafeAreaPage);
  const headerSafeAreaCdp = await headerSafeAreaContext.newCDPSession(headerSafeAreaPage);
  const headerSafeAreaSnapshots = [];
  const mobileNavPopoverSnapshots = [];
  for (const fixture of [
    { label: "mobile retrato", width: 375, height: 812, touch: true, safe: { top: 47, right: 0, bottom: 34, left: 0 } },
    { label: "mobile retrato sem inset", width: 390, height: 844, touch: true, safe: { top: 0, right: 0, bottom: 34, left: 0 } },
    { label: "mobile paisagem", width: 812, height: 375, touch: true, safe: { top: 0, right: 44, bottom: 21, left: 44 } },
    { label: "mobile paisagem larga", width: 932, height: 430, touch: true, safe: { top: 0, right: 0, bottom: 21, left: 0 } },
    { label: "tablet paisagem baixa", width: 1024, height: 375, touch: true, safe: { top: 0, right: 0, bottom: 20, left: 0 } },
    { label: "tablet", width: 768, height: 1024, touch: true, safe: { top: 24, right: 0, bottom: 20, left: 0 } },
    { label: "desktop", width: 1280, height: 900, touch: false, safe: { top: 0, right: 0, bottom: 0, left: 0 } },
  ]) {
    await headerSafeAreaCdp.send("Emulation.setDeviceMetricsOverride", {
      width: fixture.width,
      height: fixture.height,
      deviceScaleFactor: 1,
      mobile: fixture.touch,
      screenWidth: fixture.width,
      screenHeight: fixture.height,
    });
    await headerSafeAreaCdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: fixture.touch,
      maxTouchPoints: fixture.touch ? 5 : 1,
    });
    await headerSafeAreaPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await headerSafeAreaPage.evaluate(({ top, right, bottom, left }) => {
      const root = document.documentElement.style;
      root.setProperty("--safe-area-top", `${top}px`);
      root.setProperty("--safe-area-right", `${right}px`);
      root.setProperty("--safe-area-bottom", `${bottom}px`);
      root.setProperty("--safe-area-left", `${left}px`);
    }, fixture.safe);

    const sample = await headerSafeAreaPage.locator("#application-shell > header").evaluate((header) => {
      const content = header.firstElementChild;
      const rootStyle = getComputedStyle(document.documentElement);
      const headerRect = header.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const contentStyle = content ? getComputedStyle(content) : null;
      const brand = content?.querySelector(":scope > [data-nav-brand]");
      const brandRect = brand?.getBoundingClientRect();
      const desktopNav = content?.querySelector(":scope > nav[data-responsive-nav]");
      const mobileTrigger = content?.querySelector(":scope > [data-responsive-mobile-nav-trigger]");
      const desktopNavStyle = desktopNav ? getComputedStyle(desktopNav) : null;
      const mobileTriggerStyle = mobileTrigger ? getComputedStyle(mobileTrigger) : null;
      return {
        standaloneClass: document.documentElement.classList.contains("pwa-standalone"),
        pointerCoarse: matchMedia("(pointer: coarse)").matches,
        lowPhoneLandscape: matchMedia("(pointer: coarse) and (orientation: landscape) and (max-width: 1023px) and (max-height: 500px)").matches,
        paddingTop: Number.parseFloat(getComputedStyle(header).paddingTop),
        safeAreaFloor: Number.parseFloat(rootStyle.getPropertyValue("--safe-area-top-floor")),
        safeTop: Number.parseFloat(rootStyle.getPropertyValue("--safe-area-top")),
        safeRight: Number.parseFloat(rootStyle.getPropertyValue("--safe-area-right")),
        safeLeft: Number.parseFloat(rootStyle.getPropertyValue("--safe-area-left")),
        headerTop: headerRect.top,
        headerHeight: headerRect.height,
        headerRight: headerRect.right,
        headerLeft: headerRect.left,
        contentTop: contentRect?.top ?? -1,
        contentHeight: contentRect?.height ?? -1,
        brandTop: brandRect?.top ?? -1,
        brandBottom: brandRect?.bottom ?? -1,
        contentRight: contentRect?.right ?? -1,
        contentLeft: contentRect?.left ?? -1,
        contentWidth: contentRect?.width ?? -1,
        contentPaddingRight: Number.parseFloat(contentStyle?.paddingRight ?? "0"),
        contentPaddingLeft: Number.parseFloat(contentStyle?.paddingLeft ?? "0"),
        desktopNavDisplay: desktopNavStyle?.display ?? "missing",
        desktopNavDirection: desktopNavStyle?.flexDirection ?? "missing",
        mobileTriggerDisplay: mobileTriggerStyle?.display ?? "missing",
        viewportWidth: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    headerSafeAreaSnapshots.push({ ...fixture, ...sample });

    if (fixture.touch) {
      const trigger = headerSafeAreaPage.locator('[data-testid="mobile-nav-trigger"]');
      if ((await trigger.count()) > 0 && await trigger.isVisible()) {
        await trigger.click();
        const popover = await headerSafeAreaPage.locator('[data-testid="mobile-nav-popover"]').evaluate((panel) => {
          const header = document.querySelector("#application-shell > header");
          return {
            headerBottom: header?.getBoundingClientRect().bottom ?? -1,
            popoverTop: panel.getBoundingClientRect().top,
            open: panel.matches(":popover-open"),
          };
        });
        mobileNavPopoverSnapshots.push({ ...fixture, ...popover });
        await headerSafeAreaPage.keyboard.press("Escape");
      }
    }
  }
  await headerSafeAreaCdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await headerSafeAreaCdp.send("Emulation.clearDeviceMetricsOverride");
  await headerSafeAreaContext.close();

  check(
    "cabeçalho PWA respeita a barra do sistema em mobile retrato, paisagem, tablet e desktop",
    headerSafeAreaSnapshots.every((sample) => {
      const isLowPhoneLandscape = sample.lowPhoneLandscape;
      const expectedTop = sample.touch && !isLowPhoneLandscape
        ? Math.max(sample.safeAreaFloor, sample.safeTop)
        : sample.safeTop;
      return sample.standaloneClass
        && sample.pointerCoarse === sample.touch
        && sample.paddingTop === expectedTop
        && sample.contentTop >= sample.headerTop + expectedTop
        && sample.contentHeight >= 56
        && sample.contentHeight <= 64
        && sample.brandTop >= sample.headerTop + expectedTop
        && sample.brandBottom <= sample.headerTop + sample.paddingTop + sample.contentHeight
        && (!isLowPhoneLandscape
          || sample.headerHeight <= sample.contentHeight + sample.safeTop + 2)
        && sample.headerLeft <= 0.5
        && sample.headerRight >= sample.viewportWidth - 0.5
        && sample.contentLeft >= sample.headerLeft
        && sample.contentRight <= sample.headerRight
        && sample.contentPaddingLeft >= sample.safeLeft
        && sample.contentPaddingRight >= sample.safeRight
        && (sample.label !== "tablet"
          || (sample.contentPaddingLeft === 24 && sample.contentPaddingRight === 24))
        && (sample.label !== "desktop"
          || (sample.contentPaddingLeft === 32 && sample.contentPaddingRight === 32))
        && (sample.desktopNavDisplay !== "none") !== (sample.mobileTriggerDisplay !== "none")
        && (sample.desktopNavDisplay === "none" || sample.desktopNavDirection === "row")
        && sample.scrollWidth <= sample.viewportWidth;
    }),
    JSON.stringify(headerSafeAreaSnapshots),
  );
  check(
    "container ocupa a largura integral com calha fixa em retrato e paisagem",
    headerSafeAreaSnapshots
      .filter((sample) => sample.width <= 639 || (sample.height <= 500 && sample.width < 900))
      .every((sample) => {
        // A superfície do topo é full-bleed; o conteúdo usa 95% da viewport
        // móvel. Um recorte físico maior substitui a calha percentual.
        const expectedLeftPad = Math.max(sample.viewportWidth * 0.025, sample.safeLeft);
        const expectedRightPad = Math.max(sample.viewportWidth * 0.025, sample.safeRight);
        const usefulWidth = sample.contentWidth - sample.contentPaddingLeft - sample.contentPaddingRight;
        const expectedUsefulWidth =
          sample.viewportWidth - expectedLeftPad - expectedRightPad;
        return (
          Math.abs(sample.contentWidth - sample.viewportWidth) <= 1 &&
          Math.abs(sample.contentLeft) <= 1 &&
          Math.abs(usefulWidth - expectedUsefulWidth) <= 1
        );
      }),
    JSON.stringify(headerSafeAreaSnapshots),
  );
  check(
    "menu PWA abre abaixo do cabeçalho completo, inclusive com área segura",
    mobileNavPopoverSnapshots.length > 0 &&
      mobileNavPopoverSnapshots.every(({ headerBottom, popoverTop, open }) => open && popoverTop >= headerBottom - 1),
    JSON.stringify(mobileNavPopoverSnapshots),
  );

  /* O teto do shell: nenhuma fixture acima chega a 1760px, e é a única parte
     do container determinístico que só existe acima disso. Uma regressão no
     teto (percentual de volta, cap perdido) passaria por todos os viewports
     amostrados até aqui. */
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const wideShell = await page
    .locator("#application-shell > header > div")
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, left: rect.left };
    });
  check(
    "teto do shell: 1760px em viewport larga, centrado",
    Math.abs(wideShell.width - 1760) <= 1 &&
      Math.abs(wideShell.left - (1920 - 1760) / 2) <= 1,
    JSON.stringify(wideShell),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });

  /* -------------------------- Modal de novidades -------------------------- */

  const changelogImageRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/export") {
      changelogImageRequests.push(request.url());
    }
  });
  const changelogUrl = page.url();
  const portugueseResponse = await page.content();
  check(
    "novidades não montam cards nem conteúdo enquanto o modal está fechado",
    (await page.locator('[data-testid^="changelog-release-"]').count()) === 0,
  );
  let opened = await openChangelog(page);
  const focusEntered = await opened.dialog.evaluate((dialog) =>
    dialog.contains(document.activeElement),
  );
  check(
    "E2E-001 abre diálogo nativo com título e versão sem navegar",
    (await opened.dialog.getAttribute("open")) !== null &&
      (await opened.dialog.locator("#changelog-dialog-title").isVisible()) &&
      ((await opened.dialog.textContent()) ?? "").includes(`v${PACKAGE_VERSION}`) &&
      page.url() === changelogUrl && focusEntered,
  );

  await page.locator('[data-testid="changelog-close"]').click();
  check(
    "E2E-002 fechar visível restaura foco ao gatilho",
    !(await opened.dialog.isVisible()) &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ===
        "changelog-open",
  );

  opened = await openChangelog(page);
  await page.keyboard.press("Escape");
  check(
    "E2E-003 Escape fecha e restaura foco",
    !(await opened.dialog.isVisible()) &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ===
        "changelog-open",
  );

  opened = await openChangelog(page);
  await opened.dialog.locator("header").click({ position: { x: 40, y: 40 } });
  const insideKeptOpen = await opened.dialog.isVisible();
  await page.mouse.click(4, 4);
  await opened.dialog.waitFor({ state: "hidden" });
  check("E2E-004 backdrop fecha e clique no painel não", insideKeptOpen);

  opened = await openChangelog(page);
  let releaseButtons = opened.dialog.locator('[data-testid^="changelog-release-"]');
  check(
    "E2E-005 somente a versão mais nova começa expandida",
    (await releaseButtons.count()) === 100 &&
      (await opened.dialog.locator('[data-testid^="changelog-release-"][aria-expanded="true"]').count()) === 1 &&
      (await opened.dialog.locator('[id$="-content"] > *').count()) === 1 &&
      (await releaseButtons.first().getAttribute("aria-expanded")) === "true",
  );

  const middleBodyId = await releaseButtons.nth(1).getAttribute("aria-controls");
  const middleBody = opened.dialog.locator(`#${middleBodyId}`);
  await releaseButtons.nth(1).click();
  await releaseButtons.nth(2).click();
  check(
    "E2E-006 três versões permanecem expandidas",
    (await opened.dialog.locator('[aria-expanded="true"]').count()) === 3 &&
      (await opened.dialog.locator('[id$="-content"] > *').count()) === 3 &&
      ((await middleBody.textContent()) ?? "").includes("histórico sem horário"),
  );

  await releaseButtons.nth(1).click();
  const statesAfterMiddleCollapse = await Promise.all(
    [0, 1, 2].map((index) => releaseButtons.nth(index).getAttribute("aria-expanded")),
  );
  check(
    "E2E-007 fechar a intermediária preserva as demais sem duplicar",
    statesAfterMiddleCollapse.join(",") === "true,false,true" &&
      (await opened.dialog.locator('[id$="-content"]').count()) === 100 &&
      (await opened.dialog.locator('[id$="-content"] > *').count()) === 2 &&
      (await middleBody.locator(":scope > *").count()) === 0,
    statesAfterMiddleCollapse.join(","),
  );

  await page.locator('[data-testid="changelog-close"]').click();
  opened = await openChangelog(page);
  releaseButtons = opened.dialog.locator('[data-testid^="changelog-release-"]');
  check(
    "E2E-008 reabrir restaura newest-only",
    (await opened.dialog.locator('[aria-expanded="true"]').count()) === 1 &&
      (await releaseButtons.first().getAttribute("aria-expanded")) === "true",
  );

  const keyboardHeader = releaseButtons.nth(1);
  const keyboardChevron = keyboardHeader.locator("svg");
  await keyboardHeader.focus();
  await page.keyboard.press("Enter");
  const controls = await keyboardHeader.getAttribute("aria-controls");
  const enterState =
    (await keyboardHeader.getAttribute("aria-expanded")) === "true" &&
    Boolean(controls) &&
    (await opened.dialog.locator(`#${controls}`).isVisible()) &&
    (await keyboardHeader.getAttribute("data-state")) === "open" &&
    ((await keyboardChevron.getAttribute("class")) ?? "").includes("rotate-180");
  await page.keyboard.press("Space");
  const spaceState =
    (await keyboardHeader.getAttribute("aria-expanded")) === "false" &&
    !(await opened.dialog.locator(`#${controls}`).isVisible()) &&
    (await keyboardHeader.getAttribute("data-state")) === "closed" &&
    !((await keyboardChevron.getAttribute("class")) ?? "").includes("rotate-180");
  check("E2E-009 teclado sincroniza ARIA, região e chevron", enterState && spaceState);

  const newestContent = opened.dialog.locator('[id="changelog-release-1-1-0-content"]');
  const semantics = await newestContent.evaluate((element) => ({
    tags: ["p", "h3", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "hr", "a"]
      .filter((tag) => element.querySelector(tag)),
    text: element.textContent ?? "",
  }));
  check(
    "E2E-010 Markdown completo renderiza semântica e linhas envolvidas",
    semantics.tags.length === 12 &&
      !semantics.text.includes("**forte**") &&
      semantics.text.includes("continua na linha seguinte"),
    `${semantics.tags.length}/12 tags`,
  );
  const hostile = await newestContent.evaluate((element) => ({
    script: Boolean(element.querySelector("script")),
    raw: Boolean(element.querySelector("#changelog-raw-html")),
    unsafe: [...element.querySelectorAll("a")].some((anchor) =>
      /^(javascript|data):/i.test(anchor.getAttribute("href") ?? ""),
    ),
    image: Boolean(element.querySelector("img")),
    executed: globalThis.__changelogScriptRan === true,
  }));
  check(
    "E2E-011 HTML e destinos hostis permanecem inertes",
    !hostile.script && !hostile.raw && !hostile.unsafe && !hostile.image &&
      !hostile.executed && changelogImageRequests.length === 0,
    JSON.stringify({ ...hostile, imageRequests: changelogImageRequests }),
  );

  check(
    "E2E-012 edição portuguesa não mistura prose inglesa",
    semantics.text.includes("CONTEUDO_PT_EXCLUSIVO") &&
      !semantics.text.includes("ENGLISH_RELEASE_ONLY") &&
      portugueseResponse.includes("CONTEUDO_PT_EXCLUSIVO") &&
      !portugueseResponse.includes("ENGLISH_RELEASE_ONLY") &&
      ((await opened.dialog.textContent()) ?? "").includes("Novidades"),
  );
  await page.locator('[data-testid="changelog-close"]').click();

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  await page.reload({ waitUntil: "networkidle" });
  const englishResponse = await page.content();
  opened = await openChangelog(page);
  const englishText = (await opened.dialog.textContent()) ?? "";
  check(
    "E2E-013 edição inglesa não mistura prose portuguesa",
    englishText.includes("ENGLISH_RELEASE_ONLY") &&
      !englishText.includes("CONTEUDO_PT_EXCLUSIVO") &&
      englishResponse.includes("ENGLISH_RELEASE_ONLY") &&
      !englishResponse.includes("CONTEUDO_PT_EXCLUSIVO") &&
      englishText.includes("What's new"),
  );
  await page.locator('[data-testid="changelog-close"]').click();

  async function timezoneView(timezoneId, locale) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1280, height: 900 } });
    const target = await context.newPage();
    trackConsole(target);
    await context.addCookies([
      sessionCookie,
      { name: "jho_locale", value: locale, url: BASE },
    ]);
    await target.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const { dialog } = await openChangelog(target);
    const newest = dialog.locator('[data-testid="changelog-release-1.1.0"] time');
    await newest.waitFor();
    await target.waitForFunction(
      () => document.querySelector('[data-testid="changelog-release-1.1.0"] time')?.textContent?.trim(),
    );
    const boundaryTime = dialog.locator('time[datetime="2027-01-01T01:30:00.000Z"]');
    await boundaryTime.waitFor();
    const result = {
      newest: (await newest.textContent())?.trim() ?? "",
      newestDateTime: await newest.getAttribute("datetime"),
      boundary: (await boundaryTime.textContent())?.trim() ?? "",
      boundaryDateTime: await boundaryTime.getAttribute("datetime"),
      dateOnly: (await dialog.locator('[data-testid="changelog-release-1.0.0"] time').textContent())?.trim() ?? "",
    };
    await context.close();
    return result;
  }

  const saoPauloPt = await timezoneView("America/Sao_Paulo", "pt-BR");
  const saoPauloEn = await timezoneView("America/Sao_Paulo", "en");
  check("E2E-014 instante pt-BR usa hora local exata", saoPauloPt.newest === "22/08/2026 08:46", saoPauloPt.newest);
  check("E2E-015 instante en usa hora local exata", saoPauloEn.newest === "08/22/2026 08:46", saoPauloEn.newest);

  const tokyoEn = await timezoneView("Asia/Tokyo", "en");
  check(
    "E2E-016 timezones cruzam o dia preservando um ISO",
    saoPauloEn.boundary === "12/31/2026 22:30" &&
      tokyoEn.boundary === "01/01/2027 10:30" &&
      saoPauloEn.boundaryDateTime === "2027-01-01T01:30:00.000Z" &&
      tokyoEn.boundaryDateTime === saoPauloEn.boundaryDateTime,
    `${saoPauloEn.boundary} | ${tokyoEn.boundary}`,
  );
  check(
    "E2E-017 data histórica permanece sem hora nem drift",
    saoPauloPt.dateOnly === "21/08/2026" && saoPauloEn.dateOnly === "08/21/2026",
    `${saoPauloPt.dateOnly} | ${saoPauloEn.dateOnly}`,
  );

  await page.locator("#locale-popover-trigger").click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.locator('#locale-popover [lang="pt-BR"]').click(),
  ]);
  opened = await openChangelog(page);
  check(
    "E2E-018 troca de locale reabre edição coerente em newest-only",
    ((await opened.dialog.textContent()) ?? "").includes("CONTEUDO_PT_EXCLUSIVO") &&
      (await opened.dialog.locator('[aria-expanded="true"]').count()) === 1,
  );
  await page.locator('[data-testid="changelog-close"]').click();

  await page.setViewportSize({ width: 375, height: 812 });
  opened = await openChangelog(page);
  const narrow = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="changelog-dialog"]');
    const scrollArea = dialog?.querySelector("div.min-h-0.flex-1");
    const header = document.querySelector('[data-testid="changelog-release-1.1.0"]');
    const longHeader = document
      .querySelector('time[datetime="2027-01-01T01:30:00.000Z"]')
      ?.closest("button");
    const code = dialog?.querySelector("pre");
    const dialogRect = dialog?.getBoundingClientRect();
    const scrollRect = scrollArea?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const visibleHeaderHeight = scrollRect && headerRect
      ? Math.max(
          0,
          Math.min(scrollRect.bottom, headerRect.bottom) -
            Math.max(scrollRect.top, headerRect.top),
        )
      : 0;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 999,
      headerWidth: header?.getBoundingClientRect().width ?? 0,
      longHeaderOverflow: longHeader ? longHeader.scrollWidth - longHeader.clientWidth : 999,
      codeContained:
        code && dialog
          ? code.getBoundingClientRect().right <= dialog.getBoundingClientRect().right
          : false,
      codeScrolls: code ? code.scrollWidth > code.clientWidth : false,
      viewport: document.documentElement.clientWidth,
      viewportHeight: globalThis.visualViewport?.height ?? globalThis.innerHeight,
      dialogHeight: dialogRect?.height ?? 0,
      scrollAreaHeight: scrollRect?.height ?? 0,
      firstHeaderHeight: headerRect?.height ?? 0,
      visibleHeaderHeight,
    };
  });
  check(
    "E2E-019 375px contém strings longas e mantém controles alcançáveis",
    narrow.overflow <= 1 && narrow.dialogOverflow <= 1 &&
      narrow.headerWidth > 0 && narrow.headerWidth <= narrow.viewport &&
      narrow.longHeaderOverflow <= 1 && narrow.codeContained && narrow.codeScrolls,
    JSON.stringify(narrow),
  );
  check(
    "E2E-019b 375px reserva área vertical útil e mostra o primeiro card inteiro",
    narrow.dialogHeight >= narrow.viewportHeight * 0.7 &&
      narrow.scrollAreaHeight >= narrow.viewportHeight * 0.45 &&
      narrow.firstHeaderHeight >= 44 &&
      narrow.visibleHeaderHeight >= narrow.firstHeaderHeight - 1,
    JSON.stringify(narrow),
  );

  const webkitBrowser = await webkit.launch();
  try {
    const webkitContext = await webkitBrowser.newContext({ viewport: { width: 375, height: 812 } });
    const webkitPage = await webkitContext.newPage();
    trackConsole(webkitPage);
    await webkitContext.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    // O servidor E2E é HTTP. O WebKit não reenvia nesse transporte o cookie
    // `Secure` capturado no Chromium, embora produção seja HTTPS. Preserve o
    // token real e ajuste somente o atributo de transporte da fixture local.
    if (!sessionCookie) throw new Error("sessão E2E ausente para o cenário WebKit");
    await webkitContext.addCookies([
      {
        name: "jho_session",
        value: sessionCookie.value,
        url: BASE,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    // `domcontentloaded` em vez de `networkidle`, e o cenário isolado num `try`
    // próprio — ver o `catch` no fim deste bloco.
    //
    // O `networkidle` nunca alcança silêncio de rede em `/jobs` sobre o acervo
    // E2E, e essa era a causa do abort original. Mas a troca não bastou: MEDIDO em
    // cinco execuções, este `goto` estoura trinta segundos de forma
    // INTERMITENTE, e estoura também em `/candidate`, que renderiza muito menos.
    // Passou numa das cinco. Não é a rota, e não é o tipo de espera — é o WebKit
    // nesta máquina sob carga.
    //
    // O que está consertado aqui é o alcance da falha: ela reprova um check e a
    // suíte continua. O porquê do WebKit ficou registrado na tarefa, com as cinco
    // medições, em vez de coberto por um timeout maior — que esconderia lentidão
    // real sem dizer nada.
    await webkitPage.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
    await webkitPage
      .locator('[data-testid="changelog-open"]')
      .waitFor({ state: "visible", timeout: 20_000 });
    const { dialog: webkitDialog } = await openChangelog(webkitPage);
    const webkitVertical = await webkitDialog.evaluate((dialog) => {
      const scrollArea = dialog.querySelector("div.min-h-0.flex-1");
      const firstHeader = dialog.querySelector('[data-testid^="changelog-release-"]');
      const dialogRect = dialog.getBoundingClientRect();
      const scrollRect = scrollArea?.getBoundingClientRect();
      const headerRect = firstHeader?.getBoundingClientRect();
      return {
        viewportHeight: globalThis.visualViewport?.height ?? globalThis.innerHeight,
        dialogHeight: dialogRect.height,
        scrollAreaHeight: scrollRect?.height ?? 0,
        firstHeaderHeight: headerRect?.height ?? 0,
        visibleHeaderHeight: scrollRect && headerRect
          ? Math.max(
              0,
              Math.min(scrollRect.bottom, headerRect.bottom) -
                Math.max(scrollRect.top, headerRect.top),
            )
          : 0,
      };
    });
    check(
      "E2E-019c WebKit móvel reserva área vertical útil e mostra o primeiro card inteiro",
      webkitVertical.dialogHeight >= webkitVertical.viewportHeight * 0.7 &&
        webkitVertical.scrollAreaHeight >= webkitVertical.viewportHeight * 0.45 &&
        webkitVertical.firstHeaderHeight >= 44 &&
        webkitVertical.visibleHeaderHeight >= webkitVertical.firstHeaderHeight - 1,
      JSON.stringify(webkitVertical),
    );
  } catch (erro) {
    // Isolado de propósito. Este é o único cenário que abre um SEGUNDO navegador,
    // e antes uma falha aqui derrubava a suíte inteira pelo `catch` global —
    // 42 de 262 verificações rodavam e o resto ficava sem resposta. A falha
    // continua sendo falha, com o diagnóstico inteiro; o que muda é que ela não
    // decide o destino dos outros cenários.
    check(
      "E2E-019c WebKit móvel: cenário concluiu sem exceção",
      false,
      (erro instanceof Error ? erro.stack ?? erro.message : String(erro)).replace(/\s+/g, " ").slice(0, 600),
    );
  } finally {
    await webkitBrowser.close();
  }

  const scrollArea = opened.dialog.locator("div.min-h-0.flex-1");
  const headerTop = (await opened.dialog.locator("header").boundingBox())?.y;
  await opened.dialog.locator('[data-testid^="changelog-release-"]').evaluateAll((buttons) => {
    for (const button of buttons) {
      if (button.getAttribute("aria-expanded") === "false") button.click();
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="changelog-dialog"] [aria-expanded="true"]').length === 100,
  );
  await scrollArea.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const largeHistory = {
    expanded: await opened.dialog.locator('[aria-expanded="true"]').count(),
    scrolls: await scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight),
    closeVisible: await page.locator('[data-testid="changelog-close"]').isVisible(),
    headerTopAfter: (await opened.dialog.locator("header").boundingBox())?.y,
  };
  check(
    "E2E-020 100 releases mantêm header, close e scroll interno",
    largeHistory.expanded === 100 && largeHistory.scrolls && largeHistory.closeVisible &&
      Math.abs((largeHistory.headerTopAfter ?? 0) - (headerTop ?? 0)) <= 1,
    JSON.stringify(largeHistory),
  );

  // 200% browser zoom halves the CSS viewport while preserving the physical
  // window. Playwright exposes the resulting CSS viewport, which is the part
  // layout and reachability respond to.
  await page.setViewportSize({ width: 640, height: 450 });
  await page.locator('[data-testid="changelog-close"]').focus();
  let focusEscaped = false;
  const expectedReleaseControls = await releaseButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-testid")),
  );
  const reachedReleaseControls = new Set();
  for (let index = 0; index < expectedReleaseControls.length + 2; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await opened.dialog.evaluate((element) => ({
      inside: element.contains(document.activeElement),
      testId: document.activeElement?.getAttribute("data-testid") ?? null,
    }));
    if (!focus.inside) {
      focusEscaped = true;
      break;
    }
    if (focus.testId?.startsWith("changelog-release-")) {
      reachedReleaseControls.add(focus.testId);
    }
  }
  const closeAtZoom = await page.locator('[data-testid="changelog-close"]').boundingBox();
  check(
    "E2E-022 teclado e zoom mantêm foco e close alcançável",
    !focusEscaped && reachedReleaseControls.size === expectedReleaseControls.length &&
      Boolean(closeAtZoom) && closeAtZoom.y >= 0 && closeAtZoom.x >= 0,
    JSON.stringify({ closeAtZoom, reached: reachedReleaseControls.size }),
  );
  await page.locator('[data-testid="changelog-close"]').click();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.context().setOffline(true);
  await page.locator('[data-testid="changelog-open"]').evaluate((button) => {
    button.click();
    button.click();
  });
  await page.locator('[data-testid="changelog-release-1.0.0"]').click();
  await page.locator('[data-testid="changelog-release-1.0.0"]').click();
  const offlineState = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[data-testid="changelog-dialog"]').length,
    openDialogs: document.querySelectorAll('[data-testid="changelog-dialog"][open]').length,
    drift: [...document.querySelectorAll('[data-testid^="changelog-release-"]')].some((button) => {
      const controls = button.getAttribute("aria-controls");
      const region = controls ? document.getElementById(controls) : null;
      return !region || (button.getAttribute("aria-expanded") === "true") === region.hidden;
    }),
  }));
  check(
    "E2E-024 offline e interação rápida mantêm um diálogo e estado coerente",
    offlineState.dialogs === 1 && offlineState.openDialogs === 1 && !offlineState.drift,
    JSON.stringify(offlineState),
  );
  await page.locator('[data-testid="changelog-close"]').click();
  await page.context().setOffline(false);
  changelogRoleSnapshots.push({ role: "admin", snapshot: await changelogSnapshot(page) });

  /* -------------------------------- Tooltips ------------------------------- */

  const triggers = page.locator('[data-slot="tooltip-trigger"]');
  const total = await triggers.count();
  check("chips de filtro presentes", total > 0, `${total}`);

  let tooltipOpened = 0;
  let wellShaped = 0;
  const shapes = [];
  for (let i = 0; i < total; i++) {
    await triggers.nth(i).hover();
    await page.waitForTimeout(350);
    const popup = page.locator('[data-slot="tooltip-content"]').first();
    const visible = await popup.isVisible().catch(() => false);
    if (visible) {
      tooltipOpened++;
      const box = await popup.boundingBox();
      // Visível não basta. Uma versão anterior abria com 24px de largura e
      // 140px de altura, quebrando o texto letra por letra — passou por um
      // teste que só perguntava "está visível?". A forma é o que prova que
      // está legível.
      if (box && box.width >= 120 && box.height <= 200) wellShaped++;
      else shapes.push(`${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
  }
  check("todo chip abre seu tooltip no hover", tooltipOpened === total && total > 0, `${tooltipOpened}/${total}`);
  check("tooltip abre legível, não colapsado", wellShaped === total && total > 0, shapes.join(", "));

  /* ------------------------------ Outras telas ----------------------------- */

  for (const path of ["/", "/compare", "/candidate", "/pipeline", "/referrals", "/login"]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${path} responde`, response?.status() === 200, String(response?.status()));
  }
}
