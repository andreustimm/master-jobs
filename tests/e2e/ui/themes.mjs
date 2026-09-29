// Área `themes` do E2E de navegador: Aparência, temas, ambientes, contraste e sintaxe do editor.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { contrast, toRgb } from "./shared.mjs";

/**
 * Cor de texto e FUNDO REAL de um elemento, resolvido por composição alfa —
 * não só o primeiro ancestral opaco. A faixa de sessão emprestada pinta o
 * texto sobre `bg-[var(--warn)]/10`: essa cor tem alfa 0.1, não é totalmente
 * transparente, então o padrão usado no resto deste arquivo (subir até achar
 * um fundo que não seja `rgba(0,0,0,0)`) para ali mesmo — e usaria `--warn`
 * a alfa cheio como se fosse o fundo, o dobro do problema.
 *
 * Um regex de `rgba?\(...)` não basta: o Tailwind v4 resolve o modificador
 * `/10` sobre uma variável CSS como `oklab(L a b / 0.1)`, não `rgba()` —
 * medido nesta sessão (`getComputedStyle` devolvia literalmente essa string).
 * Em vez de reimplementar a conversão oklab→sRGB à mão, um canvas de 1×1
 * pinta cada camada com `fillStyle` (o parser de cor do Canvas 2D aceita
 * qualquer sintaxe CSS válida, inclusive `oklab`/`oklch`/`color-mix`) e
 * `getImageData` devolve o `{r,g,b,a}` já em sRGB, resolvido pelo próprio
 * motor do navegador — a composição alfa entre as camadas continua manual,
 * porque é a pilha real do DOM que importa, não o que cada camada pintaria
 * sozinha num canvas. Serializado para dentro da página por `page.evaluate`;
 * roda no navegador, sem closure sobre nada deste módulo.
 */
