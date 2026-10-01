// Área `candidate-gap` do E2E de navegador: a análise de lacunas de /candidate
// mede o currículo com a busca da própria pessoa (#427).
//
// Duas contas. A convidada tem perfil derivado do currículo e a principal
// editada (setup.mjs, `GAP_GUEST_FIXTURE`): a tela dela só pode mostrar os dois
// termos da busca dela. O dono, depois de `candidate-rescore` salvar o
// currículo e a fila derivar um perfil dele a partir do CV, continua medido com
// a principal, que veio do `profile.yaml`.
import { GAP_GUEST_FIXTURE } from "../gap-fixture.mjs";

const GUEST_TERMS = [...GAP_GUEST_FIXTURE.missing, ...GAP_GUEST_FIXTURE.confirmed];

/** Os termos que a seção mostra, por lista, lidos pelo `data-testid`. */
async function readGap(target) {
  const section = target.locator('[data-testid="candidate-vocabulary-gap"]');
  await section.waitFor();
  return section.evaluate((element) => {
    const terms = (id) =>
      [...element.querySelectorAll(`[data-testid="${id}"]`)].map((node) => node.textContent?.trim() ?? "");
    return {
      missing: terms("candidate-gap-missing-term"),
      confirmed: terms("candidate-gap-confirmed-term"),
      rare: terms("candidate-gap-rare-term"),
      noJobs: element.querySelector('[data-testid="candidate-gap-no-jobs"]') !== null,
    };
  });
}

const allTerms = (gap) => [...gap.missing, ...gap.confirmed, ...gap.rare];
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export async function run(ctx) {
  const { BASE, E2E_EMAIL, E2E_PASSWORD, browser, check, page, trackConsole } = ctx;

  async function guestSession(viewport) {
    const context = await browser.newContext({ viewport });
    const target = await context.newPage();
    trackConsole(target);
    await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await target.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await target.fill('input[name="email"]', GAP_GUEST_FIXTURE.email);
    await target.fill('input[name="password"]', E2E_PASSWORD);
    await Promise.all([
      target.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      target.locator('[data-testid="login-submit"]').click(),
    ]);
    await target.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
    return { context, target };
  }

  const guestMatches = (gap) =>
    !gap.noJobs &&
    sameList(gap.missing, GAP_GUEST_FIXTURE.missing) &&
    sameList(gap.confirmed, GAP_GUEST_FIXTURE.confirmed) &&
    gap.rare.length === 0;

  // Convidada a 375 px: primeira leitura e depois do refresh.
  const mobile = await guestSession({ width: 375, height: 812 });
  const first = await readGap(mobile.target);
  check(
    "PROF-gap-own-vocabulary convidada vê só os termos da própria busca",
    guestMatches(first),
    JSON.stringify(first),
  );
  await mobile.target.reload({ waitUntil: "networkidle" });
  const reloaded = await readGap(mobile.target);
  check(
    "PROF-gap-own-vocabulary os termos da convidada sobrevivem ao refresh",
    guestMatches(reloaded),
    JSON.stringify(reloaded),
  );
  const overflow = await mobile.target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("PROF-gap-own-vocabulary lacunas da convidada cabem em 375px", overflow <= 1, `${overflow}px`);
  await mobile.context.close();

  // Leitura independente: sessão nova, outro viewport.
  const desktop = await guestSession({ width: 1280, height: 900 });
  const independent = await readGap(desktop.target);
  check(
    "PROF-gap-own-vocabulary sessão nova da convidada lê os mesmos termos",
    guestMatches(independent),
    JSON.stringify(independent),
  );
  await desktop.context.close();

  // O dono. A pré-condição do defeito da revisão L2 é ele ter um perfil
  // gravado, derivado do CV pela fila; os termos da tela têm de ser os da
  // principal dele, não os desse perfil.
  const [{ eq }, { getDb }, { authUser }, matching] = await Promise.all([
    import("drizzle-orm"),
    import("../../../src/core/db/client.ts"),
    import("../../../src/core/db/schema.ts"),
    import("../../../src/contexts/matching/index.ts"),
  ]);
  const [owner] = await getDb()
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, E2E_EMAIL))
    .limit(1);
  const ownerId = owner?.candidateId ?? null;
  const stored = ownerId === null ? null : await matching.personProfile(ownerId);
  const primary = ownerId === null
    ? null
    : (await matching.listCandidateTracks(ownerId)).find((track) => track.isPrimary);
  const primaryTerms = new Set(
    primary?.target
      ? [...primary.target.keywords.critical, ...primary.target.keywords.strong, ...primary.target.keywords.stack]
          .map((keyword) => keyword.term)
      : [],
  );
  const storedTerms = stored
    ? [...stored.profile.keywords.critical, ...stored.profile.keywords.strong, ...stored.profile.keywords.stack]
        .map((keyword) => keyword.term)
    : [];
  check(
    "PROF-gap-own-vocabulary pré-condição: o dono tem perfil derivado do currículo",
    stored?.source === "candidate" && storedTerms.length > 0,
    JSON.stringify({ source: stored?.source, storedTerms }),
  );

  await page.context().addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  await page.goto(`${BASE}/candidate`, { waitUntil: "networkidle" });
  const ownerGap = await readGap(page);
  await page.reload({ waitUntil: "networkidle" });
  const ownerReloaded = await readGap(page);
  const ownerOk = (gap) =>
    allTerms(gap).length > 0 &&
    allTerms(gap).every((term) => primaryTerms.has(term)) &&
    !allTerms(gap).some((term) => GUEST_TERMS.includes(term));
  check(
    "PROF-gap-own-vocabulary dono com perfil derivado do CV é medido pela principal, antes e depois do refresh",
    ownerOk(ownerGap) && ownerOk(ownerReloaded) && sameList(allTerms(ownerGap), allTerms(ownerReloaded)),
    JSON.stringify({ ownerGap, ownerReloaded, fora: allTerms(ownerGap).filter((term) => !primaryTerms.has(term)) }),
  );
  // Limite conhecido: no acervo do E2E, as 300 vagas do dono acima de 60 são
  // fixtures sem termo do perfil, então "faltante" e "confirmado" ficam vazios
  // e os termos raros do currículo dele coincidem com os do perfil derivado.
  // A tela do dono não distingue a principal do derivado aqui; quem distingue
  // é a convidada acima e o caso (b) de `tests/cov-core-candidate-gap.test.ts`.
}
