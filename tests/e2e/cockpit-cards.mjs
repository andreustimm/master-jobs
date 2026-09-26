// Cards do cockpit clicáveis (#314).
//
// Cada card com destino leva à lista que ele conta, e o número do card é o
// total que o destino mostra — no padrão e com `?fit=60&workMode=remote`.
// "Empresas" não é link; "melhor fit" abre a vaga da maior nota, e fica sem
// link para quem ainda não tem nota. Teclado alcança e ativa os cards.
//
// O número dos cards de faceta sai do cache de facetas (60 s, por processo), e
// verificações anteriores gravam vagas direto no banco, sem invalidá-lo. Uma
// divergência é, por isso, conferida de novo depois da validade: só o que
// persiste além do cache é defeito.
import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/core/db/client.ts";
import { authUser, jobScore } from "../../src/core/db/schema.ts";

const FACET_TTL_MS = 61_000;
const LINKED = ["open", "named", "unblocked", "fresh"];

async function login(browser, base, email, password, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

const digits = (text) => Number((text ?? "").replace(/\D/g, ""));

/** Número e destino de cada card, lidos da tela. */
async function readCards(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-testid^="cockpit-stat-"]')].map((el) => [
        el.getAttribute("data-testid").replace("cockpit-stat-", ""),
        {
          tag: el.tagName,
          href: el.getAttribute("href"),
          value: el.firstElementChild?.textContent ?? "",
          title: el.getAttribute("title"),
          anchors: el.querySelectorAll("a").length,
        },
      ]),
    ),
  );
}

async function jobsTotal(page, base, href) {
  await page.goto(`${base}${href}`, { waitUntil: "networkidle" });
  return Number(await page.getByTestId("jobs-total").getAttribute("data-total"));
}

/** Para cada card de lista: [card, total do destino]. */
async function compareCounts(page, base, entry) {
  await page.goto(`${base}${entry}`, { waitUntil: "networkidle" });
  const cards = await readCards(page);
  const pairs = {};
  for (const key of LINKED) {
    pairs[key] = [digits(cards[key]?.value), await jobsTotal(page, base, cards[key]?.href ?? "/jobs")];
  }
  return { cards, pairs };
}

const agree = (pairs) => Object.values(pairs).every(([card, total]) => card === total);

