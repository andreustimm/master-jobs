// Área `mobile` do E2E de navegador: Largura, zoom e menu móvel.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { OVERFLOW_SWEEP } from "../routes.mjs";

export async function run(ctx) {
  const { BASE, check, gotoMeasured, page } = ctx;
  /* --------------------------------- Mobile -------------------------------- */

  // Rolagem horizontal é a falha que passa despercebida no desktop, porque só
  // aparece quando a janela é estreita o bastante para o conteúdo não caber.
  // 320px é a tela mais estreita em uso (iPhone SE de 1ª geração, e qualquer
  // aparelho com zoom de sistema): foi nela que o título de uma vaga real
  // passou da borda enquanto 375px ainda cabia.
  const widths = [320, 375, 390, 412, 768, 812, 1024];
  const overflows = [];
  const clipped = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 812 ? 375 : 812 });
    for (const path of OVERFLOW_SWEEP) {
      if (!(await gotoMeasured(page, path, overflows, `${width}px `))) continue;
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) overflows.push(`${width}px ${path}: ${overflow}px`);
      // `scrollWidth` não vê o que um cartão com `overflow: hidden` corta: o
      // botão "de novo a partir de…" passava da borda da tela dentro do cartão
      // de Buscas e a página continuava medindo a largura da janela. Conteúdo
      // que passa da borda só é aceitável dentro de um contêiner feito para rolar.
      const beyond = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const scrollsSideways = (node) => {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            const overflowX = getComputedStyle(parent).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") return true;
          }
          return false;
        };
        return [...document.querySelectorAll("main *")]
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return box.width > 1 && box.right > viewport + 1 && !scrollsSideways(node);
          })
          .slice(0, 2)
          .map((node) => node.getAttribute("data-testid") || node.tagName.toLowerCase());
      });
      if (beyond.length > 0) clipped.push(`${width}px ${path}: ${beyond.join(", ")}`);
    }
  }
  check("sem rolagem horizontal em nenhuma largura", overflows.length === 0, overflows.slice(0, 3).join(" · "));
  check(
    "nenhum elemento passa da borda da tela, nem cortado dentro de um cartão",
    clipped.length === 0,
    clipped.slice(0, 3).join(" · "),
  );

  // Paisagem de telefone/tablet pequeno passa de `sm`, mas ainda não tem
  // largura suficiente para a fileira completa. O breakpoint do menu precisa
  // acompanhar o espaço disponível, não a orientação do aparelho.
  const landscapeNavigation = [];
  // The admin-candidate row needs 527px of free bar since the Searches entry;
  // 1024 leaves 501, so the wide sample is a laptop width.
  for (const width of [812, 932, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 375 });
    await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
    landscapeNavigation.push(await page.evaluate(() => {
      const header = document.querySelector("#application-shell > header");
      const desktopNav = header?.querySelector(":scope > div > nav");
      const mobileTrigger = header?.querySelector('[data-testid="mobile-nav-trigger"]');
      const visible = (node) => Boolean(node && getComputedStyle(node).display !== "none");
      return { width: innerWidth, desktopVisible: visible(desktopNav), mobileVisible: visible(mobileTrigger) };
    }));
  }
  check(
    "paisagem escolhe a navegação pelo espaço disponível",
    landscapeNavigation[0]?.mobileVisible === true
      && landscapeNavigation[0]?.desktopVisible === false
      && landscapeNavigation[1]?.mobileVisible === true
      && landscapeNavigation[1]?.desktopVisible === false
      && landscapeNavigation[2]?.desktopVisible === true
      && landscapeNavigation[2]?.mobileVisible === false,
    JSON.stringify(landscapeNavigation),
  );

  // O defeito de rotação só aparece quando o popover continua aberto: fechar e
  // abrir depois da mudança de orientação recalcula pelo clique e mascara um
  // listener ausente. Aumentamos o cabeçalho para simular a área segura que o
  // WebKit troca ao girar e disparamos o evento que os aparelhos emitem.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(150);
  const beforeRotation = await page.evaluate(() => {
    const header = document.querySelector("#application-shell > header");
    const panel = document.querySelector("#menu-mobile");
    return {
      headerBottom: header?.getBoundingClientRect().bottom ?? -1,
      popoverTop: panel?.getBoundingClientRect().top ?? -1,
      open: panel?.matches(":popover-open") ?? false,
    };
  });
  await page.setViewportSize({ width: 812, height: 375 });
  const afterLandscape = await page.evaluate(async () => {
    const header = document.querySelector("#application-shell > header");
    if (!header) return { headerBottom: -1, popoverTop: -1, open: false };
    header.style.paddingTop = "48px";
    window.dispatchEvent(new Event("orientationchange"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.querySelector("#menu-mobile");
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      popoverTop: panel?.getBoundingClientRect().top ?? -1,
      open: panel?.matches(":popover-open") ?? false,
    };
  });
  await page.setViewportSize({ width: 375, height: 812 });
  const afterPortrait = await page.evaluate(async () => {
    const header = document.querySelector("#application-shell > header");
    if (!header) return { headerBottom: -1, popoverTop: -1, open: false };
    header.style.paddingTop = "32px";
    window.dispatchEvent(new Event("orientationchange"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.querySelector("#menu-mobile");
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      popoverTop: panel?.getBoundingClientRect().top ?? -1,
      open: panel?.matches(":popover-open") ?? false,
    };
  });
  check(
    "menu aberto permanece ancorado após rotação",
    beforeRotation.open &&
      afterLandscape.open &&
      afterLandscape.popoverTop >= afterLandscape.headerBottom - 1 &&
      afterPortrait.open &&
      afterPortrait.popoverTop >= afterPortrait.headerBottom - 1,
    JSON.stringify({ beforeRotation, afterLandscape, afterPortrait }),
  );
  await page.evaluate(() => {
    const header = document.querySelector("#application-shell > header");
    if (header) header.style.paddingTop = "";
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  const desktopNavigation = [];
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
    desktopNavigation.push(await page.evaluate(() => {
      const header = document.querySelector("#application-shell > header");
      const nav = header?.querySelector(":scope > div > nav");
      if (!nav) return { visible: false, overflow: 0, clipped: [] };
      const navRect = nav.getBoundingClientRect();
      const links = [...nav.querySelectorAll("a")];
      return {
        width: innerWidth,
        visible: getComputedStyle(nav).display !== "none",
        overflow: nav.scrollWidth - nav.clientWidth,
        clipped: links
          .filter((link) => {
            const rect = link.getBoundingClientRect();
            return rect.left < navRect.left - 1 || rect.right > navRect.right + 1;
          })
          .map((link) => link.textContent?.trim() ?? ""),
      };
    }));
  }
  check(
    "navegação completa cabe em desktops sem corte",
    desktopNavigation.every(({ visible, overflow, clipped }) =>
      visible && overflow <= 1 && clipped.length === 0),
    JSON.stringify(desktopNavigation),
  );

  // Uma tela larga ainda pode precisar do modo compacto quando o nome da
  // pessoa ou os controles ocupam mais espaço. Nesse caso o breakpoint visual
  // não pode esconder o painel que o botão medido acabou de oferecer.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
  await page.locator("#application-shell > header").evaluate((header) => {
    header.dataset.navMode = "compact";
  });
  const wideCompactTrigger = page.locator('button[popovertarget="menu-mobile"]');
  check("modo compacto pode mostrar o botão em tela larga", await wideCompactTrigger.isVisible());
  await wideCompactTrigger.click();
  await page.waitForTimeout(150);
  check(
    "modo compacto abre o painel também em tela larga",
    await page.locator("#menu-mobile").isVisible(),
  );
  await page.keyboard.press("Escape");

  // Duas requisições ao mesmo tempo na tela mais pesada.
  //
  // O teste que faltava. `/candidate/skills` respondia 200 sozinha e 504 quando
  // pedida duas vezes: o pool tem três conexões, a instância serverless é
  // reaproveitada, e um caminho que pedia as três exatas deixava a requisição
  // do lado esperando até a Vercel matar as duas aos 30 segundos. Toda a suíte
  // passava porque toda a suíte pede uma página de cada vez.
  // Dois `fetch` de dentro da própria página: requisições HTTP de verdade, com
  // o mesmo cookie de sessão, disparadas juntas. Uma segunda aba precisaria de
  // um contexto novo, e um contexto novo não carrega a sessão.
  //
  // O QUE ESTE CASO PROVA, E O QUE NÃO PROVA.
  //
  // Ele prova que concorrência real sobre as telas mais pesadas não devolve erro:
  // o pool tem três conexões, e um caminho que pedisse as três exatas deixaria a
  // requisição do lado esperando.
  //
  // Ele NÃO prova a ausência do 504. O 504 é o corte de 30 segundos da Vercel, e
  // aqui não existe: o `postgres.js` enfileira sem erro quando o pool satura, e
  // uma requisição lenta local termina em vez de morrer. Status 200 é condição
  // necessária e insuficiente. O gate do teto por REQUISIÇÃO é
  // `tests/db-fan-out.test.ts`, que mede o fan-out de cada composição de página
  // contra `POOL - 1` — e é lá que a regressão reprova.
  //
  // Medir tempo aqui seria pior que não medir: um piso em milissegundos depende
  // da carga da máquina, e um caso que reprova de vez em quando ensina a suíte a
  // ser ignorada.
  //
  // O que foi acrescentado é o cenário REAL de produção: a instância serverless é
  // reaproveitada entre rotas DIFERENTES, então duas telas pesadas distintas
  // competem pelo mesmo pool. Só `/candidate/skills` duas vezes não exercitava
  // isso.
  const statusEmParalelo = await page.evaluate(async (base) => {
    const pedir = (rota) => fetch(`${base}${rota}`, { redirect: "manual" }).then((r) => [rota, r.status]);
    const respostas = await Promise.all([
      pedir("/candidate/skills"),
      pedir("/candidate/skills"),
      pedir("/searches/tracks/new"),
      pedir("/jobs?q=fixture&fit=0"),
    ]);
    return Object.fromEntries(respostas.map(([rota, status], n) => [`${n}:${rota}`, status]));
  }, BASE);
  check(
    "E2E-013 quatro requisições concorrentes em três telas pesadas respondem todas (não prova ausência de 504; o teto por requisição é tests/db-fan-out.test.ts)",
    Object.values(statusEmParalelo).length === 4
      && Object.values(statusEmParalelo).every((status) => status === 200),
    JSON.stringify({ statusEmParalelo }),
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/candidate/skills`, { waitUntil: "networkidle" });
  const skillsRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="skills-market-row"]')].map((row) => {
    const rect = row.getBoundingClientRect();
    const children = [...row.children].map((child) => child.getBoundingClientRect());
    return {
      rowWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      right: rect.right,
      childRight: Math.max(...children.map((child) => child.right), rect.left),
    };
  }));
  check(
    "skills refluem sem cortar percentual, status ou barra no celular",
    skillsRows.length > 0 && skillsRows.every((row) =>
      row.rowScrollWidth <= row.rowWidth + 1 && row.childRight <= row.right + 1),
    JSON.stringify(skillsRows.slice(0, 3)),
  );

  await page.setViewportSize({ width: 1280, height: 900 });

  /* ------------------------- Menu mobile fecha ao navegar ------------------------ */

  await page.setViewportSize({ width: 375, height: 812 });

  // Abre pelo botão do hambúrguer. O popover nativo é `#menu-mobile`.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile abre ao tocar no botão", await page.locator("#menu-mobile").isVisible());

  const mobileMenuGeometry = await page.locator("#menu-mobile").evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const header = document.querySelector("#application-shell > header");
    const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
    const style = getComputedStyle(panel);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
      headerBottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      bottom: rect.bottom,
      overflowY: style.overflowY,
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth,
    };
  });
  check(
    "menu mobile ocupa a largura e começa abaixo do cabeçalho",
    mobileMenuGeometry.left >= -1
      && mobileMenuGeometry.right <= mobileMenuGeometry.viewportWidth + 1
      && mobileMenuGeometry.width >= mobileMenuGeometry.viewportWidth - 1
      && mobileMenuGeometry.top >= mobileMenuGeometry.headerBottom - 1
      && mobileMenuGeometry.bottom <= mobileMenuGeometry.viewportHeight + 1
      && mobileMenuGeometry.overflowY === "auto"
      && mobileMenuGeometry.scrollWidth <= mobileMenuGeometry.clientWidth + 1,
    JSON.stringify(mobileMenuGeometry),
  );

  // O mesmo botão é um toggle: o segundo toque fecha o painel e o terceiro
  // reabre. `show` deixava o menu preso aberto, o que era especialmente ruim
  // quando a pessoa queria voltar à tela sem escolher outro destino.
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile fecha ao tocar novamente no botão", !(await page.locator("#menu-mobile").isVisible()));
  await page.locator('button[popovertarget="menu-mobile"]').click();
  await page.waitForTimeout(250);
  check("menu mobile reabre após o toggle", await page.locator("#menu-mobile").isVisible());

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
}
