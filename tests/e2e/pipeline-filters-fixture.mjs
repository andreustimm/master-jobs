/**
 * A conta da área `pipeline-filters` (#478), compartilhada entre `setup.mjs`,
 * que grava o funil dela, e a área, que o lê pela tela.
 *
 * Conta própria: o funil do dono muda a cada área que move candidatura, e um
 * contador exato só se prova num funil que ninguém mais toca. Três
 * candidaturas, duas empresas, dois canais e notas distintas; "Engenheiro" só
 * acha "Engineer" com a busca ampliada (sinônimos ligados no runner).
 */
export const PIPELINE_FILTER_FIXTURE = Object.freeze({
  email: "e2e-funil-filtros@local.test",
  companies: Object.freeze({ alpha: "Funnel Filter Alpha", beta: "Funnel Filter Beta" }),
  jobs: Object.freeze([
    { id: 908000000, title: "Backend Engineer Funnel Fixture", company: "alpha", fit: 85, status: "applied", channel: "referral" },
    { id: 908000001, title: "Engenheiro Funnel Fixture", company: "alpha", fit: 40, status: "shortlisted", channel: "direct" },
    { id: 908000002, title: "Platform Funnel Fixture", company: "beta", fit: 70, status: "applied", channel: "direct" },
  ]),
});
