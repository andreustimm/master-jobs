/**
 * Contas e perfis do E2E do diretório de recrutadores (#465). `setup.mjs` os
 * grava; a área `recruiter-directory` os percorre.
 *
 *   recruiter — recrutador sem concessão, só para o diretório: o limite de
 *               busca dele é zerado a cada execução, sem dividir janela com
 *               outra área;
 *   admin     — admin sem papel de recrutador nem de candidato: recusado;
 *   paula     — perfil Público, com consentimento do currículo e remoto
 *               mostrado;
 *   rita      — perfil Recrutadores, com conta própria (troca a visibilidade
 *               em `/candidate`) e headline com marcação, que sai como texto;
 *   pedro     — perfil Privado: nunca aparece, nem pelo nome exato.
 *
 * Cada perfil carrega o que NUNCA pode aparecer no diretório (`secrets`):
 * e-mail, telefone e pretensão escritos no currículo, nota e valor discutido
 * numa candidatura.
 */
export const DIRECTORY_FIXTURES = {
  recruiter: { email: "e2e-diretorio-recrutador@local.test" },
  admin: { email: "e2e-diretorio-admin@local.test" },
  paula: {
    slug: "e2e-paula-publica",
    name: "Paula Pública E2E",
    headline: "Engenheira de front-end React",
    location: "Porto Alegre, RS",
    email: "paula.e2e@local.test",
    visibility: "public",
    publicCv: true,
    workModel: ["remote"],
    publicWorkModel: true,
    skills: ["React"],
    cv: [
      "# Paula Pública",
      "",
      "Engenheira de front-end com React e acessibilidade.",
      "",
      "Contato: paula.e2e@local.test · +55 51 99876-5432",
      "",
      "Pretensão salarial: R$ 41.111",
    ].join("\n"),
    note: "nota-secreta-paula",
    rate: "R$ 41.111",
    secrets: ["paula.e2e@local.test", "99876-5432", "41.111", "nota-secreta-paula"],
  },
  rita: {
    // Conta própria: o slug é o que `setup.mjs` deriva do e-mail.
    account: "e2e-diretorio-rita@local.test",
    name: "Rita Recrutadores E2E",
    headline: "Sênior <i>markup</i> Backend",
    location: "São Paulo, SP",
    email: "rita.e2e@local.test",
    visibility: "recruiters",
    publicCv: false,
    workModel: ["remote"],
    // Remoto guardado, mas sem "mostrar": o filtro não pode achá-la por ele.
    publicWorkModel: false,
    skills: ["React", "Kotlin"],
    cv: "# Rita\n\nBackend em Kotlin.\n\nrita.e2e@local.test · (11) 3456-7890\n\nPretensão salarial: R$ 52.222",
    note: "nota-secreta-rita",
    rate: "R$ 52.222",
    secrets: ["rita.e2e@local.test", "3456-7890", "52.222", "nota-secreta-rita", "Backend em Kotlin"],
  },
  pedro: {
    slug: "e2e-pedro-privado",
    name: "Pedro Privado E2E",
    headline: "Sênior React",
    location: "Recife, PE",
    email: "pedro.e2e@local.test",
    visibility: "private",
    publicCv: true,
    workModel: ["remote"],
    publicWorkModel: true,
    skills: ["React"],
    cv: "# Pedro\n\nReact.\n\npedro.e2e@local.test · (81) 3333-4444",
    note: "nota-secreta-pedro",
    rate: "R$ 63.333",
    secrets: ["Pedro Privado E2E", "pedro.e2e@local.test", "3333-4444", "63.333", "nota-secreta-pedro"],
  },
};
