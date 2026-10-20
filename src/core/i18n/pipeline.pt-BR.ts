/**
 * Funil de candidaturas: etapas, canais e indicações (referrals).
 *
 * Parte do dicionário de `pt-BR.ts`; o par em inglês é `pipeline.en.ts`.
 */
export const pipelinePtBR = {
  /** Os canais que `jho track --channel` documenta; outro valor aparece como a pessoa o gravou. */
  channels: {
    direct: "direto",
    ats: "ATS",
    referral: "indicação",
    recruiter: "recrutador",
    agency: "agência",
  },
  pipeline: {
    title: "Funil",
    open: "abrir",
    noApplications: "Nada no funil ainda.",
    startWith: "Comece pela",
    jobsList: "lista de vagas",
    appliedOn: "aplicado em {date}",
    nextAction: "próximo: {action}",
    jobClosed: "vaga encerrada",
    jobArchived: "vaga arquivada",
    allStages: "todos",
    unknownStage: "Estágio desconhecido; mostrando o funil inteiro.",
    noneInStage: "Nenhuma candidatura neste estágio.",
    broaden: "ampliar busca",
    broadenHint:
      "Também acha sinônimos em português e inglês e cargos com grafia parecida. Ainda não entende o sentido da frase.",
    broadenHintSpelling: "Também acha cargos com grafia parecida. Ainda não entende o sentido da frase.",
    companyAll: "todas as empresas",
    channel: "canal",
    channelAll: "todos os canais",
    noneMatching: "Nenhuma candidatura com estes filtros.",
    clearFilters: "limpar filtros",
    suggestedByRecruiter: "sugerida por recrutador",
  },
  referrals: {
    title: "Referrals",
    companies: "empresa(s)",
    via: "via",
  },
} as const;
