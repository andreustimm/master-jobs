// Helpers que mais de uma área do E2E usa (#320). Viviam como `const` no meio
// de ui.mjs e eram lidos por seções posteriores; fatiado o arquivo, cada área
// os pede aqui em vez de depender de outra área ter rodado antes.
import { en } from "../../../src/core/i18n/en.ts";
import { ptBR } from "../../../src/core/i18n/pt-BR.ts";

export { en, ptBR };

/** Luminância relativa WCAG de um `[r, g, b]`. */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
export const toRgb = (value) => (value.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map(Number);

/** O texto que a área `candidate-rescore` compara e `canonical-flows` reabre. */
export const COMPARISON_TEXT =
  "Senior AI Software Architect responsible for TypeScript and Python services, distributed systems, LLM products, cloud architecture, observability, technical leadership, and remote delivery for teams in Brazil and LATAM.";

/**
 * O que nunca pode aparecer em cache nem em corpo offline: as credenciais e
 * contas da suíte. A área `jobs-new` acrescenta o marcador da vaga que ela cria
 * (`ctx.state.privateMarkers`); sem ela, a lista vale sem o marcador.
 */
export function basePrivateMarkers(ctx) {
  return [
    ctx.E2E_EMAIL,
    ctx.E2E_PASSWORD,
    ctx.E2E_RESET_EXPIRED_TOKEN,
    ctx.E2E_RESET_CONSUMED_TOKEN,
    ctx.E2E_RESET_RACE_TOKEN,
    ctx.E2E_LOGIN_EXPIRED_TOKEN,
    ctx.E2E_LOGIN_RACE_TOKEN,
    "e2e-candidato@local.test",
    "e2e-recrutador@local.test",
    "e2e-alvo@local.test",
    "e2e-desabilitada@local.test",
    "E2E Candidate",
  ];
}

export function privateMarkersOf(ctx) {
  return ctx.state.privateMarkers ?? basePrivateMarkers(ctx);
}

/**
 * A varredura de inglês: texto que é valor do dicionário português, ou que
 * tem acento, fora de dado do usuário. Ver a área `i18n`.
 */
export function makePortugueseLeaks({ page, gotoMeasured }) {
  const flatten = (dict) => Object.values(dict).flatMap((section) => Object.values(section));
  // Palavra igual nos dois idiomas ("Frameworks", "Referrals", "Cockpit") não é
  // vazamento — é a mesma palavra.
  const shared = new Set(flatten(en).map((v) => v.toLowerCase()));
  const portuguese = new Set(
    flatten(ptBR)
      .map((v) => v.toLowerCase())
      .filter((v) => v.length > 2 && !shared.has(v)),
  );

  const portugueseLeaks = async (paths, target = page) => {
    const leaks = [];
    for (const path of paths) {
      if (!(await gotoMeasured(target, path, leaks))) continue;
      const found = await target.evaluate((dictionary) => {
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
    return [...new Set(leaks)];
  };
  return portugueseLeaks;
}

/** Observadores do splash de transição do App Router, das áreas `navigation` e `canonical-flows`. */
export function transitionHelpers({ page, BASE }) {
  const transitionOverlay = page.locator('[data-testid="navigation-transition"]');
  const transitionError = page.locator('[data-testid="navigation-route-error"]');
  const pushOn = async (targetPage, href) => {
    await targetPage.evaluate((target) => {
      const router = window.next?.router;
      if (!router?.push) throw new Error("App Router client instance unavailable");
      router.push(target);
    }, href);
  };
  const routerPush = (href) => pushOn(page, href);
  const waitForState = async (locator, state, label) => {
    try {
      await locator.waitFor({ state });
    } catch (error) {
      throw new Error(`${label}: ${String(error)}`);
    }
  };
  const resetTransitionDocument = async (locale = "pt-BR") => {
    await page.context().addCookies([{ name: "jho_locale", value: locale, url: BASE }]);
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    await waitForState(transitionOverlay, "detached", "transition reset did not detach overlay");
  };

  const observeNavigation = async (
    targetPage,
    activate,
    destination,
    label = destination,
    captureAtAttach = async () => ({}),
  ) => {
    const overlay = targetPage.locator('[data-testid="navigation-transition"]');
    try {
      await overlay.waitFor({ state: "detached" });
      await targetPage.evaluate(() => {
        globalThis.__e2eTransitionEvidence?.observer?.disconnect();
        const evidence = { states: [], maxCount: 0 };
        const record = (mutations = []) => {
          const overlays = document.querySelectorAll('[data-testid="navigation-transition"]');
          let added = 0;
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (node.matches('[data-testid="navigation-transition"]')) added += 1;
              added += node.querySelectorAll('[data-testid="navigation-transition"]').length;
            }
          }
          evidence.maxCount = Math.max(evidence.maxCount, overlays.length, added);
          const current = overlays[0];
          if (!current) return;
          const state = {
            generation: Number(current.getAttribute("data-generation")),
            phase: current.getAttribute("data-phase"),
            status: current.querySelector('[role="status"]')?.textContent ?? "",
          };
          const previous = evidence.states.at(-1);
          if (!previous || previous.generation !== state.generation || previous.phase !== state.phase) {
            evidence.states.push(state);
          }
        };
        const observer = new MutationObserver(record);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-generation", "data-phase"],
          childList: true,
          subtree: true,
        });
        globalThis.__e2eTransitionEvidence = { observer, evidence };
      });
      const activation = activate();
      // A espera pelo overlay TOLERA não encontrá-lo, e o MutationObserver acima
      // é quem testemunha.
      //
      // Num redirect aceito dentro do reducer do Server Action, o overlay nasce
      // no `useLayoutEffect` do observador de commit e morre no `useEffect`
      // seguinte: a janela em que ele existe no DOM é de um quadro, e o
      // `locator` do Playwright pode perdê-la inteira. Medido nesta árvore, sem
      // nenhuma alteração de produto: duas execuções de `origin/dev`, uma
      // passando 262/262 e a outra reprovando exatamente aqui. É corrida do
      // teste, não defeito do produto — e um teste que reprova sozinho ensina a
      // ignorar reprovação.
      //
      // O observador registra a inserção mesmo quando o elemento já saiu, então
      // a prova continua existindo: `maxOverlayCount` e `transitionEvidence`
      // abaixo vêm dele, e é neles que as asserções se apoiam.
      const attachedOverlay = await overlay
        .waitFor({ state: "attached", timeout: 10_000 })
        .then(() => overlay.elementHandle())
        .catch(() => null);
      const snapshot = attachedOverlay
        ? await attachedOverlay.evaluate((element) => ({
          count: document.querySelectorAll('[data-testid="navigation-transition"]').length,
          generation: Number(element.getAttribute("data-generation")),
          phase: element.getAttribute("data-phase"),
          rect: element.getBoundingClientRect().toJSON(),
          contentRect: element.querySelector(".navigation-transition__content")?.getBoundingClientRect().toJSON() ?? null,
          visibleRect: (() => {
            const content = element.querySelector(".navigation-transition__content");
            const rects = content
              ? Array.from(content.children)
                .map((child) => child.getBoundingClientRect())
                .filter((childRect) => childRect.width > 0 && childRect.height > 0)
              : [];
            if (rects.length === 0) return null;
            const left = Math.min(...rects.map((childRect) => childRect.left));
            const top = Math.min(...rects.map((childRect) => childRect.top));
            const right = Math.max(...rects.map((childRect) => childRect.right));
            const bottom = Math.max(...rects.map((childRect) => childRect.bottom));
            return { left, top, right, bottom, width: right - left, height: bottom - top };
          })(),
          style: (() => {
            const computed = getComputedStyle(element);
            return {
              position: computed.position,
              display: computed.display,
              alignItems: computed.alignItems,
              justifyContent: computed.justifyContent,
            };
          })(),
          contentStyle: (() => {
            const content = element.querySelector(".navigation-transition__content");
            if (!content) return null;
            const computed = getComputedStyle(content);
            return {
              display: computed.display,
              flexDirection: computed.flexDirection,
              alignItems: computed.alignItems,
              textAlign: computed.textAlign,
            };
          })(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          text: element.textContent ?? "",
        }))
        : {
          count: 0,
          generation: 0,
          phase: null,
          rect: null,
          contentRect: null,
          visibleRect: null,
          style: null,
          contentStyle: null,
          viewport: await targetPage.evaluate(() => ({ width: innerWidth, height: innerHeight })),
          text: "",
        };
      const attachedEvidence = await captureAtAttach();
      await activation;
      await targetPage.locator(destination).waitFor({ state: "visible", timeout: 20_000 });
      await overlay.waitFor({ state: "detached", timeout: 20_000 });
      const transitionEvidence = await targetPage.evaluate(() => {
        const evidence = globalThis.__e2eTransitionEvidence;
        evidence?.observer?.disconnect();
        delete globalThis.__e2eTransitionEvidence;
        return evidence?.evidence ?? { states: [], maxCount: 0 };
      });
      return {
        ...snapshot,
        // Sem handle, a contagem e a fase vêm do observador — ver o comentário
        // do `waitFor` acima. `generation` já caía para cá antes.
        count: snapshot.count || transitionEvidence.maxCount,
        generation: snapshot.generation || transitionEvidence.states[0]?.generation || 0,
        phase: snapshot.phase ?? transitionEvidence.states.at(-1)?.phase ?? null,
        ...attachedEvidence,
        transitionEvidence: transitionEvidence.states,
        maxOverlayCount: transitionEvidence.maxCount,
      };
    } catch (error) {
      throw new Error(`${label}: ${String(error)}`);
    }
  };

  // Navegação na mesma tela (filtro, ordem, página, densidade) não abre o
  // overlay nem torna o shell `inert` (#220). O observador testemunha o
  // atributo mesmo quando a resposta chega no quadro seguinte: a prova é ter
  // visto `data-navigation="soft"` com `aria-busy`, nunca `inert` nem overlay,
  // e o shell limpo no fim.
  const observeSoftNavigation = async (targetPage, activate, destination, label = destination) => {
    try {
      await targetPage.locator('[data-testid="navigation-transition"]').waitFor({ state: "detached" });
      const before = targetPage.url();
      await targetPage.evaluate(() => {
        globalThis.__e2eSoftEvidence?.observer?.disconnect();
        const shell = document.getElementById("application-shell");
        const evidence = { soft: false, inert: false, overlays: 0, status: "" };
        const softStatus = document.querySelector('[data-testid="navigation-soft-status"]');
        const record = (mutations = []) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (node.matches('[data-testid="navigation-transition"]')
                || node.querySelector('[data-testid="navigation-transition"]')) {
                evidence.overlays += 1;
              }
            }
          }
          const announced = softStatus?.textContent?.trim();
          if (announced) evidence.status = announced;
          if (shell?.getAttribute("data-navigation") === "soft" && shell.getAttribute("aria-busy") === "true") {
            evidence.soft = true;
          }
          if (shell?.hasAttribute("inert")) evidence.inert = true;
        };
        const observer = new MutationObserver(record);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-navigation", "inert", "aria-busy"],
          characterData: true,
          childList: true,
          subtree: true,
        });
        globalThis.__e2eSoftEvidence = { observer, evidence };
      });
      await activate();
      await targetPage.waitForURL((url) => url.href !== before, { timeout: 20_000 });
      await targetPage.locator(destination).waitFor({ state: "visible", timeout: 20_000 });
      await targetPage.waitForFunction(
        () => !document.getElementById("application-shell")?.hasAttribute("aria-busy"),
        null,
        { timeout: 20_000 },
      );
      return await targetPage.evaluate(() => {
        const { observer, evidence } = globalThis.__e2eSoftEvidence;
        observer.disconnect();
        delete globalThis.__e2eSoftEvidence;
        const shell = document.getElementById("application-shell");
        const settled = !shell?.hasAttribute("inert") && !shell?.hasAttribute("data-navigation");
        return {
          ...evidence,
          settled,
          phase: evidence.soft && !evidence.inert && evidence.overlays === 0 && settled ? "soft" : "blocking",
        };
      });
    } catch (error) {
      throw new Error(`${label}: ${String(error)}`);
    }
  };

  const observeRedirectAction = async (targetPage, activate, destination) => {
    let actionRequests = 0;
    let actionResponses = 0;
    let actionResponseSeen = false;
    const countAction = (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) actionRequests += 1;
    };
    const countActionResponse = (response) => {
      const request = response.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actionResponses += 1;
        actionResponseSeen = true;
      }
    };
    targetPage.on("request", countAction);
    targetPage.on("response", countActionResponse);
    const sourceUrl = targetPage.url();
    const sourcePath = new URL(sourceUrl).pathname;
    try {
      const snapshot = await observeNavigation(
        targetPage,
        activate,
        destination,
        destination,
        async () => ({ actionResponseSeenAtAttach: actionResponseSeen }),
      );
      // Redirect para a mesma tela (só a query muda) é transição suave: sem
      // overlay (#220). A prova de "uma vez" continua sendo o POST único.
      const sameScreen = new URL(targetPage.url()).pathname === sourcePath;
      const moved = targetPage.url() !== sourceUrl;
      return { ...snapshot, actionRequests, actionResponses, sameScreen, moved };
    } finally {
      targetPage.off("request", countAction);
      targetPage.off("response", countActionResponse);
    }
  };

  const observeCanonicalReload = async (targetPage, testId) => {
    const response = await targetPage.reload({ waitUntil: "domcontentloaded" });
    await targetPage.locator(`[data-testid="${testId}"]`).waitFor({ state: "visible" });
    await targetPage.locator("#app-splash").waitFor({ state: "detached", timeout: 5_000 });
    return targetPage.evaluate(({ expectedTestId, status }) => ({
      status,
      terminal: document.querySelectorAll(`[data-testid="${expectedTestId}"]`).length,
      startup: document.querySelectorAll("#app-splash").length,
      transitions: document.querySelectorAll('[data-testid="navigation-transition"]').length,
      locale: document.documentElement.lang,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.innerText,
      backText: document.querySelector('[data-testid="route-status-back"]')?.textContent?.trim() ?? "",
      backHref: document.querySelector('[data-testid="route-status-back"]')?.getAttribute("href") ?? "",
    }), { expectedTestId: testId, status: response?.status() ?? 0 });
  };

  const readCacheStorage = async (targetPage) => targetPage.evaluate(async () => {
    const names = await caches.keys();
    const entries = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({
          cache: name,
          url: request.url,
          body: response ? await response.clone().text() : "",
        });
      }
    }
    return { names, entries };
  });
  return { transitionOverlay, transitionError, pushOn, routerPush, waitForState, resetTransitionDocument, observeNavigation, observeSoftNavigation, observeRedirectAction, observeCanonicalReload, readCacheStorage };
}
