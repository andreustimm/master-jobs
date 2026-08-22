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
 * `pnpm test:e2e` owns an isolated build, server and database. To target an
 * already-running environment deliberately, set E2E_BASE and
 * TURSO_DATABASE_URL and run `pnpm test:e2e:external`.
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
let comparisonJobId = null;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];

/**
 * Erros que ESTE arquivo provoca de propósito.
 *
 * A verificação de impersonação abre `/admin/users` com sessão emprestada para
 * provar que a política nega — e o 403 que ela espera aparece no console como
 * recurso que falhou. Contá-lo como defeito faria o teste reprovar justamente
 * quando funciona.
 *
 * Estreito de propósito: só 403, e só de rede. Um `pageerror` continua contando,
 * e um 500 também — que é o que apareceu aqui antes de `requirePage` passar a
 * responder 403 em vez de deixar a exceção subir.
 */
const EXPECTED_CONSOLE = /Failed to load resource.*403/i;

page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text().slice(0, 200);
  if (EXPECTED_CONSOLE.test(text)) return;
  consoleErrors.push(text);
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

  for (const path of ["/", "/compare", "/candidate", "/pipeline", "/referrals", "/login"]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${path} responde`, response?.status() === 200, String(response?.status()));
  }

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  check("comparar vaga oferece descrição", (await page.locator('textarea[name="description"]').count()) === 1);
  check("comparar vaga oferece upload", (await page.locator('input[name="file"][type="file"]').count()) === 1);
  check("comparar vaga envia pela ação", (await page.locator('[data-testid="compare-submit"]').count()) === 1);

  const comparisonText =
    "Senior AI Software Architect responsible for TypeScript and Python services, distributed systems, LLM products, cloud architecture, observability, technical leadership, and remote delivery for teams in Brazil and LATAM.";
  const fillComparisonIdentity = async () => {
    await page.fill('input[name="title"]', "Senior AI Software Architect E2E");
    await page.fill('input[name="companyName"]', "E2E Comparison Lab");
    await page.fill('input[name="location"]', "Remote · Brazil");
    await page.fill('input[name="url"]', "https://e2e.invalid/comparison");
  };

  await fillComparisonIdentity();
  await page.fill('textarea[name="description"]', comparisonText);
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  comparisonJobId = Number(new URL(page.url()).searchParams.get("job"));
  check("comparação colada persiste e redireciona", /[?&]job=\d+/.test(page.url()), page.url());
  check("comparação exibe score canônico", (await page.locator('[data-testid="comparison-score"]').count()) === 1);
  check("comparação exibe cobertura do currículo", (await page.locator('[data-testid="comparison-cv-coverage"]').count()) === 1);

  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await fillComparisonIdentity();
  await page.locator('input[name="file"]').setInputFiles({
    name: "e2e-job.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`${comparisonText}\nUploaded through the real multipart form.`),
  });
  await Promise.all([
    page.waitForURL(/\/compare\?job=\d+#comparison-result/, { timeout: 15_000 }),
    page.locator('[data-testid="compare-submit"]').click(),
  ]);
  await page.locator('[data-testid="comparison-result"]').waitFor();
  check(
    "upload percorre extração, persistência e score",
    (await page.locator('[data-testid="comparison-result"]').textContent())?.includes("e2e-job.txt") ?? false,
  );

  await page.setViewportSize({ width: 375, height: 812 });
  const resultOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("resultado da comparação cabe no celular", resultOverflow <= 1, `${resultOverflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* --------------------------------- Mobile -------------------------------- */

  // Rolagem horizontal é a falha que passa despercebida no desktop, porque só
  // aparece quando a janela é estreita o bastante para o conteúdo não caber.
  const widths = [375, 390, 412, 768];
  const overflows = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of ["/", "/jobs", "/compare", "/candidate", "/candidate/skills", "/pipeline"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) overflows.push(`${width}px ${path}: ${overflow}px`);
    }
  }
  check("sem rolagem horizontal em nenhuma largura", overflows.length === 0, overflows.slice(0, 3).join(" · "));

  await page.setViewportSize({ width: 1280, height: 900 });

  /* ------------------------- Menu mobile fecha ao navegar ------------------------ */

  await page.setViewportSize({ width: 375, height: 812 });

  // Abre pelo botão do hambúrguer. O popover nativo é `#menu-mobile`.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile abre ao tocar no botão", await page.locator("#menu-mobile").isVisible());

  // Fecha com Escape — o light dismiss nativo não pode ter regredido.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("menu mobile fecha com Escape", !(await page.locator("#menu-mobile").isVisible()));

  // Fecha ao clicar fora — idem.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(200, 700);
  await page.waitForTimeout(250);
  check("menu mobile fecha ao tocar fora", !(await page.locator("#menu-mobile").isVisible()));

  // O defeito em si: clicar num item navega e o menu precisa fechar.
  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  await page.locator('#menu-mobile a[href="/jobs"]').click();
  await page.waitForURL("**/jobs", { timeout: 10000 });
  await page.waitForTimeout(250);
  check("menu mobile fecha ao navegar por um item", !(await page.locator("#menu-mobile").isVisible()));

  // Reabertura imediata: sem estado residual do fechamento por navegação.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile reabre sem estado residual", await page.locator("#menu-mobile").isVisible());
  await page.keyboard.press("Escape");

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


  /* -------------------- Reconferência: botão e enfileiramento -------------- */

  // Vaga não é permanente, e a sincronização não descobre isso sozinha: várias
  // fontes seguem listando anúncio morto. Medido ao ligar esta fila: 16% dos
  // links do Lever entre os melhores ranqueados devolviam 404.
  //
  // O que só o browser responde é se o clique enfileira de verdade e se o botão
  // passa a dizer isso. As regras de classificação (só 404/410 fecham) estão em
  // `tests/verify-queue.test.ts`, onde não precisam de rede.
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  const recheckModalId = await page.evaluate(() => {
    for (const trigger of document.querySelectorAll("button[popovertarget^='job-modal']")) {
      const id = trigger.getAttribute("popovertarget");
      if (id && document.getElementById(id)?.querySelector('[data-testid="recheck-job"]')) {
        return id;
      }
    }
    return null;
  });
  if (recheckModalId) {
    await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
  }
  await page.waitForTimeout(300);

  const recheckBefore = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  check("botão de reconferir presente no detalhe", recheckBefore.label !== null, `${recheckBefore.label}`);

  if (recheckBefore.label && !recheckBefore.disabled) {
    await page.locator('[id^="job-modal"]:popover-open [data-testid="recheck-job"]').click();
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    if (recheckModalId) {
      await page.locator(`button[popovertarget="${recheckModalId}"]`).first().click();
    }
    await page.waitForTimeout(300);
  }

  const recheckAfter = await page.evaluate(() => {
    const button = document.querySelector('[id^="job-modal"]:popover-open [data-testid="recheck-job"]');
    return { label: button?.textContent?.trim() ?? null, disabled: button?.disabled ?? null };
  });
  // Enfileirado, o botão desabilita: clicar de novo só duplicaria trabalho
  // contra site de terceiro, que é como se toma bloqueio.
  check(
    "reconferir enfileira e desabilita o botão",
    recheckAfter.disabled === true,
    `${recheckAfter.label}`,
  );


  /* ------------------- Visibilidade do perfil do candidato ----------------- */

  // A escolha que decide se um currículo é legível pela internet inteira. O
  // teste vai e volta para não deixar o perfil exposto se falhar no meio.
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });

  const visibility = await page.evaluate(() => ({
    options: [...document.querySelectorAll('input[name="visibility"]')].map((i) => i.value),
    checked: document.querySelector('input[name="visibility"]:checked')?.value ?? null,
    warned: /legível por qualquer um/.test(document.body.textContent ?? ""),
  }));
  check(
    "candidato escolhe quem vê o perfil",
    visibility.options.join(",") === "private,recruiters,public",
    visibility.options.join(","),
  );
  // "Público" soa inofensivo; o que ele significa não. O aviso fica sempre
  // visível, inclusive para quem JÁ está público — que é quem mais precisa lê-lo.
  check("o que 'público' significa está escrito na tela", visibility.warned);

  const original = visibility.checked ?? "private";
  await page.check('input[name="visibility"][value="recruiters"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const saved = await page.evaluate(
    () => document.querySelector('input[name="visibility"]:checked')?.value ?? null,
  );
  check("a escolha persiste", saved === "recruiters", `${saved}`);

  // Devolve ao estado anterior: um teste que deixa o perfil mais exposto do que
  // encontrou é pior que teste nenhum.
  await page.check(`input[name="visibility"][value="${original}"]`);
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);


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
      allowed: ["/jobs", "/jobs/new"],
      // Sem escopo de candidato: currículo, funil e cockpit são de outra pessoa.
      denied: ["/candidate", "/pipeline", "/admin/users"],
    },
    {
      role: "candidato",
      email: "e2e-candidato@local.test",
      lands: "/",
      allowed: ["/", "/jobs", "/candidate", "/pipeline", "/jobs/new"],
      // Candidato puro não administra contas.
      denied: ["/admin/users"],
    },
  ];

  for (const scenario of ROLE_SCENARIOS) {
    const roleCtx = await browser.newContext();
    const rolePage = await roleCtx.newPage();
    await roleCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

    await rolePage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await rolePage.fill('input[name="email"]', scenario.email);
    await rolePage.fill('input[name="password"]', E2E_PASSWORD);
    await rolePage.locator('form button[type="submit"]').first().click();
    await rolePage.waitForTimeout(2000);

    const landed = rolePage.url().replace(BASE, "") || "/";
    check(
      `${scenario.role} entra e cai numa tela que é dele`,
      landed === scenario.lands,
      `caiu em ${landed}, esperado ${scenario.lands}`,
    );

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

    await roleCtx.close();
  }

  // Conta desabilitada não entra, mesmo com a senha certa.
  const offCtx = await browser.newContext();
  const offPage = await offCtx.newPage();
  await offCtx.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await offPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await offPage.fill('input[name="email"]', "e2e-desabilitada@local.test");
  await offPage.fill('input[name="password"]', E2E_PASSWORD);
  await offPage.locator('form button[type="submit"]').first().click();
  await offPage.waitForTimeout(1500);
  check(
    "conta desabilitada não entra nem com a senha certa",
    offPage.url().includes("/login"),
    offPage.url().replace(BASE, ""),
  );
  await offCtx.close();


  /* --------------------- Recuperação de senha (F-05) ----------------------- */

  // Percorrido de um contexto ANÔNIMO: quem esqueceu a senha não tem sessão, e
  // testar isto logado provaria outra coisa.
  const lost = await browser.newContext();
  const lostPage = await lost.newPage();
  await lost.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await lostPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check(
    "a tela de login oferece recuperar a senha",
    (await lostPage.locator('[data-testid="forgot-password"]').count()) === 1,
  );

  // Endereço que NÃO existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', "nao-existe-de-jeito-nenhum@local.test");
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const unknown = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // Endereço que existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', E2E_EMAIL);
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const known = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // O invariante inteiro da tela: um formulário que responde "não encontramos
  // esta conta" é um oráculo de enumeração aberto ao mundo — dá para descobrir
  // quem está cadastrado sem nunca entrar.
  check(
    "conta existente e inexistente recebem a MESMA resposta",
    unknown.url === known.url && unknown.text === known.text,
    `${unknown.url} vs ${known.url}`,
  );
  check(
    "a confirmação é redigida sem afirmar que a conta existe",
    /se existir uma conta/i.test(known.text),
    known.text.slice(0, 60),
  );

  // Link morto não vira 500 nem tela em branco.
  await lostPage.goto(`${BASE}/login/reset?token=nunca-existiu`, { waitUntil: "networkidle" });
  const dead = ((await lostPage.locator("main").textContent()) ?? "").trim();
  check("link de recuperação inválido explica o que fazer", /não vale mais/i.test(dead),
    dead.slice(0, 60));
  // E não oferece o formulário: um campo de senha sob um token morto convida a
  // digitar uma senha que não vai a lugar nenhum.
  check(
    "link morto não mostra o formulário de senha",
    (await lostPage.locator('input[name="password"]').count()) === 0,
  );

  await lost.close();



  /* ------------------ Cadastro de vaga com rótulo de origem ---------------- */

  // O acervo é global e `job:write` é dos três papéis; o que distingue esta
  // vaga não é quem a criou, é a fonte que ela cria — `recruiter:<host>`, de
  // onde o rótulo deriva na leitura.
  const newJob = await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle" });
  check("formulário de cadastro responde", newJob?.status() === 200, `${newJob?.status()}`);

  const marker = `Recrutador E2E ${Date.now()}`;
  await page.fill('input[name="title"]', "Staff AI Engineer");
  await page.fill('input[name="companyName"]', marker);
  await page.fill('input[name="location"]', "Remote · Brazil");
  await page.fill(
    'textarea[name="description"]',
    "Staff AI Engineer com LangGraph, Python, observability e liderança técnica. " +
      "Remoto no Brasil, contrato B2B. Equity e plano de saúde.",
  );
  // `data-testid` e não `button[type=submit]`: o primeiro submit da página é o
  // "sair" do cabeçalho, e o teste passou a fazer logout achando que cadastrava.
  await page.locator('[data-testid="post-job"]').click();
  await page.waitForURL(/\/jobs\/\d+/, { timeout: 20_000 }).catch(() => {});
  check("cadastrar leva à vaga criada", /\/jobs\/\d+/.test(page.url()), page.url());

  await page.goto(`${BASE}/jobs?q=${encodeURIComponent(marker)}`, { waitUntil: "networkidle" });
  const posted = await page.evaluate((needle) => {
    const article = [...document.querySelectorAll("article")].find((a) =>
      (a.textContent ?? "").includes(needle),
    );
    return { listed: Boolean(article), labelled: /recrutador/i.test(article?.textContent ?? "") };
  }, marker);

  // Pontuada na hora: sem score a vaga não entra em lista nenhuma e quem
  // cadastrou conclui que falhou.
  check("a vaga cadastrada aparece na lista", posted.listed);
  check("e vem rotulada como recrutador", posted.labelled);


  /* ---------------------- Portfólio público, sem sessão -------------------- */

  // A única rota que responde sem sessão. Verificada de um contexto ANÔNIMO —
  // testá-la com o cookie de sessão presente provaria outra coisa.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();

  const privateHit = await anonPage.goto(`${BASE}/p/default`, { waitUntil: "domcontentloaded" });
  // 404 e não 403: 403 confirmaria que o slug existe, e existência é informação.
  check("perfil não público responde 404 para anônimo", privateHit?.status() === 404,
    `${privateHit?.status()}`);

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  const publicHref = await page.evaluate(
    () => document.querySelector('a[href^="/p/"]')?.getAttribute("href") ?? null,
  );

  if (publicHref) {
    const publicHit = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("perfil público responde a quem não tem sessão", publicHit?.status() === 200,
      `${publicHit?.status()}`);

    const shown = await anonPage.evaluate(() => ({
      body: document.body.textContent ?? "",
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    }));
    // O que a página MOSTRA se corrige depois; o que ela VAZA não tem desfazer.
    check("perfil público não expõe e-mail", !/@zorbit|@local\.test/.test(shown.body));
    // Sem o segundo consentimento o currículo não sai, nem o piso salarial que
    // ele costuma conter — que é a posição de negociação do candidato.
    check("sem o segundo consentimento o currículo não sai", !/SUMMARY|EXPERIENCE/i.test(shown.body));
    // Alcançável sem sessão não é o mesmo que "quero aparecer no Google".
    check("perfil público pede noindex", shown.robots.includes("noindex"), shown.robots);
  } else {
    check("a tela mostra o endereço público", false, "link ausente");
  }

  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);
  if (publicHref) {
    const closed = await anonPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    check("voltar a privado fecha a porta na hora", closed?.status() === 404, `${closed?.status()}`);
  }
  await anon.close();


  /* -------------------- Administração e impersonação ----------------------- */

  // O ciclo inteiro de assumir identidade, porque cada peça dele pode passar
  // isolada e a combinação falhar. Foi o que aconteceu: o campo
  // `impersonated_by` não estava no INSERT, então a sessão emprestada era
  // indistinguível de uma normal — sem banner, com o menu de administração
  // intacto e com poder de admin. A política estava certa; o dado que ela lê
  // nunca chegava.
  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const adminPage = await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  check("admin alcança a administração de contas", adminPage?.status() === 200);

  const accountRows = await page.locator("li").count();
  check("administração lista as contas", accountRows > 0, `${accountRows} conta(s)`);

  // Conta-alvo dedicada, criada pelo setup. Antes era "a primeira que não é a
  // de teste", e numa base recém-criada não havia nenhuma — a verificação
  // passava por falta de alvo em vez de por funcionar.
  const target = page.locator("li").filter({ hasText: "e2e-alvo@local.test" }).first();
  const assume = target.locator('button:has-text("ASSUMIR"), button:has-text("Assumir")').first();

  if ((await assume.count()) > 0) {
    await assume.click();
    // Espera pelo RESULTADO, não por `networkidle`: uma Server Action com
    // redirect termina depois que a rede sossega, e a verificação corria antes
    // da página nova existir.
    await page.waitForSelector('[data-testid="stop-impersonating"]', { timeout: 15_000 })
      .catch(() => {});

    const borrowed = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sessão emprestada mostra o aviso", borrowed.banner);
    // Operar como outra pessoa sem perceber é como se escreve no dado errado.
    check("sessão emprestada esconde o menu de administração", borrowed.adminLink === false);

    const denied = await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
    // 403 e não 500: negação que parece crash mostra stack em desenvolvimento e
    // não distingue "não pode" de "quebrou".
    check("sessão emprestada recebe 403 na administração", denied?.status() === 403,
      `${denied?.status()}`);

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.click('[data-testid="stop-impersonating"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="stop-impersonating"]'),
      { timeout: 15_000 },
    ).catch(() => {});

    const restored = await page.evaluate(() => ({
      banner: Boolean(document.querySelector('[data-testid="stop-impersonating"]')),
      adminLink: [...document.querySelectorAll("nav a")].some((a) =>
        /usuários/i.test(a.textContent ?? ""),
      ),
    }));
    check("sair devolve o admin à própria sessão", !restored.banner && restored.adminLink);
  } else {
    check("há uma conta para assumir", false, "nenhuma conta além da de teste");
  }


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
    "/compare",
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

  /* ------------- Limite de requisição no portfólio (E-05, jornada) --------- */

  // T5 e T10 do contrato em
  // `.compozy/tasks/_archived/1787413356948-b5a25d70-perfil-publico-limite/_tests.md`.
  //
  // Um IP exclusivo isola esta prova das demais jornadas. O primeiro acesso
  // retorna 200; os 29 seguintes retornam 404. Juntos eles esgotam exatamente
  // o limite de 30, então a requisição seguinte só pode retornar 429 se 200 e
  // 404 realmente consumirem o mesmo balde.
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="public"]');
  await page.locator('[data-testid="save-visibility"]').click();
  await page.waitForTimeout(1200);

  const burstCtx = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "203.0.113.55" },
  });
  const burstPage = await burstCtx.newPage();

  let first = null;
  let blocked = null;
  const missingStatuses = [];
  if (publicHref) {
    first = await burstPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 29; i++) {
      const hit = await burstPage.goto(`${BASE}/p/varredura-${i}`, {
        waitUntil: "domcontentloaded",
      });
      missingStatuses.push(hit?.status());
    }
    blocked = await burstPage.goto(`${BASE}/p/varredura-bloqueada`, {
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
  await burstCtx.close();

  // Devolve ao estado anterior. Um teste que deixa o perfil publicado é pior
  // que teste nenhum.
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  await page.check('input[name="visibility"][value="private"]');
  await page.locator('[data-testid="save-visibility"]').click();

  /* --------------------------------- Logout -------------------------------- */

  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="sign-out"]').click();
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  // Revogado no servidor, não só apagado no navegador.
  check("logout encerra a sessão de verdade", page.url().includes("/login"), page.url());

  /* ------------------------------ PWA (UI-05) ------------------------------ */

  // O que a instalação exige precisa responder SEM sessão: um manifest atrás de
  // login não é lido por navegador nenhum, e o app simplesmente não oferece
  // instalar — sem erro, sem aviso.
  const pwaCtx = await browser.newContext();
  const pwaPage = await pwaCtx.newPage();

  const missing = [];
  for (const path of ["/manifest.json", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png", "/offline"]) {
    const hit = await pwaPage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    if (hit?.status() !== 200) missing.push(`${path}=${hit?.status()}`);
  }
  check("recursos da PWA respondem sem sessão", missing.length === 0, missing.join(" | "));

  await pwaPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const head = await pwaPage.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
    themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("media")),
  }));
  check("a página aponta para o manifest", head.manifest === "/manifest.json", `${head.manifest}`);
  // Duas cores porque o sistema tem tema claro e escuro; uma só deixaria a
  // barra do navegador escura sobre interface clara.
  check(
    "theme-color acompanha claro e escuro",
    head.themes.length === 2 && head.themes.every((m) => m?.includes("prefers-color-scheme")),
    head.themes.join(" | "),
  );

  // O service worker servido tem de trazer a VERSÃO, não o marcador. Com o
  // marcador literal todo cache se chamaria `static-__APP_VERSION__` e nenhum
  // deploy invalidaria coisa alguma.
  const swBody = await (await pwaPage.request.get(`${BASE}/sw.js`)).text();
  check(
    "o service worker servido traz a versão resolvida",
    !swBody.includes("__APP_VERSION__") && /CACHE_VERSION = "\d/.test(swBody),
    swBody.match(/CACHE_VERSION = "[^"]*"/)?.[0] ?? "ausente",
  );
  // E não guarda rota privada. A lista vive no template; aqui se confere que o
  // que foi servido é o que se pensa que foi.
  check(
    "o service worker servido exclui as rotas privadas",
    ["/api/", "/candidate", "/pipeline", "/p/"].every((p) => swBody.includes(`"${p}"`)),
  );

  await pwaCtx.close();

  check("nenhum erro de console", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} catch (error) {
  // Um passo que estoura não pode apagar o relatório do que já passou: sem
  // isto, a suíte inteira vira um stack trace e some a informação de onde
  // exatamente parou.
  check("suíte concluiu sem exceção", false, String(error).split("\n")[0].slice(0, 120));
} finally {
  await browser.close();

  // The browser flow intentionally creates a real first-class job. Remove only
  // that exact fixture so running the E2E against the local database does not
  // pollute the user's board. Production ingestion never uses this deletion.
  if (Number.isInteger(comparisonJobId) && comparisonJobId > 0) {
    const [{ and, eq }, { closeDb, getDb }, { job }] = await Promise.all([
      import("drizzle-orm"),
      import("../../src/core/db/client.ts"),
      import("../../src/core/db/schema.ts"),
    ]);
    const [fixture] = await getDb()
      .select({ id: job.id })
      .from(job)
      .where(
        and(
          eq(job.id, comparisonJobId),
          eq(job.companyName, "E2E Comparison Lab"),
          eq(job.sourceId, "manual:e2e.invalid"),
        ),
      )
      .limit(1);
    if (fixture) await getDb().delete(job).where(eq(job.id, fixture.id));
    closeDb();
  }
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed > 0 ? 1 : 0);