export async function checkCockpitCards(browser, base, accounts, check) {
  const { context, page } = await login(browser, base, accounts.owner.email, accounts.owner.password);
  try {
    for (const entry of ["/", "/?fit=60&workMode=remote"]) {
      let { cards, pairs } = await compareCounts(page, base, entry);
      if (!agree(pairs)) {
        await page.waitForTimeout(FACET_TTL_MS);
        ({ cards, pairs } = await compareCounts(page, base, entry));
      }
      check(`cockpit #314: card == total de /jobs em ${entry}`, agree(pairs), JSON.stringify(pairs));
      check(
        `cockpit #314: links de faceta ligam o chip e não levam status em ${entry}`,
        ["named", "unblocked", "fresh"].every((key) => {
          const url = new URL(cards[key].href, base);
          return url.pathname === "/jobs" && url.searchParams.get(key) === "1" && !url.searchParams.has("status");
        })
          && (entry === "/" || ["named", "unblocked", "fresh"].every((key) =>
            new URL(cards[key].href, base).searchParams.get("workMode") === "remote"
            && new URL(cards[key].href, base).searchParams.get("fit") === "60")),
        JSON.stringify(Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.href]))),
      );
    }

    // O campo de empresa é renderizado no cockpit, mas a faceta não o aplica:
    // o link não pode carregá-lo, ou o destino contaria outra coisa.
    await page.goto(`${base}/?company=Acme&fitMax=90&notApplied=1`, { waitUntil: "networkidle" });
    const typed = await readCards(page);
    check(
      "cockpit #314: link de faceta não carrega empresa, teto de Score nem não enviadas",
      ["named", "unblocked", "fresh"].every((key) => {
        const params = new URL(typed[key].href, base).searchParams;
        return !params.has("company") && !params.has("fitMax") && !params.has("notApplied");
      }),
      JSON.stringify(typed.named),
    );

    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const cards = await readCards(page);
    check(
      "cockpit #314: empresas não é link, nem contém link",
      cards.companies?.tag === "DIV" && cards.companies.href === null && cards.companies.anchors === 0,
      JSON.stringify(cards.companies),
    );
    check(
      "cockpit #314: cada card tem a dica do seu universo",
      Object.values(cards).length === 7 && Object.values(cards).every((card) => (card.title ?? "").length > 0),
    );

    // Melhor fit: a vaga do link tem, na trilha principal, a nota do card.
    const best = cards.best;
    const bestId = Number(/^\/jobs\/(\d+)$/.exec(best?.href ?? "")?.[1]);
    const [owner] = await getDb()
      .select({ candidateId: authUser.candidateId })
      .from(authUser)
      .where(eq(authUser.email, accounts.owner.email));
    const fits = Number.isSafeInteger(bestId) && bestId > 0
      ? await getDb()
        .select({ fit: jobScore.fit })
        .from(jobScore)
        .where(and(eq(jobScore.candidateId, owner.candidateId), eq(jobScore.jobId, bestId)))
      : [];
    await page.getByTestId("cockpit-stat-best").click();
    await page.waitForURL((url) => url.pathname === `/jobs/${bestId}`);
    await page.getByTestId("route-job-detail").waitFor();
    check(
      "cockpit #314: melhor fit abre a vaga da maior nota",
      fits.some(({ fit }) => fit.toFixed(0) === best.value.trim()),
      JSON.stringify({ best, fits }),
    );

    // No funil → /pipeline, e "Todos" conta o mesmo.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.getByTestId("cockpit-stat-pipeline").click();
    await page.waitForURL((url) => url.pathname === "/pipeline");
    const all = digits(await page.getByTestId("pipeline-filter-all").locator("div div").first().textContent());
    check("cockpit #314: no funil == Todos em /pipeline", all === digits(cards.pipeline.value), JSON.stringify({ all, card: cards.pipeline }));

    // Teclado: Tab alcança os cards em ordem (empresas fica de fora), o foco é
    // visível e Enter navega.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const reached = [];
    for (let step = 0; step < 80 && reached.length < 6; step++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        const id = el?.getAttribute("data-testid") ?? "";
        return id.startsWith("cockpit-stat-")
          ? { id, outline: getComputedStyle(el).outlineStyle, visible: el.matches(":focus-visible") }
          : null;
      });
      if (focused) reached.push(focused);
    }
    check(
      "cockpit #314: Tab alcança os seis cards com destino, com foco visível",
      reached.map((r) => r.id).join() === ["open", "named", "unblocked", "fresh", "best", "pipeline"].map((k) => `cockpit-stat-${k}`).join()
        && reached.every((r) => r.visible && r.outline !== "none"),
      JSON.stringify(reached),
    );
    await page.getByTestId("cockpit-stat-named").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/jobs" && url.searchParams.get("named") === "1");
    // A URL muda antes de a árvore nova chegar (navegação suave): espere o
    // destino renderizar em vez de contar no meio da transição.
    const landed = await page.getByTestId("jobs-total").waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check("cockpit #314: Enter no card abre /jobs com o chip ligado", landed, page.url());
  } finally {
    await context.close();
  }

  // Sem nota nenhuma, o melhor fit não tem vaga para abrir. E a faixa cabe no
  // celular.
  const phone = await login(browser, base, accounts.unscored.email, accounts.unscored.password, { width: 375, height: 812 });
  try {
    await phone.page.goto(`${base}/`, { waitUntil: "networkidle" });
    const cards = await readCards(phone.page);
    check(
      "cockpit #314: sem nota, melhor fit não é link",
      cards.best?.tag === "DIV" && cards.best.href === null,
      JSON.stringify(cards.best),
    );
    check(
      "cockpit #314: faixa de cards cabe em 375 px",
      await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    );
  } finally {
    await phone.context.close();
  }
}
