/**
 * Checks that only a real browser can make.
 *
 * Every bug this file exists to catch was invisible to the unit tests, and each
 * one shipped:
 *
 *  - The tooltip rendered its trigger, looked correct in the HTML, and did
 *    nothing on hover, because a Server Component cannot hand pointer handlers
 *    to Base UI.
 *  - The Content-Security-Policy written during the security review blocked
 *    Google Fonts, so the whole design system fell back to the system font
 *    while every stylesheet said otherwise.
 *
 * Both are only observable by loading the page, waiting for fonts, and moving a
 * mouse. Hence Playwright, and hence this being separate from `pnpm check`:
 * it needs the dev server up.
 *
 *   pnpm dev            # noutro terminal
 *   pnpm test:e2e
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

try {
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

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

  /* -------------------------------- Tooltips ------------------------------- */

  const triggers = page.locator('[data-slot="tooltip-trigger"]');
  const total = await triggers.count();
  check("chips de filtro presentes", total > 0, `${total}`);

  let opened = 0;
  let wellShaped = 0;
  const shapes = [];
  for (let i = 0; i < total; i++) {
    await triggers.nth(i).hover();
    await page.waitForTimeout(350);
    const popup = page.locator('[data-slot="tooltip-content"]').first();
    const visible = await popup.isVisible().catch(() => false);
    if (visible) {
      opened++;
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
  check("todo chip abre seu tooltip no hover", opened === total && total > 0, `${opened}/${total}`);
  check("tooltip abre legível, não colapsado", wellShaped === total && total > 0, shapes.join(", "));

  /* ------------------------------ Outras telas ----------------------------- */

  for (const path of ["/", "/candidate", "/pipeline", "/referrals", "/login"]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${path} responde`, response?.status() === 200, String(response?.status()));
  }

  /* --------------------------------- Mobile -------------------------------- */

  // Rolagem horizontal é a falha que passa despercebida no desktop, porque só
  // aparece quando a janela é estreita o bastante para o conteúdo não caber.
  const widths = [375, 390, 412, 768];
  const overflows = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of ["/", "/jobs", "/candidate", "/candidate/skills", "/pipeline"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) overflows.push(`${width}px ${path}: ${overflow}px`);
    }
  }
  check("sem rolagem horizontal em nenhuma largura", overflows.length === 0, overflows.slice(0, 3).join(" · "));

  await page.setViewportSize({ width: 1280, height: 900 });

  /* ------------------------------- Aparência ------------------------------- */

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/referrals`, { waitUntil: "networkidle" });

  const triggerBox = await page.getByRole("button", { name: "Aparência" }).boundingBox();
  await page.getByRole("button", { name: "Aparência" }).click();
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

  await page.getByRole("button", { name: "Aparência" }).click();
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("fecha com Escape", !(await page.locator("#appearance-popover").isVisible()));

  /* ------------------------ Temas, ambientes, contraste --------------------- */

  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const toRgb = (value) => (value.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map(Number);

  const backgrounds = new Set();
  let lowContrast = [];

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

  // Volta ao padrão para não deixar o cookie sujo para a próxima execução.
  await page.context().addCookies([
    { name: "jho_theme", value: "hp", url: BASE },
    { name: "jho_mode", value: "system", url: BASE },
  ]);

  check("nenhum erro de console", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed > 0 ? 1 : 0);
