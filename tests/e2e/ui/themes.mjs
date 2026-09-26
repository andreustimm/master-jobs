// Área `themes` do E2E de navegador: Aparência, temas, ambientes, contraste e sintaxe do editor.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { contrast, toRgb } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, check, openChangelog, page } = ctx;
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
}
