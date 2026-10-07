/**
 * Contas e identidades do E2E de login social (#464). `setup.mjs` as cria; a
 * área `social-sign-in` entra com elas pelo emissor falso (`fake-oidc.mjs`).
 *
 * Cada uma existe para um cenário:
 *
 *   candidate — candidato com Google ligado: entra e cai no cockpit (E2E-001);
 *   recruiter — recrutador com LinkedIn ligado: cai em Vagas (E2E-001);
 *   conflict  — Google ligado ao sujeito A; entrar com o B dá conflito (E2E-009);
 *   invited   — criada por admin, sem senha nem provedor: o primeiro login com
 *               Google de e-mail verificado liga sozinho (E2E-008).
 */
export const SOCIAL_FIXTURES = {
  candidate: { email: "e2e-social-candidato@local.test", provider: "google", subject: "e2e-google-candidato" },
  recruiter: { email: "e2e-social-recrutador@local.test", provider: "linkedin", subject: "e2e-linkedin-recrutador" },
  conflict: { email: "e2e-social-conflito@local.test", provider: "google", subject: "e2e-google-conflito-A" },
  invited: { email: "e2e-social-convidado@local.test" },
};
