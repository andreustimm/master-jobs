import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HEADLESS_UA,
  isHeadlessUA,
  renderNavigationTransitionCSS,
  renderSplashCSS,
  renderSplashHTML,
  renderSplashScript,
  SPLASH_FADE_MS,
  SPLASH_HIDDEN_CLASS,
  SPLASH_MAX_MS,
  SPLASH_MIN_MS,
  SPLASH_ROOT_ID,
  SPLASH_REFERENCE_KEY,
  TRANSITION_SPLASH_ROOT_ID,
} from "../src/core/pwa/splash.ts";
import { TRANSITION_MIN_MS, TRANSITION_PROLONGED_MS } from "../src/core/pwa/transition.ts";
import { isStandalone, renderStandaloneScript, STANDALONE_CLASS } from "../src/core/pwa/standalone.ts";
import { generatePwaArtifacts } from "../scripts/sw-version.mjs";
import {
  DEPLOYED_CSS_MARKERS,
  FORBIDDEN_DEPLOYED_CSS_MARKERS,
  inspectDeployedCss,
} from "../scripts/deployed-css-markers.mjs";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

const GLOBAL_CSS = readFileSync("app/globals.css", "utf8");
const DESIGN_TOKENS = readFileSync("app/design-tokens.css", "utf8");
const LAYOUT = readFileSync("app/layout.tsx", "utf8");

/**
 * A moldura de PWA: área segura e tela de abertura.
 *
 * ## O que dá para testar aqui, e o que não dá
 *
 * Os dois módulos produzem **texto** — HTML, CSS e um script que só roda no
 * navegador. Executar esse script exigiria um DOM falso, e o que se provaria
 * seria o comportamento do dublê, não o do aparelho. Então o que se afirma é o
 * contrato do texto gerado: os seletores existem, as durações batem entre o
 * script e o CSS, e os caminhos de saída estão todos escritos.
 *
 * A parte que ninguém testa daqui é a que só o celular responde: se o padding
 * de área segura de fato desce o cabeçalho abaixo do relógio. Isso se confere
 * com o aparelho na mão, e é onde o defeito apareceu.
 *
 * `isStandalone` é a exceção: é lógica pura, recebe as fontes por parâmetro, e
 * cada combinação é exercitada de verdade.
 */

