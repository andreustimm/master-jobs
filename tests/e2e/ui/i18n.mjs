// Área `i18n` do E2E de navegador: Idioma: inglês sem português nem acento fora de dado do usuário.
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { ENGLISH_ANONYMOUS_SWEEP, ENGLISH_OWNER_SWEEP } from "../routes.mjs";
import { makePortugueseLeaks } from "./shared.mjs";

export async function run(ctx) {
  const { BASE, browser, check, page } = ctx;
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
  const portugueseLeaks = makePortugueseLeaks(ctx);

  await page.context().addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
  // As rotas moram em `routes.mjs`, onde o teste de cobertura as cruza com o
  // inventário de páginas: rota nova sem varredura nem exceção reprova.
  const leaks = await portugueseLeaks(ENGLISH_OWNER_SWEEP);
  check(
    "interface em inglês não vaza português",
    leaks.length === 0,
    leaks.slice(0, 8).join(" | "),
  );

  // A varredura de texto não enxerga aria-label nem distingue uma marca
  // ausente de um título vindo do acervo. Este percurso mantém a prova da
  // lista em uma viewport de telefone, onde o modal e a paginação também
  // precisam continuar acessíveis.
  const jobsContext = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 375, height: 812 },
  });
  const jobsPage = await jobsContext.newPage();
  try {
    await jobsContext.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
    const jobsResponse = await jobsPage.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const jobsRoute = new URL(jobsPage.url()).pathname;
    const title = jobsPage.locator('[data-testid^="job-link-"]').first();
    await title.waitFor({ state: "visible" });
    const modalTrigger = jobsPage.locator('button[popovertarget^="job-modal-"]').first();
    await modalTrigger.click();
    const closeLabel = await jobsPage.locator('[id^="job-modal-"] button[aria-label]').first().getAttribute("aria-label");
    const paginationRange = jobsPage.locator('[data-testid="pagination-range"]');
    const paginationText = await paginationRange.innerText();
    check(
      "lista de vagas em inglês mantém a rota e os nomes acessíveis",
      jobsResponse?.ok() === true && jobsRoute === "/jobs" && closeLabel === "Close" && await title.getAttribute("data-user-content") === "true",
      `status=${jobsResponse?.status() ?? "none"} rota=${jobsRoute} aria=${closeLabel ?? "none"}`,
    );
    check(
      "lista de vagas em inglês usa números e texto de paginação traduzidos",
      paginationText.includes(" of ") && !paginationText.includes(" de "),
      paginationText,
    );

    await jobsContext.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
    await jobsPage.goto(`${BASE}/jobs?fit=0&sort=comp&cur=BRL&per=month`, { waitUntil: "networkidle" });
    const pay = jobsPage.locator('[data-testid^="job-pay-"]').first();
    await pay.waitFor({ state: "visible" });
    check(
      "lista de vagas em pt-BR localiza o período do salário",
      (await pay.innerText()).includes("/mês"),
      await pay.innerText(),
    );

    // O motivo de remuneração é gravado pelo scorer com o rótulo pronto e sem
    // idioma ("$4,000/month"); quem exibe é que troca o período (#426).
    const payReasons = async (locale) => {
      await jobsContext.addCookies([{ name: "jho_locale", value: locale, url: BASE }]);
      await jobsPage.goto(`${BASE}/jobs/904000004`, { waitUntil: "networkidle" });
      const reasons = jobsPage.locator('[data-testid="score-reasons"]');
      await reasons.waitFor({ state: "visible" });
      return reasons.innerText();
    };
    const reasonsPt = await payReasons("pt-BR");
    check(
      "motivo de remuneração do score em pt-BR localiza o período",
      reasonsPt.includes("$4,000/mês") && !reasonsPt.includes("/month"),
      reasonsPt,
    );
    const reasonsEn = await payReasons("en");
    check(
      "motivo de remuneração do score em inglês mantém o período em inglês",
      reasonsEn.includes("$4,000/month") && !reasonsEn.includes("/mês"),
      reasonsEn,
    );
  } finally {
    await jobsContext.close();
  }
  {
    // As telas anteriores à sessão, num contexto sem cookie: com o do dono,
    // `/login` redirecionaria e a varredura não mediria nada.
    const anonymousContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await anonymousContext.addCookies([{ name: "jho_locale", value: "en", url: BASE }]);
    const anonymous = await anonymousContext.newPage();
    const anonymousLeaks = await portugueseLeaks(ENGLISH_ANONYMOUS_SWEEP, anonymous);
    await anonymousContext.close();
    check(
      "telas sem sessão em inglês não vazam português",
      anonymousLeaks.length === 0,
      anonymousLeaks.slice(0, 8).join(" | "),
    );
  }
}
