/**
 * Contas da área `recruiter-access` do E2E (#465, task_02). `setup.mjs` as
 * cria e, a cada execução, apaga as concessões, os convites e o histórico de
 * acesso dos candidatos daqui — a jornada concede, convida e revoga, e numa
 * base reaproveitada o estado (e o limite diário) da execução anterior não
 * pode decidir o resultado desta.
 *
 *   candidate — "Ana E2E", dona das concessões (E2E-001 – E2E-009);
 *   recruiter — "Rui <i>E2E</i>", recrutador com e-mail provado: o nome com
 *               marcação prova que a lista o mostra como texto (E2E-001);
 *   fresh     — candidata sem nada compartilhado (E2E-006);
 *   invited   — endereço sem conta, que recebe convite (E2E-002, E2E-005).
 */
export const ACCESS_FIXTURES = {
  candidate: { email: "e2e-ana-acesso@local.test", roles: ["candidate"], name: "Ana E2E" },
  recruiter: { email: "e2e-rui-acesso@local.test", roles: ["recruiter"], fullName: "Rui <i>E2E</i>" },
  fresh: { email: "e2e-acesso-vazio@local.test", roles: ["candidate"], name: "Vazia E2E" },
  invited: { email: "e2e-nova-acesso@local.test" },
};
