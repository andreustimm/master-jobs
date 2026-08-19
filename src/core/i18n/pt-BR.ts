/**
 * Português — o dicionário de referência.
 *
 * Este arquivo define o CONTRATO: o tipo `Dictionary` sai dele, então toda
 * chave criada aqui vira obrigatória nos demais idiomas, e faltar uma passa a
 * ser erro de compilação em vez de texto em branco descoberto por um usuário.
 *
 * Convenção de chave: `área.elemento`, sem abreviação. `nav.jobs`, não `n.j`.
 * A chave é lida em revisão de código muito mais vezes do que é digitada.
 */
export const ptBR = {
  nav: {
    cockpit: "Cockpit",
    jobs: "Vagas",
    pipeline: "Funil",
    referrals: "Referrals",
    candidate: "Candidato",
    appearance: "aparência",
    language: "idioma",
    signIn: "entrar",
    signOut: "sair",
    unprotected: "sem proteção",
  },
  theme: {
    title: "tema",
    environment: "ambiente",
    system: "Sistema",
    light: "Claro",
    dark: "Escuro",
  },
  login: {
    title: "Entrar",
    email: "E-mail",
    password: "Senha",
    submit: "Entrar",
    invalid: "E-mail ou senha incorretos.",
    missing: "Informe e-mail e senha.",
    rateLimited: "Tentativas demais. Espere alguns minutos.",
    firstAccess: "Primeiro acesso",
    noAccounts: "Nenhuma conta cadastrada ainda. Crie a sua no terminal:",
    afterCreate:
      "Depois recarregue esta página. A senha é lida do terminal, nunca de argumento — argumento aparece no histórico do shell e em ps.",
    magicLinkHint: "Sem senha definida? Um link de uso único também entra:",
    setPasswordHint: "Definir senha:",
  },
  jobs: {
    title: "Vagas",
    matching: "correspondem aos filtros",
    view: "vaga",
    site: "site",
    apply: "aplicar",
    noDescription: "sem descrição — a nota está subestimada, não baixa",
    anonymousEmployer: "empregador oculto",
  },
  filters: {
    search: "buscar por cargo ou empresa…",
    submit: "Buscar",
    clear: "limpar",
    cut: "corte",
    all: "todas",
    quality: "qualidade",
    unblocked: "sem bloqueio",
    named: "empresa identificada",
    fresh: "recentes",
    described: "com descrição",
    paid: "com salário",
    cluster: "cluster",
    source: "fonte",
    sort: "ordenar",
    byFit: "aderência",
    byRecent: "mais recentes",
    byComp: "maior salário",
  },
  score: {
    title: "Cargo",
    keyword: "Palavras-chave",
    eligibility: "Elegibilidade",
    seniority: "Senioridade",
    compensation: "Remuneração",
    freshness: "Frescor",
    benefits: "Benefícios",
  },
  common: {
    loading: "Carregando…",
    empty: "Nada aqui ainda.",
    back: "voltar",
    close: "Fechar",
  },
} as const;

/**
 * O formato que todo idioma precisa satisfazer.
 *
 * Derivado do português em vez de escrito à mão: um contrato mantido em
 * paralelo com a implementação sai de sincronia, e aqui ele não tem como.
 */
export type Dictionary = {
  [Section in keyof typeof ptBR]: { [Key in keyof (typeof ptBR)[Section]]: string };
};