describe("modo instalado", () => {
  it("deixa o conteúdo do cabeçalho crescer depois da área segura", () => {
    // `min-h-14` incluía o padding de safe area no próprio box. Com um inset
    // de 48px, sobravam só 8px para os controles e o texto flexível
    // transbordava para cima, sobre o relógio. Altura mínima de 64px mais o
    // `py-3` preserva o respiro em qualquer inset. O regex trava a fileira
    // inteira de uma vez — a mesma className não pode perder altura nem calha.
    expect(LAYOUT).not.toContain("flex h-14 w-full");
    expect(LAYOUT).not.toContain("flex h-16 w-full");
    expect(LAYOUT).toMatch(/min-h-16 w-full max-w-\[1760px\] items-center gap-2 px-4 py-3/);
  });

  it("nenhuma regra de área segura mira um cabeçalho fora do shell", () => {
    // O CSS que a produção chegou a servir tinha `body > header` — seletor da
    // era em que o `<header>` era filho direto do `<body>`. Ele parou de casar
    // quando o header entrou no `#application-shell`, e a PWA ficou sem
    // padding de topo sem nenhum teste reprovar, porque o seletor podre não
    // conflitava com nada. O verso dessa regressão fica travado aqui.
    expect(GLOBAL_CSS).not.toMatch(/html\.pwa-standalone\s+body\s*>\s*header/);
    expect(GLOBAL_CSS).not.toMatch(/pwa-standalone\s+body\s+header/);
  });

  it("marcadores do gate de deploy existem nas fontes que os alimentam", () => {
    // O gate pós-deploy (`scripts/check-deployed-css.mjs`) é a última linha de
    // defesa do incidente do CSS velho — mas sem este contrato, um marcador
    // digitado errado ou removido numa refatoração legítima só explode no job
    // pós-deploy, dez minutos depois do merge. Aqui ele falha no `pnpm check`.
    // O match é por fonte, não por build minificado: cobre typo e remoção, os
    // riscos reais; o build em si é o que o gate confere em produção.
    const sources = GLOBAL_CSS + DESIGN_TOKENS + LAYOUT;
    // O compilador remove o espaço depois de `:` nas media queries. Normalizar
    // só esse detalhe permite usar no contrato o mesmo marcador exato que o
    // gate procura no CSS publicado.
    const deployShape = sources.replace(/:\s+/g, ":");
    for (const marker of DEPLOYED_CSS_MARKERS) {
      expect(deployShape, `marcador ${marker} deveria existir nas fontes`).toContain(marker);
    }
    for (const marker of FORBIDDEN_DEPLOYED_CSS_MARKERS) {
      expect(GLOBAL_CSS, `marcador obsoleto ${marker} não pode voltar`).not.toContain(marker);
    }
    expect(GLOBAL_CSS).not.toMatch(/html\.pwa-standalone\s+body\s*>\s*div/);
  });

  it("rejeita uma folha completa que ainda contém o seletor obsoleto", () => {
    const currentCss = DEPLOYED_CSS_MARKERS.join("\n");
    const result = inspectDeployedCss(
      `${currentCss}\n${FORBIDDEN_DEPLOYED_CSS_MARKERS[0]}`,
    );

    expect(result.missing).toEqual([]);
    expect(result.forbidden).toEqual(FORBIDDEN_DEPLOYED_CSS_MARKERS);
  });

  it("reserva a área segura só no cabeçalho da aplicação", () => {
    // Um seletor global de `header` também zera o padding-top dos cabeçalhos
    // de página e das modais quando o Android abre em `minimal-ui`.
    expect(GLOBAL_CSS).toContain("html.pwa-standalone #application-shell > header {");
    expect(GLOBAL_CSS).toContain("html.pwa-standalone .app-shell-content {");
    expect(GLOBAL_CSS).toContain(
      "padding-left: max(var(--spacing-md), var(--safe-area-left));",
    );
    expect(GLOBAL_CSS).toContain(
      "padding-right: max(var(--spacing-md), var(--safe-area-right));",
    );
    expect(GLOBAL_CSS).toContain(
      "padding-left: max(var(--spacing-xl), var(--safe-area-left));",
    );
    expect(GLOBAL_CSS).toContain(
      "padding-left: max(var(--spacing-xxl), var(--safe-area-left));",
    );
    expect(GLOBAL_CSS).not.toMatch(/html\.pwa-standalone header\s*\{/);
    expect(GLOBAL_CSS).not.toMatch(/html\.pwa-standalone header\s*>\s*div/);
  });

  it("mantém a faixa do topo full bleed e só recua o conteúdo móvel", () => {
    expect(GLOBAL_CSS).toMatch(
      /#application-shell\s*>\s*header\s*\{[\s\S]*?inline-size:\s*100%/,
    );
    expect(GLOBAL_CSS).toContain(".app-shell-content {");
    expect(GLOBAL_CSS).toContain("padding-inline: 2.5vw;");
    expect(GLOBAL_CSS).toContain(
      "padding-left: max(2.5vw, var(--safe-area-left));",
    );
    expect(GLOBAL_CSS).toContain(
      "padding-right: max(2.5vw, var(--safe-area-right));",
    );
  });

  it("liga os tokens de área segura aos insets informados pelo aparelho", () => {
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(GLOBAL_CSS).toContain(
        `--safe-area-${edge}: env(safe-area-inset-${edge});`,
      );
    }
  });

  it("mantém o conteúdo do cabeçalho abaixo da barra do sistema quando o inset é zero", () => {
    const cabecalho = GLOBAL_CSS.indexOf("html.pwa-standalone #application-shell > header {");
    const inicio = GLOBAL_CSS.indexOf("@media (pointer: coarse)", cabecalho);
    const regra = GLOBAL_CSS.slice(inicio, GLOBAL_CSS.indexOf("}\n}", inicio) + 3);

    // Alguns launchers instalados entregam `safe-area-inset-top: 0` mesmo
    // desenhando a barra de status sobre o viewport. O token deixa o caso
    // simulável no browser e o espaçamento do DESIGN.md é o piso que impede o
    // relógio de voltar a cobrir a marca.
    expect(regra).toContain(
      "padding-top: max(var(--safe-area-top), var(--safe-area-top-floor));",
    );
  });

  it("remove o piso artificial em paisagem baixa e preserva o inset real", () => {
    // Em retrato alguns launchers desenham a barra de status sobre o viewport
    // mesmo entregando inset zero, por isso o piso continua necessário. Em
    // paisagem de telefone a barra desaparece: manter 48px ali transforma a
    // proteção do retrato numa faixa vazia desproporcional.
    expect(DESIGN_TOKENS).toContain("--safe-area-top-floor: 48px;");
    const media = "@media (pointer: coarse) and (orientation: landscape) and (max-width: 1023px) and (max-height: 500px) {";
    const inicio = GLOBAL_CSS.indexOf(media);
    const regra = GLOBAL_CSS.slice(inicio, GLOBAL_CSS.indexOf("\n}\n", inicio) + 3);
    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(regra).toContain("html.pwa-standalone #application-shell > header {");
    expect(regra).toContain("padding-top: var(--safe-area-top);");
  });

  it("não cria faixa de safe area na PWA instalada do desktop", () => {
    const inicio = GLOBAL_CSS.indexOf("html.pwa-standalone #application-shell > header {");
    const regra = GLOBAL_CSS.slice(inicio, GLOBAL_CSS.indexOf("}", inicio) + 1);

    expect(regra).toContain("padding-top: var(--safe-area-top);");
    expect(regra).not.toContain("--spacing-xxl");
  });

  it("iOS antigo é reconhecido por navigator.standalone", () => {
    // Aparelho da era em que `display-mode` ainda não existia. Sem este ramo,
    // o app instalado no iPhone antigo ficaria com o conteúdo sob a barra.
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
  });

  it("os três display-modes contam como instalado", () => {
    for (const modo of ["standalone", "minimal-ui", "fullscreen"]) {
      const matchMedia = (q: string) => ({ matches: q.includes(modo) });
      expect(isStandalone({ matchMedia })).toBe(true);
    }
  });

  it("navegador comum não é instalado", () => {
    // O ramo que importa mais: um falso positivo aqui põe padding de área
    // segura numa aba de navegador, que já reserva o espaço — e o resultado é
    // uma faixa vazia no topo de toda página.
    expect(isStandalone({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("sem matchMedia e sem navigator.standalone, assume navegador", () => {
    // Ambiente sem as duas fontes. Assumir instalado seria escolher o defeito
    // visível; assumir navegador é a opção que não estraga nada.
    expect(isStandalone({})).toBe(false);
  });

  it("o script marca o html com a classe que o CSS espera", () => {
    const script = renderStandaloneScript();

    expect(script).toContain(JSON.stringify(STANDALONE_CLASS));
    expect(script).toContain("document.documentElement.classList.add");
    expect(script).toContain("navigator.standalone===true");
    for (const mode of ["standalone", "minimal-ui", "fullscreen"]) {
      expect(script).toContain(`(display-mode: ${mode})`);
    }
    // Envolto em try: `matchMedia` ausente não pode derrubar o documento. O
    // custo de falhar aqui é o padding não aparecer; o de estourar é a página
    // em branco.
    expect(script).toContain("try{");
    expect(script).toContain("catch(e){}");
  });
});

describe("tela de abertura", () => {
  it("o HTML carrega o rótulo traduzido e não a marca no leitor de tela", () => {
    const html = renderSplashHTML("Carregando o Master Jobs");

    expect(html).toContain(`id="${SPLASH_ROOT_ID}"`);
    expect(html).toContain('aria-label="Carregando o Master Jobs"');
    // Quem usa leitor recebe "carregando" uma vez, e não marca + ícone +
    // girador em sequência.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("reaproveita o ícone do manifest em vez de pedir outro arquivo", () => {
    // Uma requisição a mais bem no momento em que a página tenta aparecer é o
    // oposto do que a splash existe para resolver.
    expect(renderSplashHTML("x")).toContain("/icons/icon-192.png");
  });

  it("o CSS cobre a tela inteira, respeita a área segura e some pela classe", () => {
    const css = renderSplashCSS();

    expect(css).toContain(`#${SPLASH_ROOT_ID}{position:fixed;inset:0`);
    // A splash também fica sob o recorte: sem isto o ícone nasceria centrado
    // numa área que exclui o topo, e saltaria ao sair.
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain(`.${SPLASH_HIDDEN_CLASS}{opacity:0`);
  });

  it("a duração do fade é a mesma no CSS e no script", () => {
    // Se divergirem, o elemento sai do DOM antes de terminar de desaparecer —
    // um corte seco no lugar da transição. É o tipo de defeito que só aparece
    // em rede rápida.
    expect(renderSplashCSS()).toContain(`${SPLASH_FADE_MS}ms`);
    expect(renderSplashScript()).toContain(`fadeMs=${SPLASH_FADE_MS}`);
  });

  it("movimento reduzido desliga a animação, sem esconder o indicador", () => {
    const css = renderSplashCSS();

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // A barra continua visível, parada: quem pediu menos movimento ainda
    // precisa saber que algo está carregando.
    expect(css).toMatch(/prefers-reduced-motion[^}]*}[^@]*animation:none/);
  });

  it("o script tem os três caminhos de saída", () => {
    const script = renderSplashScript();

    // Documento pronto: espera o mínimo e sai.
    expect(script).toContain(`minMs=${SPLASH_MIN_MS}`);
    expect(script).toContain("DOMContentLoaded");
    // Teto absoluto: rede pendurada ou listener que nunca dispara não podem
    // deixar a splash presa para sempre.
    expect(script).toContain(`setTimeout(tirar,maxMs)`);
    expect(script).toContain(`maxMs=${SPLASH_MAX_MS}`);
    // Guarda contra os três dispararem juntos — o documento pode ficar pronto
    // no mesmo quadro em que o teto vence.
    expect(script).toContain("if(removida)return;removida=true");
    expect(script).toContain(JSON.stringify(SPLASH_REFERENCE_KEY));
    expect(script).toContain("var el=splash;if(!el)return");
    expect(script).not.toContain("var el=document.getElementById(id)");
  });

  it("o script também remove a splash se ele próprio estourar", () => {
    const script = renderSplashScript();
    const catchBlock = script.slice(script.lastIndexOf("catch(e)"));

    // O último recurso. Um erro dentro do próprio script deixaria a tela
    // coberta permanentemente — pior que nunca ter tido splash.
    expect(catchBlock).toContain("removeChild");
  });

  it("navegador de automação não vê a splash", () => {
    for (const ua of ["HeadlessChrome/120", "Playwright/1.4", "jsdom/22", "Cypress"]) {
      expect(isHeadlessUA(ua)).toBe(true);
    }
    // Sem esta saída, todo teste de ponta a ponta passaria os primeiros 900ms
    // clicando no que está atrás da splash.
    expect(renderSplashScript()).toContain(HEADLESS_UA.toString());
  });

  it("navegador de gente não cai no ramo de automação", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    expect(isHeadlessUA(chrome)).toBe(false);
    expect(isHeadlessUA("")).toBe(false);
  });

  it("a duração mínima é menor que o teto", () => {
    // Invertidos, a splash sairia pelo teto antes do mínimo e o mínimo nunca
    // teria efeito — a aritmética some sem nenhum sintoma visível.
    expect(SPLASH_MIN_MS).toBeLessThan(SPLASH_MAX_MS);
    expect(SPLASH_FADE_MS).toBeLessThan(SPLASH_MIN_MS);
  });

  it("UT-031 compartilha semântica, safe areas, contenção e redução de movimento", () => {
    const transition = GLOBAL_CSS.slice(GLOBAL_CSS.indexOf(".navigation-transition {"));

    for (const token of ["--background", "--foreground", "--primary", "--safe-area-top"]) {
      expect(transition).toContain(`var(${token})`);
    }
    expect(transition).toContain("overflow-wrap: anywhere");
    expect(transition).toContain("min-block-size: 100dvh");
    expect(GLOBAL_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(GLOBAL_CSS).toMatch(/prefers-reduced-motion: reduce[\s\S]*navigation-transition[\s\S]*animation: none/);
    expect(GLOBAL_CSS).toMatch(/prefers-reduced-motion: reduce[\s\S]*navigation-transition[\s\S]*transition: none/);
    expect(transition).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("UT-032 preserva o ciclo e a raiz de startup separados da transição", () => {
    const html = renderSplashHTML("x");
    const rootMatches = html.match(new RegExp(`id="${SPLASH_ROOT_ID}"`, "g")) ?? [];

    expect(SPLASH_MIN_MS).toBe(900);
    expect(TRANSITION_MIN_MS).toBe(180);
    expect(TRANSITION_PROLONGED_MS).toBe(3000);
    expect(TRANSITION_SPLASH_ROOT_ID).not.toBe(SPLASH_ROOT_ID);
    expect(rootMatches).toHaveLength(1);
    expect(renderSplashScript()).toContain(HEADLESS_UA.toString());
  });
});

describe("loading de navegação", () => {
  it("tem uma camada crítica inline fixa e centralizada enquanto o CSS da app chega", () => {
    const css = renderNavigationTransitionCSS();
    const layout = readFileSync("app/layout.tsx", "utf8");

    expect(css).toContain(`#${TRANSITION_SPLASH_ROOT_ID}{position:fixed;inset:0`);
    expect(css).toContain("display:flex;flex-direction:column;align-items:center;justify-content:safe center");
    expect(css).toContain("min-height:100dvh");
    expect(css).toContain("box-sizing:border-box");
    expect(css).toContain(".navigation-transition__content{display:flex;inline-size:100%;min-inline-size:0;max-inline-size:100%;flex-direction:column;align-items:center;text-align:center");
    expect(layout).toContain("renderNavigationTransitionCSS()");
  });
});

const PRIVATE_MARKERS = [
  "PRIVATE_EMAIL_MARKER",
  "PRIVATE_CV_MARKER",
  "PRIVATE_JOB_MARKER",
  "PRIVATE_APPLICATION_MARKER",
  "PRIVATE_SALARY_MARKER",
  "PRIVATE_RESET_TOKEN_MARKER",
  "REVOCABLE_PROFILE_MARKER",
];

type BrowserFixture = {
  browser: Browser;
  server: Server;
  origin: string;
  offlineCookies: string[];
  setWorkerRevision(revision: string): void;
};

async function startBrowserFixture(): Promise<BrowserFixture> {
  generatePwaArtifacts({ revision: "browser-contract" });
  let worker = readFileSync("public/sw.js");
  const offline = readFileSync("public/offline.html");
  const lifecycleModule = stripTypeScriptTypes(
    readFileSync("src/core/pwa/service-worker-update.ts", "utf8"),
    { mode: "transform" },
  );
  const offlineCookies: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/rsc-fail" || url.pathname === "/navigation-fail") {
      request.socket.destroy();
      return;
    }
    if (url.pathname === "/sw.js") {
      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
        "service-worker-allowed": "/",
      });
      response.end(worker);
      return;
    }
    if (url.pathname === "/service-worker-update.js") {
      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(lifecycleModule);
      return;
    }
    if (url.pathname === "/lifecycle") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`<!doctype html>
        <title>service worker lifecycle</title>
        <main>online</main>
        <script>
          sessionStorage.setItem(
            "lifecycle-loads",
            String(Number(sessionStorage.getItem("lifecycle-loads") ?? "0") + 1),
          );
        </script>
        <script type="module">
          import { startServiceWorkerUpdateLifecycle } from "/service-worker-update.js";
          startServiceWorkerUpdateLifecycle({
            container: navigator.serviceWorker,
            visibility: document,
            reload: () => location.reload(),
            report: (error) => { window.__lifecycleError = String(error); },
          });
          window.__lifecycleReady = true;
        </script>`);
      return;
    }
    if (url.pathname === "/offline.html") {
      const cookie = request.headers.cookie ?? "";
      offlineCookies.push(cookie);
      if (cookie) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<h1>${PRIVATE_MARKERS[0]}</h1>`);
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(offline);
      }
      return;
    }
    if (url.pathname === "/manifest.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"name":"Master Jobs"}');
      return;
    }
    if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/static/")) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end("PUBLIC_STATIC_BODY");
      return;
    }
    const markerByPath = new Map([
      ["/login", PRIVATE_MARKERS[0]],
      ["/candidate", PRIVATE_MARKERS[1]],
      ["/jobs.json", PRIVATE_MARKERS[2]],
      ["/applications/1", PRIVATE_MARKERS[3]],
      ["/salary", PRIVATE_MARKERS[4]],
      ["/reset/private", PRIVATE_MARKERS[5]],
      ["/p/slug", PRIVATE_MARKERS[6]],
      ["/api/export", PRIVATE_MARKERS.join("|")],
      ["/unknown-authenticated-route", PRIVATE_MARKERS.join("|")],
    ]);
    const marker = markerByPath.get(url.pathname);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(marker ? `<main>${marker}</main>` : "<!doctype html><title>fixture</title><main>online</main>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("browser fixture has no port");
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    await closeFixtureServer(server);
    throw error;
  }
  return {
    browser,
    server,
    origin: `http://127.0.0.1:${address.port}`,
    offlineCookies,
    setWorkerRevision(revision: string) {
      generatePwaArtifacts({ revision });
      worker = readFileSync("public/sw.js");
    },
  };
}