function readCompositedContrastSample(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
  const toRgba = (cssColor) => {
    ctx2d.clearRect(0, 0, 1, 1);
    ctx2d.fillStyle = cssColor;
    ctx2d.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const layers = [];
  for (let node = el; node; node = node.parentElement) {
    const layer = toRgba(getComputedStyle(node).backgroundColor);
    if (layer.a <= 0) continue;
    layers.push(layer);
    if (layer.a >= 1) break;
  }
  if (layers.length === 0 || layers.at(-1).a < 1) layers.push({ r: 255, g: 255, b: 255, a: 1 });
  let composite = layers.at(-1);
  for (let i = layers.length - 2; i >= 0; i -= 1) {
    const layer = layers[i];
    composite = {
      r: layer.r * layer.a + composite.r * (1 - layer.a),
      g: layer.g * layer.a + composite.g * (1 - layer.a),
      b: layer.b * layer.a + composite.b * (1 - layer.a),
    };
  }
  // `toRgb()` de `shared.mjs` extrai `\d+`: um decimal cru ("245.007...")
  // vira dois números colados no ponto, e o contraste sai um valor absurdo
  // sem nenhum `NaN` para denunciar — medido nesta sessão. Arredondar aqui é
  // o suficiente; 1 unidade de 255 não move o veredito de 4.5:1.
  const round = (v) => Math.round(v);
  return {
    fg: getComputedStyle(el).color,
    bg: `rgb(${round(composite.r)}, ${round(composite.g)}, ${round(composite.b)})`,
  };
}

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, openChangelog, page } = ctx;
  /* ------------------------------- Aparência ------------------------------- */

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/referrals`, { waitUntil: "networkidle" });

  const triggerBox = await page.locator('[data-testid="appearance"]').boundingBox();
  await page.locator('[data-testid="appearance"]').click();
  await page.waitForTimeout(300);
  const panel = await page.locator("#appearance-popover").boundingBox();

  // Duas tentativas anteriores erraram aqui: com CSS Anchor Positioning o
  // painel caiu no centro da tela, e com canto fixo ele abriu longe do botão.
  // O certo é sob o botão, alinhado pela direita dele.
  const alignedToTrigger =
    Boolean(panel) &&
    Math.abs(panel.x + panel.width - (triggerBox.x + triggerBox.width)) < 6;
  const below = Boolean(panel) && panel.y >= triggerBox.y + triggerBox.height - 2;
  check(
    "painel de aparência abre sob o botão",
    alignedToTrigger && below,
    panel ? `painel@${Math.round(panel.x)} botão@${Math.round(triggerBox.x)}` : "não abriu",
  );

  await page.mouse.click(400, 600);
  await page.waitForTimeout(250);
  // `<details>` não fazia isto: ele só fecha pelo próprio summary.
  check("fecha ao clicar fora", !(await page.locator("#appearance-popover").isVisible()));

  await page.locator('[data-testid="appearance"]').click();
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("fecha com Escape", !(await page.locator("#appearance-popover").isVisible()));

  /* ------------------------ Temas, ambientes, contraste --------------------- */

  const backgrounds = new Set();
  let lowContrast = [];
  const changelogLowContrast = [];

  for (const theme of ["hp", "huly", "graphy"]) {
    for (const mode of ["light", "dark"]) {
      await page.context().addCookies([
        { name: "jho_theme", value: theme, url: BASE },
        { name: "jho_mode", value: mode, url: BASE },
      ]);
      await page.goto(`${BASE}/candidate/skills`, { waitUntil: "networkidle" });
      backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

      const samples = await page.evaluate(() => {
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll("button, a, h1, h2, p, .type-micro")) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          const label = (el.textContent ?? "").trim().slice(0, 24);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          let node = el;
          let bg = getComputedStyle(el).backgroundColor;
          while (node && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
            node = node.parentElement;
            if (!node) break;
            bg = getComputedStyle(node).backgroundColor;
          }
          out.push({ label, fg: getComputedStyle(el).color, bg: bg || "rgb(255,255,255)" });
        }
        return out.slice(0, 50);
      });

      for (const sample of samples) {
        const ratio = contrast(toRgb(sample.fg), toRgb(sample.bg));
        // 4.5:1 é o mínimo do WCAG AA para texto normal.
        if (ratio < 4.5) lowContrast.push(`${theme}/${mode} "${sample.label}" ${ratio.toFixed(2)}:1`);
      }

      // `--warn` é token de preenchimento (G32); o texto de aviso usa
      // `--warn-text` (#383), que o axe não pega porque só roda no tema
      // padrão. Este elemento é sempre visível, independente da escolha de
      // visibilidade, então cada uma das seis combinações mede o token real.
      await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
      const warnSample = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="visibility-public-warning"]');
        if (!el) return null;
        let node = el;
        let bg = getComputedStyle(el).backgroundColor;
        while (node && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
          node = node.parentElement;
          if (!node) break;
          bg = getComputedStyle(node).backgroundColor;
        }
        return { fg: getComputedStyle(el).color, bg: bg || "rgb(255,255,255)" };
      });
      if (!warnSample) {
        lowContrast.push(`${theme}/${mode} aviso-público: elemento ausente`);
      } else {
        const ratio = contrast(toRgb(warnSample.fg), toRgb(warnSample.bg));
        if (ratio < 4.5) lowContrast.push(`${theme}/${mode} aviso-público ${ratio.toFixed(2)}:1`);
      }

      await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
      const { dialog: themedDialog } = await openChangelog(page);
      const changelogSamples = await themedDialog.evaluate((dialog) => {
        const out = [];
        for (const element of dialog.querySelectorAll("h2, button, p, a, time, strong, code")) {
          const rect = element.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          let backgroundNode = element;
          let background = getComputedStyle(element).backgroundColor;
          while (backgroundNode && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
            backgroundNode = backgroundNode.parentElement;
            if (!backgroundNode) break;
            background = getComputedStyle(backgroundNode).backgroundColor;
          }
          out.push({
            label: (element.textContent ?? "").trim().slice(0, 24),
            fg: getComputedStyle(element).color,
            bg: background || getComputedStyle(dialog).backgroundColor,
          });
        }
        return out.slice(0, 60);
      });
      for (const sample of changelogSamples) {
        const ratio = contrast(toRgb(sample.fg), toRgb(sample.bg));
        if (ratio < 4.5) {
          changelogLowContrast.push(`${theme}/${mode} "${sample.label}" ${ratio.toFixed(2)}:1`);
        }
      }
      await page.locator('[data-testid="changelog-close"]').click();
    }
  }

  // Seis combinações têm de produzir seis fundos distintos; iguais significaria
  // um tema que não chegou a ser aplicado.
  check("cada tema e ambiente tem fundo próprio", backgrounds.size === 6, `${backgrounds.size}/6`);
  check(
    "todo texto passa em 4.5:1 nos seis ambientes",
    lowContrast.length === 0,
    lowContrast.slice(0, 3).join(" · "),
  );
  check(
    "E2E-021 modal passa contraste nos seis tema/modo",
    changelogLowContrast.length === 0,
    changelogLowContrast.slice(0, 4).join(" · "),
  );

  /* --------------------- Sintaxe do editor de markdown --------------------- */

  // O editor usava `defaultHighlightStyle` do CodeMirror: paleta de hex fixo
  // feita para fundo branco, aplicada também nos três temas escuros. Link dava
  // 1.44:1 e marcador 1.96:1 — não era "pouco contraste", era texto invisível,
  // e a suíte inteira passava porque nenhum teste olhava dentro do editor.
  //
  // A verificação lê o estilo COMPUTADO dos spans que o CodeMirror pintou, e
  // não os tokens do CSS. Um token correto com uma regra que não alcança o span
  // dá o mesmo resultado na tela: ilegível.
  const cmLow = [];
  const cmColours = new Set();
  const SAMPLE =
    "# Título\n**forte** *ênfase* `código` [rótulo](https://exemplo.com)\n> citação\n- item\n";

  for (const theme of ["hp", "huly", "graphy"]) {
    for (const mode of ["light", "dark"]) {
      await page.context().addCookies([
        { name: "jho_theme", value: theme, url: BASE },
        { name: "jho_mode", value: mode, url: BASE },
      ]);
      await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cm-content");
      // Digita em vez de confiar no currículo guardado: o teste precisa das
      // mesmas construções em toda execução. Nada é salvo — o formulário só
      // envia no clique em salvar.
      await page.click(".cm-content");
      await page.keyboard.type(SAMPLE, { delay: 0 });

      const painted = await page.evaluate(() => {
        const surface = getComputedStyle(document.querySelector(".cm-editor")).backgroundColor;
        const out = [];
        const seen = new Set();
        for (const span of document.querySelectorAll(".cm-line span")) {
          const text = (span.textContent ?? "").trim();
          if (!text) continue;
          const fg = getComputedStyle(span).color;
          const key = `${fg}|${text.slice(0, 12)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ text: text.slice(0, 18), fg, bg: surface });
        }
        return out;
      });

      for (const span of painted) {
        cmColours.add(`${theme}/${mode}:${span.fg}`);
        const ratio = contrast(toRgb(span.fg), toRgb(span.bg));
        if (ratio < 4.5) cmLow.push(`${theme}/${mode} "${span.text}" ${ratio.toFixed(2)}:1`);
      }
    }
  }

  check(
    "sintaxe do editor passa em 4.5:1 nos seis ambientes",
    cmLow.length === 0,
    cmLow.slice(0, 4).join(" | "),
  );
  // Um tom só em toda a amostra significaria realce desligado — legível, mas
  // sem a estrutura que faz o editor valer a pena.
  check(
    "editor realça a estrutura do markdown",
    cmColours.size >= 12,
    `${cmColours.size} tons distintos`,
  );

  /* ------------------- Faixa de sessão emprestada, contraste --------------- */

  // Contexto e login próprios: a faixa só existe numa sessão impersonada, e
  // impersonar/sair na sessão COMPARTILHADA (`ctx.page`) quebraria toda área
  // que roda depois desta assumindo que `page` continua sendo o dono. Isolado
  // no seu próprio `try` (padrão do bloco WebKit em `design.mjs`): a falha
  // reprova o check, não a suíte inteira.
  try {
    const bannerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const bannerPage = await bannerCtx.newPage();
    await bannerCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await bannerPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await bannerPage.fill('input[name="email"]', E2E_EMAIL);
    await bannerPage.fill('input[name="password"]', E2E_PASSWORD);
    await bannerPage.click('[data-testid="login-submit"]');
    await bannerPage.waitForURL((url) => !url.pathname.startsWith("/login"));

    // Mesma conta-alvo que a área `admin` assume — criada pelo setup.
    await bannerPage.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    const target = bannerPage.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
    await target.locator('[data-testid="impersonate-user"]').first().click();
    await bannerPage.waitForSelector('[data-testid="stop-impersonating"]', { timeout: 15_000 });

    const bannerLowContrast = [];
    for (const theme of ["hp", "huly", "graphy"]) {
      for (const mode of ["light", "dark"]) {
        await bannerCtx.addCookies([
          { name: "jho_theme", value: theme, url: BASE },
          { name: "jho_mode", value: mode, url: BASE },
        ]);
        await bannerPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
        const sample = await bannerPage.evaluate(
          readCompositedContrastSample,
          '[data-testid="impersonation-banner-text"]',
        );
        if (!sample) {
          bannerLowContrast.push(`${theme}/${mode} faixa: elemento ausente`);
          continue;
        }
        const ratio = contrast(toRgb(sample.fg), toRgb(sample.bg));
        if (ratio < 4.5) bannerLowContrast.push(`${theme}/${mode} faixa ${ratio.toFixed(2)}:1 (bg=${sample.bg})`);
      }
    }
    check(
      "faixa de sessão emprestada passa em 4.5:1 contra o fundo composto (--warn a 10%) nos seis ambientes",
      bannerLowContrast.length === 0,
      bannerLowContrast.slice(0, 3).join(" · "),
    );

    await bannerCtx.close();
  } catch (erro) {
    check(
      "faixa de sessão emprestada (#383): cenário concluiu sem exceção",
      false,
      (erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)).replace(/\s+/g, " ").slice(0, 600),
    );
  }
}
