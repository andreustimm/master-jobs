/**
 * Contas da área `account-methods` do E2E (#464, task_04). `setup.mjs` as cria
 * e, a cada execução, devolve senha, identidades e termos ao estado abaixo —
 * a jornada liga, desliga e define senha, e numa base reaproveitada o estado
 * da execução anterior não pode decidir o resultado desta.
 *
 * Cada uma existe para um cenário:
 *
 *   owner      — candidato com senha e sem provedor: liga o Google pela conta e
 *                o desliga (E2E-016, E2E-017);
 *   socialOnly — candidato sem senha, só com LinkedIn e termos aceitos: vê os
 *                métodos (E2E-020), não desliga o último (E2E-017) e define a
 *                primeira senha (E2E-018);
 *   adminTarget — recrutador com senha e Google: o admin desliga (E2E-019);
 *   socialAdmin — admin sem senha, com Google: entra pelo Google e continua
 *                 admin (E2E-021);
 *   recovery   — recupera a senha pelo e-mail do sink (E2E-030).
 */
export const METHODS_FIXTURES = {
  owner: { email: "e2e-metodos-dono@local.test", roles: ["candidate"], googleSubject: "e2e-google-metodos-dono" },
  socialOnly: {
    email: "e2e-metodos-social@local.test",
    roles: ["candidate"],
    noPassword: true,
    identities: [{ provider: "linkedin", subject: "e2e-linkedin-metodos-social", origin: "automatic" }],
    terms: { termsVersion: "2026-10-06", privacyVersion: "2026-10-06", termsAcceptedAt: "2026-10-06T12:00:00.000Z" },
  },
  adminTarget: {
    email: "e2e-metodos-alvo@local.test",
    roles: ["recruiter"],
    identities: [{ provider: "google", subject: "e2e-google-metodos-alvo", origin: "manual" }],
  },
  socialAdmin: {
    email: "e2e-metodos-admin@local.test",
    roles: ["admin"],
    noPassword: true,
    identities: [{ provider: "google", subject: "e2e-google-metodos-admin", origin: "manual" }],
  },
  recovery: { email: "e2e-recuperacao@local.test", roles: ["recruiter"] },
};
