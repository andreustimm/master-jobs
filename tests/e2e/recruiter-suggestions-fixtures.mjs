/**
 * Contas e vagas da área `recruiter-suggestions` do E2E (#465, task_04).
 * `setup.mjs` as cria e, a cada execução, devolve os dois candidatos a "nada
 * sugerido": apaga sugestões, concessões e histórico deles, regrava as duas
 * concessões ao Rui, o currículo da Ana e a candidatura do funil dela.
 *
 *   candidate — "Ana E2E", com currículo e uma candidatura (E2E-016 – E2E-023);
 *   other     — "Zé <b>E2E</b>": a marcação no nome prova que a lista o
 *               mostra como texto (E2E-016), e é a concessão que sobra depois
 *               da revogação da Ana (E2E-021);
 *   recruiter — "Rui E2E", com acesso aos dois.
 *
 * As vagas têm ids fixos na faixa 909000000, que nenhuma outra fixture usa
 * (`pipeline-filters` ocupa a 908000000). "Backend" é o texto que a busca da
 * tela de sugerir usa (E2E-018).
 */
export const SUGGESTION_FIXTURES = {
  candidate: { email: "e2e-ana-sugestoes@local.test", roles: ["candidate"], name: "Ana E2E" },
  other: { email: "e2e-ze-sugestoes@local.test", roles: ["candidate"], name: "Zé <b>E2E</b>" },
  recruiter: { email: "e2e-rui-sugestoes@local.test", roles: ["recruiter"], fullName: "Rui E2E" },
  cv: "# Ana E2E\n\nEngenheira de backend com TypeScript, PostgreSQL e sistemas distribuídos.\n\n## Experiência\n\n- Plataforma de pagamentos, 2021–2026.",
  jobs: {
    suggested: { id: 909000001, title: "Backend Suggestion Fixture", companyName: "Suggestion Lab" },
    pending: { id: 909000002, title: "Backend Pending Fixture", companyName: "Suggestion Lab" },
    funnel: { id: 909000003, title: "Funnel Suggestion Fixture", companyName: "Funnel Lab" },
  },
};
