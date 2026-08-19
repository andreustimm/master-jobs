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

/**
 * Credenciais da conta dedicada, criada por `tests/e2e/setup.mjs`.
 *
 * Conta separada de propósito: apontar o teste para a conta real faria trocar
 * a própria senha quebrar a suíte, e a credencial de verdade não deve estar
 * escrita em arquivo nenhum do repositório.
 */
const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e@local.test";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "conta-de-teste-e2e-42";
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

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', "senha-propositalmente-errada");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(900);
  check("senha errada não entra", page.url().includes("/login"), page.url());
  check(
    "erro aparece na tela",
    (await page.locator("form").textContent())?.includes("incorretos") ?? false,
  );

  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1400);
  check("senha correta entra", !page.url().includes("/login"), page.url());

  const sessionCookie = (await page.context().cookies()).find((c) => c.name === "jho_session");
  // httpOnly é o que impede um XSS de ler a sessão.
  check("cookie de sessão é httpOnly", sessionCookie?.httpOnly === true);
  check("cookie de sessão é sameSite lax", (sessionCookie?.sameSite ?? "").toLowerCase() === "lax");

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


  /* ------------------- Ações do card: largura e alvo de toque -------------- */

  // As três ações ficavam em `flex flex-wrap`, então cada botão media o próprio
  // texto — 54px, 69px e 93px. Lado a lado no celular isso lê como um botão
  // menor que os outros, e foi assim que o defeito chegou. No desktop a coluna
  // já esticava todos: a inconsistência era entre as duas telas.
  //
  // Verificado em três larguras porque a regressão mora justamente na estreita:
  // três colunas fixas espremeriam "aplicar →" para fora da caixa em 320px.
  const actionProblems = [];
  for (const [width, label] of [[320, "320"], [391, "391"], [1440, "1440"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const group = await page.evaluate(() => {
      for (const trigger of document.querySelectorAll("button[popovertarget^='job-modal']")) {
        const box = trigger.parentElement;
        if (!box || box.children.length < 3) continue;
        return [...box.children].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: (el.textContent ?? "").trim().slice(0, 10),
            w: Math.round(r.width),
            h: Math.round(r.height),
            // Texto maior que a caixa é o modo de falhar de largura fixa.
            clipped: el.scrollWidth > el.clientWidth + 1,
          };
        });
      }
      return null;
    });
    if (!group) continue;

    const widths = new Set(group.map((g) => g.w));
    if (widths.size !== 1) {
      actionProblems.push(`${label}: larguras ${[...widths].join("/")}`);
    }
    for (const item of group) {
      if (item.clipped) actionProblems.push(`${label}: "${item.text}" cortado`);
      // No celular o alvo é o dedo. WCAG 2.5.8 pede 24px; 28px passava e
      // continuava apertado numa lista que se percorre rolando.
      const minimum = width < 640 ? 40 : 24;
      if (item.h < minimum) {
        actionProblems.push(`${label}: "${item.text}" ${item.h}px < ${minimum}px`);
      }
    }
  }
  check(
    "ações do card têm largura igual e alvo de toque adequado",
    actionProblems.length === 0,
    actionProblems.slice(0, 4).join(" | "),
  );
  await page.setViewportSize({ width: 1280, height: 900 });


  /* ---------------------- Histórico de versões do CV ----------------------- */

  // As regras (não excluir a atual, não excluir versão citada pelo funil,
  // restaurar acrescentando) estão travadas em `tests/candidate-versions.test.ts`,
  // onde é barato exercitá-las. O que só o browser responde é se o modal abre,
  // prende o foco, fecha no Escape — e se o botão destrutivo simplesmente NÃO
  // existe na linha da versão atual, que é a defesa que o usuário enxerga.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const historyTrigger = page.locator('button:has-text("histórico")').first();
  check("botão de histórico presente", (await historyTrigger.count()) > 0);

  if ((await historyTrigger.count()) > 0) {
    await historyTrigger.click();
    const dialog = page.locator("dialog[open]");
    check("modal de versões abre", (await dialog.count()) === 1);

    // `<dialog>` nativo move o foco para dentro ao abrir com `showModal()`.
    const focusInside = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      return Boolean(d && d.contains(document.activeElement));
    });
    check("modal prende o foco", focusInside);

    const rows = dialog.locator("li");
    const rowCount = await rows.count();
    check("modal lista as versões", rowCount > 0, `${rowCount} versão(ões)`);

    // A linha da versão atual não pode oferecer excluir nem restaurar.
    const currentRow = rows.filter({ hasText: "atual" }).first();
    if ((await currentRow.count()) > 0) {
      const destructive = await currentRow.locator('button:has-text("Excluir")').count();
      const restore = await currentRow.locator('button:has-text("Restaurar")').count();
      check("versão atual não oferece excluir nem restaurar", destructive === 0 && restore === 0);
    }

    // Visualizar carrega o conteúdo pela ação de servidor.
    await rows.first().locator('button:has-text("Ver")').first().click();
    // `data-testid` e não um seletor por atributo genérico: `data-user-content`
    // também marca o rótulo da versão, e a primeira medição pegou os 40
    // caracteres do rótulo achando que era o documento.
    await page.waitForSelector('[data-testid="version-view"]', { timeout: 5000 });
    const viewed = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="version-view"]');
      return (panel?.textContent ?? "").trim().length;
    });
    check("visualizar mostra o conteúdo da versão", viewed > 50, `${viewed} caracteres`);

    await page.keyboard.press("Escape");
    check("modal fecha com Escape", (await page.locator("dialog[open]").count()) === 0);
  }


  // Volta ao padrão para não deixar o cookie sujo para a próxima execução.
  await page.context().addCookies([
    { name: "jho_theme", value: "hp", url: BASE },
    { name: "jho_mode", value: "system", url: BASE },
  ]);

  /* --------------------------------- Idioma -------------------------------- */

  // Traduzir é fácil de começar e fácil de deixar pela metade: a interface fica
  // 80% em inglês e ninguém percebe as 20% restantes até um usuário reclamar.
  //
  // A PRIMEIRA versão deste teste procurava uma lista de palavras portuguesas
  // escrita à mão. Ela passava com "Editar", "Dividido", "Visualizar",
  // "Vocabulário" e "Práticas" na tela — nenhuma estava na lista, porque a
  // lista era o inventário do que eu já tinha corrigido. Um teste assim
  // confirma a correção anterior e não detecta a próxima.
  //
  // Agora o critério é estrutural, em duas frentes:
  //
  //   1. Texto que É um valor do dicionário português. Exato, sem falso
  //      positivo, e cobre automaticamente toda string futura que passe pelo
  //      dicionário — que é para onde toda string de interface deve ir.
  //   2. Texto com marca gráfica que só o português tem (ã, õ, ç, acentos).
  //      Pega o que nunca chegou a dicionário nenhum, que é justamente o caso
  //      que a frente 1 não alcança.
  //
  // Conteúdo do usuário fica de fora: o currículo tem "São Paulo" e vai
  // continuar tendo com a interface em inglês. É para isso que as regiões de
  // dado do usuário carregam `data-user-content`.
  const { ptBR } = await import("../../src/core/i18n/pt-BR.ts");
  const { en } = await import("../../src/core/i18n/en.ts");

  const flatten = (dict) => Object.values(dict).flatMap((section) => Object.values(section));
  // Palavra igual nos dois idiomas ("Frameworks", "Referrals", "Cockpit") não é
  // vazamento — é a mesma palavra.
  const shared = new Set(flatten(en).map((v) => v.toLowerCase()));
  const portuguese = new Set(
    flatten(ptBR)
      .map((v) => v.toLowerCase())
      .filter((v) => v.length > 2 && !shared.has(v)),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  const leaks = [];
  for (const path of [
    "/",
    "/jobs",
    "/pipeline",
    "/referrals",
    "/candidate",
    "/candidate/skills",
    "/candidate/vocabulary",
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const found = await page.evaluate((dictionary) => {
      const known = new Set(dictionary);
      const accented = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/;
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (!parent || text.length < 3) continue;
        if (["SCRIPT", "STYLE"].includes(parent.tagName)) continue;
        if (parent.closest("[data-user-content]")) continue;
        // `lang` explícito e diferente da página é declaração deliberada, não
        // vazamento: o nome de um idioma se escreve no próprio idioma.
        const declared = parent.closest("[lang]");
        if (declared && declared !== document.documentElement) continue;
        if (known.has(text.toLowerCase())) out.push(`dicionário: ${text}`);
        else if (accented.test(text)) out.push(`acento: ${text}`);
      }
      return out;
    }, [...portuguese]);
    for (const text of found) leaks.push(`${path} · ${text.slice(0, 52)}`);
  }
  check(
    "interface em inglês não vaza português",
    leaks.length === 0,
    [...new Set(leaks)].slice(0, 8).join(" | "),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  /* --------------------------------- Logout -------------------------------- */

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="sign-out"]').click();
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  // Revogado no servidor, não só apagado do navegador.
  check("logout encerra a sessão de verdade", page.url().includes("/login"), page.url());

  check("nenhum erro de console", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} catch (error) {
  // Um passo que estoura não pode apagar o relatório do que já passou: sem
  // isto, a suíte inteira vira um stack trace e some a informação de onde
  // exatamente parou.
  check("suíte concluiu sem exceção", false, String(error).split("\n")[0].slice(0, 120));
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed > 0 ? 1 : 0);
