/**
 * Contas da área `recruiter-invite` do E2E (#465, task_03). `setup.mjs` cria a
 * candidata e, a cada execução, apaga as concessões, os convites e o histórico
 * dela, mais as contas que a jornada cria pelo cadastro — numa base
 * reaproveitada, o cadastro da execução anterior responderia "e-mail com
 * conta" e o convite não teria o que provar.
 *
 *   inviter — "Ana Convite E2E", candidata que convida (E2E-010 – E2E-015);
 *   social  — recebe o convite e se cadastra pelo Google falso (E2E-010);
 *   manual  — recebe o convite e se cadastra com e-mail e código (E2E-011);
 *   invited — recebe o convite; quem se cadastra pelo link é `other` (E2E-012);
 *   other   — o endereço que NÃO foi convidado (E2E-012);
 *   cancelled — convite cancelado antes de ser aberto (E2E-013).
 *
 * O recrutador de outra conta que abre o link de Bia (E2E-014) é o Rui de
 * `recruiter-access-fixtures.mjs`: só entra e lê, não muda nada dele.
 */
export const INVITE_FIXTURES = {
  inviter: { email: "e2e-ana-convite@local.test", roles: ["candidate"], name: "Ana Convite E2E" },
  social: { email: "e2e-bia-convite@local.test", name: "Bia Convite E2E", sub: "e2e-bia-convite" },
  manual: { email: "e2e-caio-convite@local.test", name: "Caio Convite E2E" },
  invited: { email: "e2e-dani-convite@local.test" },
  other: { email: "e2e-outra-convite@local.test", name: "Outra Convite E2E" },
  cancelled: { email: "e2e-eva-convite@local.test" },
};

/** As contas que a jornada cria pelo cadastro; `setup.mjs` as apaga antes de cada execução. */
export const INVITE_SIGNUP_EMAILS = [INVITE_FIXTURES.social.email, INVITE_FIXTURES.manual.email, INVITE_FIXTURES.other.email];
