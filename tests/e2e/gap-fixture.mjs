/**
 * A convidada da área `candidate-gap` (#427), compartilhada entre `setup.mjs`,
 * que a grava, e a área, que a lê pela tela.
 *
 * Os dois termos da busca dela estão na descrição da vaga `public-role` e fora
 * do `profile.yaml`: "lifecycle" falta no currículo dela, "customers" está nele.
 * O currículo também cita skills do catálogo (Python, Kubernetes...), que é o
 * que a derivação grava como perfil. Qualquer termo além dos dois na tela dela
 * é vazamento: do vocabulário do dono ou do perfil derivado do currículo.
 */
export const GAP_GUEST_FIXTURE = {
  email: "e2e-lacuna@local.test",
  cv: "# Convidada E2E\n\nSenior data engineer. Python, Spark, Airflow, Kubernetes and PostgreSQL in production for years, serving enterprise customers.",
  keywords: {
    critical: [{ term: "lifecycle", weight: 10 }],
    strong: [{ term: "customers", weight: 6 }],
    stack: [],
    negative: [],
  },
  missing: ["lifecycle"],
  confirmed: ["customers"],
};