async function closeFixtureServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function stopBrowserFixture(fixture: BrowserFixture): Promise<void> {
  await fixture.browser.close();
  await closeFixtureServer(fixture.server);
}

async function controlledPage(context: BrowserContext, origin: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${origin}/fixture`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return page;
}

async function cacheAudit(page: Page) {
  return page.evaluate(async () => {
    const entries: Array<{ cache: string; url: string; body: string }> = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ cache: cacheName, url: request.url, body: response ? await response.text() : "" });
      }
    }
    return entries;
  });
}

// The browser contract is opt-in because `pnpm check` runs 140+ coverage files
// in parallel. Reading `process.argv` here is not stable across Vitest workers;
// the explicit CI/package gate owns both the environment flag and Chromium.
const browserGateRequested = process.env.npm_lifecycle_event === "test:pwa-browser"
  || process.env.JHO_PWA_BROWSER_TESTS === "1";

const describeBrowser = browserGateRequested
  ? describe.sequential
  : describe.skip;

let browserSuiteStarted = false;
afterAll(() => {
  if (browserGateRequested) expect(browserSuiteStarted).toBe(true);
});

describeBrowser("real browser service-worker privacy boundary", () => {
  let fixture: BrowserFixture;

  beforeAll(async () => {
    browserSuiteStarted = true;
    fixture = await startBrowserFixture();
  }, 20_000);

  afterAll(async () => {
    if (fixture) await stopBrowserFixture(fixture);
  });

  it("IT-006 installs offline.html credentiallessly and storage refusal degrades to plain 503", async () => {
    const context = await fixture.browser.newContext();
    await context.addCookies([{
      name: "jho_session",
      value: PRIVATE_MARKERS[0]!,
      url: fixture.origin,
    }]);
    const page = await controlledPage(context, fixture.origin);
    expect(fixture.offlineCookies.at(-1)).toBe("");
    const shell = (await cacheAudit(page)).find((entry) => new URL(entry.url).pathname === "/offline.html");
    expect(shell?.body).toContain(ptBR.transition.offlineTitle);
    expect(shell?.body).not.toContain(PRIVATE_MARKERS[0]);
    await context.close();

    const refused = await fixture.browser.newContext();
    const refusedPage = await refused.newPage();
    const cdp = await refused.newCDPSession(refusedPage);
    await cdp.send("Storage.overrideQuotaForOrigin", { origin: fixture.origin, quotaSize: 1 });
    await refusedPage.goto(`${fixture.origin}/fixture`);
    await refusedPage.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await refusedPage.reload();
    await refusedPage.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const fallback = await refusedPage.goto(`${fixture.origin}/navigation-fail`, {
      waitUntil: "domcontentloaded",
    });
    expect(fallback?.status()).toBe(503);
    expect(await refusedPage.locator("body").textContent()).toBe("Offline.");
    await refused.setOffline(false);
    await refusedPage.goto(`${fixture.origin}/fixture`);
    expect(await refusedPage.locator("main").textContent()).toBe("online");
    await refused.close();
  }, 30_000);

  it("IT-007 rejects RSC failure and notifies only the initiating controlled client", async () => {
    const context = await fixture.browser.newContext();
    const initiator = await controlledPage(context, fixture.origin);
    const observer = await context.newPage();
    await observer.goto(`${fixture.origin}/fixture`);
    await observer.waitForFunction(() => navigator.serviceWorker.controller !== null);
    for (const page of [initiator, observer]) {
      await page.evaluate(() => {
        const target = window as typeof window & { __workerMessages?: unknown[] };
        target.__workerMessages = [];
        navigator.serviceWorker.addEventListener("message", (event) => target.__workerMessages?.push(event.data));
      });
    }
    const rejected = await initiator.evaluate(async () => {
      try {
        await fetch("/rsc-fail?screen=%2Fjobs%2F1&_rsc=transport", { headers: { RSC: "1" } });
        return false;
      } catch {
        return true;
      }
    });
    await initiator.waitForFunction(() => {
      const target = window as typeof window & { __workerMessages?: unknown[] };
      return target.__workerMessages?.length === 1;
    });
    const initiatingMessages = await initiator.evaluate(() =>
      (window as typeof window & { __workerMessages?: unknown[] }).__workerMessages ?? []
    );
    const observerMessages = await observer.evaluate(() =>
      (window as typeof window & { __workerMessages?: unknown[] }).__workerMessages ?? []
    );
    expect(rejected).toBe(true);
    expect(initiatingMessages).toEqual([{
      type: "navigation-offline",
      url: "/rsc-fail?screen=%2Fjobs%2F1",
    }]);
    expect(observerMessages).toEqual([]);
    await context.close();
  }, 20_000);

  it("IT-008 keeps seeded private markers out of real Cache Storage keys and bodies", async () => {
    const context = await fixture.browser.newContext();
    const page = await controlledPage(context, fixture.origin);
    await page.evaluate(async () => {
      await Promise.all([
        "/login",
        "/candidate",
        "/jobs.json",
        "/applications/1",
        "/salary",
        "/reset/private",
        "/p/slug",
        "/api/export",
        "/unknown-authenticated-route",
        "/_next/static/chunk.js",
      ].map((path) => fetch(path)));
    });
    const entries = await cacheAudit(page);
    const persisted = JSON.stringify(entries);
    for (const marker of PRIVATE_MARKERS) expect(persisted).not.toContain(marker);
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    expect(paths).not.toContain("/login");
    expect(paths).not.toContain("/p/slug");
    expect(paths).not.toContain("/jobs.json");
    expect(paths).toContain("/offline.html");
    expect(paths).toContain("/_next/static/chunk.js");
    expect(entries.every((entry) => /^(?:static|shell)-/.test(entry.cache))).toBe(true);
    await context.close();
  }, 20_000);

  it("IT-009 leaves APIs, JSON, unknown routes, and RSC payloads network-only", async () => {
    const context = await fixture.browser.newContext();
    const page = await controlledPage(context, fixture.origin);
    const onlineBodies = await page.evaluate(async () => Promise.all([
      "/api/export",
      "/jobs.json",
      "/unknown-authenticated-route",
    ].map(async (path) => ({ path, body: await (await fetch(path)).text() }))));
    expect(onlineBodies.every(({ body }) => body.includes("PRIVATE_"))).toBe(true);
    const rscRejected = await page.evaluate(async () => {
      try {
        const response = await fetch("/rsc-fail", { headers: { RSC: "1" } });
        return { rejected: false, contentType: response.headers.get("content-type"), body: await response.text() };
      } catch {
        return { rejected: true, contentType: null, body: "" };
      }
    });
    expect(rscRejected).toEqual({ rejected: true, contentType: null, body: "" });
    const entries = await cacheAudit(page);
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    expect(paths).not.toContain("/api/export");
    expect(paths).not.toContain("/jobs.json");
    expect(paths).not.toContain("/unknown-authenticated-route");
    expect(paths).not.toContain("/rsc-fail");
    await context.close();
  }, 20_000);

  it("IT-010 activates a new worker revision and reloads the controlled page once", async () => {
    fixture.setWorkerRevision("revision-a-browser");
    const context = await fixture.browser.newContext();
    const page = await context.newPage();

    await page.goto(`${fixture.origin}/lifecycle`);
    await page.waitForFunction(() => Boolean((window as typeof window & {
      __lifecycleReady?: boolean;
    }).__lifecycleReady));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    expect(await page.evaluate(() => sessionStorage.getItem("lifecycle-loads"))).toBe("2");

    fixture.setWorkerRevision("revision-b-browser");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => sessionStorage.getItem("lifecycle-loads") === "3");

    expect(await page.evaluate(() => sessionStorage.getItem("lifecycle-loads"))).toBe("3");
    expect(await page.evaluate(() => (window as typeof window & {
      __lifecycleError?: string;
    }).__lifecycleError)).toBeUndefined();
    expect(await page.evaluate(() => caches.keys())).toEqual(
      expect.arrayContaining([expect.stringContaining("revisionbbro")]),
    );
    await context.close();
  }, 30_000);
});
