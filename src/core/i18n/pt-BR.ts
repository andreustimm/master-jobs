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
    unprotectedTitle:
      "JHO_AUTH_MODE=open — sem autenticação. Currículo, funil e export ficam acessíveis a qualquer requisição. Remova a variável para exigir login.",
  },
  theme: {
    title: "tema",
    environment: "ambiente",
    system: "Sistema",
    light: "Claro",
    dark: "Escuro",
    appearance: "Aparência",
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
    noneWithFilters: "Nenhuma vaga com esses filtros. Afrouxe o corte ou desligue algum critério.",
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
  cockpit: {
    eyebrow: "COCKPIT",
    title: "O que vale seu tempo hoje",
    lead: "Ranqueamento determinístico contra o seu perfil. Cada barra mostra",
    leadStrong: "de onde veio a nota",
    leadTail:
      "— aderência alta sustentada só por elegibilidade e salário costuma ser falso positivo.",
    openJobs: "vagas abertas",
    companies: "empresas",
    namedEmployer: "empresa nomeada",
    unblocked: "sem bloqueio",
    lastThreeDays: "últimos 3 dias",
    bestFit: "melhor fit",
    inPipeline: "no funil",
    topRanked: "Topo do ranking",
    matching: "{count} correspondem",
    seeAll: "ver todas",
  },
  presets: {
    applicableToday: "Aplicáveis hoje",
    applicableTodayHint: "acima de 60, sem bloqueio, empresa identificada",
    recent: "Recém-publicadas",
    recentHint: "últimos 3 dias, sem bloqueio",
    withSalary: "Com salário",
    withSalaryHint: "remuneração divulgada, maior primeiro",
    untriaged: "Não triadas",
    untriagedHint: "ainda fora do funil",
  },
  grid: {
    perPage: "por página",
    density: "densidade",
    comfortable: "confortável",
    compact: "compacta",
    exportCsv: "exportar CSV",
    exportHint: "Exporta as {count} linhas filtradas",
    page: "página",
    of: "de",
    previous: "anterior",
    next: "próxima",
  },
  hints: {
    unblocked: "Esconde vagas que exigem autorização de trabalho, presença física ou W2",
    named:
      "Esconde agregadores que ocultam o empregador — não dá para pesquisar nem acionar rede",
    fresh: "Publicadas nos últimos 3 dias — taxa de resposta muito maior",
    described:
      "Vaga sem descrição zera um componente de 30 pontos — a nota fica não-medida, não baixa",
    paid: "Apenas vagas que divulgam remuneração",
  },
  candidate: {
    toSkills: "skills →",
    toVocabulary: "vocabulário →",
    backToCv: "← currículo",
    title: "Área do candidato",
    cvMarkdown: "Currículo em markdown",
    versionLabel: "Rótulo desta versão",
    save: "Salvar versão",
    importPdf: "Importar de PDF",
    extractText: "Extrair texto",
    edit: "Editar",
    split: "Dividido",
    preview: "Visualizar",
    nothingToShow: "Nada para mostrar ainda.",
    viewMode: "Modo de visualização",
    vimHint: ":w salva",
    versions: "Versões",
    current: "atual",
    chars: "caracteres",
    gapEmpty: "A análise de lacunas aparece assim que houver um currículo salvo.",
    ofJobs: "das vagas",
  },
  skills: {
    confirmedTitle: "Confirmadas",
    rejectedTitle: "Rejeitadas",
    title: "Skills",
    marketWants: "Pedidas pelo mercado, não confirmadas",
    toAudit: "A auditar",
    toAuditCount: "a auditar",
    confirmed: "confirmadas",
    rejected: "rejeitadas",
    confirm: "confirmar",
    reject: "rejeitar",
    redetect: "Redetectar do CV",
    marketThreshold: "Aparecem em pelo menos 15% das vagas acima de 60 de aderência.",
    absent: "ausente",
  },
  /**
   * Categorias de skill. Seção própria porque `Dictionary` tem exatamente dois
   * níveis — e essa restrição é boa: uma chave é sempre `secao.chave`, sem
   * caminho profundo que só se descobre errado em produção.
   */
  /** Descrição de cada tema, por chave — a constante em `src/core/theme.ts`
   *  guarda o caminho, não a frase. */
  themeDescriptions: {
    hp: "Azul corporativo, cantos discretos",
    huly: "Dois acentos, geometria de pílula",
    graphy: "Cobalto, hairline no lugar de sombra",
  },
  /** Histórico de versões do currículo (UI-02). */
  versions: {
    title: "Histórico de versões",
    open: "histórico",
    empty: "Nenhuma versão ainda.",
    close: "Fechar",
    cancel: "Cancelar",
    current: "atual",
    chars: "caracteres",
    view: "Ver",
    restore: "Restaurar",
    rename: "Renomear",
    remove: "Excluir",
    save: "Salvar nome",
    newLabel: "Novo rótulo",
    restoredSuffix: "restaurada",
    rendered: "Renderizado",
    raw: "Markdown",
    sameAsCurrent: "mesmo conteúdo da atual",
    deltaMore: "+{n} caracteres que a atual",
    deltaLess: "−{n} caracteres que a atual",
    confirmDelete: "Excluir “{label}”? A versão não volta.",
    confirmRestore: "Restaurar “{label}”? Ela vira uma versão nova, e a atual continua no histórico.",
    errorNotFound: "Versão não encontrada.",
    errorEmptyLabel: "O rótulo não pode ficar vazio.",
    errorLabelTooLong: "Rótulo longo demais (máximo 120 caracteres).",
    errorIsCurrent: "A versão atual não pode ser excluída. Restaure outra primeiro.",
    errorReferenced: "O funil registra esta versão como enviada. Excluir deixaria a candidatura apontando para um documento que não existe.",
    referencedBy: "Candidaturas que citam esta versão",
  },
  skillCategories: {
    language: "Linguagens",
    framework: "Frameworks",
    ai: "IA",
    cloud: "Cloud e infra",
    data: "Dados",
    practice: "Práticas",
    domain: "Domínios",
    tool: "Ferramentas",
    soft: "Interpessoais",
  },
  vocabulary: {
    title: "Vocabulário",
    quickWin: "Ganho rápido",
    realGap: "Lacuna real",
    covered: "Já coberto",
    doNotInvent: "Não invente experiência",
    cvWrites: "Seu CV escreve",
    noCv: "Nenhum currículo salvo.",
    pasteCv: "Cole o seu currículo",
    toCompare: "para comparar com a linguagem do mercado.",
    backToCv: "currículo",
    coverageNote: "do vocabulário do mercado, ponderado por demanda",
    covered_n: "cobertas",
    vocabularyOf: "de vocabulário",
    realGaps: "lacunas reais",
    jobsWrite: "vagas escrevem",
    jobs: "vagas",
  },
  pipeline: {
    title: "Funil",
    open: "abrir",
    noApplications: "Nada no funil ainda.",
  },
  referrals: {
    title: "Referrals",
    companies: "empresa(s)",
  },
  jobDetail: {
    recheck: "reconferir",
    recheckQueued: "na fila",
    recheckChecking: "conferindo",
    checkedAlive: "link vivo",
    checkedGone: "link morto",
    checkedInconclusive: "sem resposta",
    checkedNever: "nunca conferido",
    checkedOn: "conferido em",
    recheckHint: "Entra na fila. O resultado aparece quando o robô processar.",
    fetchHint: "baixa e organiza as descrições para leitura offline.",
    previewOf: "Prévia de {shown} de {total} caracteres.",
    employmentType: "Contratação",
    workplace: "Modelo",
    seniority: "Nível",
    visa: "Autorização",
    description: "Descrição",
    requirements: "Requisitos e responsabilidades",
    fullDescription: "Descrição completa",
    notCaptured: "Ainda não capturada.",
    openOnSite: "abrir no site",
    capturedOn: "capturada em",
    openFull: "Abrir a vaga completa →",
    aboveCut: "Acima do corte de {cut}, no acervo inteiro.",
  },
  copy: {
    candidateLead:
      "Cole o currículo aqui. Ele fica versionado — cada salvamento vira uma versão, e a anterior continua consultável. Guardar o texto só vale a pena pelo que ele destrava:",
    identityFrom: "identidade vem de {file}, para as duas fontes não divergirem",
    pdfNewVersion: "Vira uma versão nova, como qualquer outra —",
    pdfReviewFirst: "revise antes de confiar",
    pdfCaveat:
      "Extração de PDF erra com layout em colunas, e currículo digitalizado não tem texto nenhum para ler.",
    pdfUploadTodo:
      "Upload de PDF ainda não existe. Quando existir, o texto extraído entra aqui e o arquivo original fica recuperável — o schema já prevê ({fields}).",
    vocabularyWorking: "Vocabulário que já está funcionando",
    skillsLead:
      "Detectadas automaticamente no seu currículo, contra um catálogo global de 100 tecnologias e práticas.",
    skillsDetectedNotConfirmed: "Detectada não é confirmada",
    skillsLeadTail:
      "— o sistema afirma que encontrou uma skill, nunca que você a tem. Só as confirmadas podem ser citadas como experiência.",
    referralsLead:
      "Vagas abertas onde você já conhece alguém. Referrals são ~7% dos candidatos e ~40% das contratações — nenhuma outra alavanca do sistema chega perto.",
    referralsEmpty:
      "na sua rede, nenhuma com vaga aberta no acervo hoje. Isso é uma resposta, não um erro — quando abrir, aparece aqui.",
    referralsSeed: "carrega as empresas onde você já trabalhou.",
    pipelineLead:
      "A única coisa que o sistema não consegue recriar. Nenhuma ingestão escreve aqui — só você.",
    vocabularyLead: "comparar o seu vocabulário com o das vagas que interessam",
    vocabularyGapTitle: "O que as vagas dizem e o seu CV não",
    vocabularyRareTitle: "No CV, mas raro nas vagas do alvo",
    vocabularyCompared: "Comparado com {jobs} vagas acima de {cut} de aderência.",
    vocabularyRareNote:
      "Não significa remover — significa que esses termos não são o que está sendo buscado.",
    vocabLead:
      "Um filtro de ATS não infere sinônimo: quem recruta busca os termos literais do próprio anúncio. Esta página compara a sua linguagem com a de {jobs} vagas acima de {cut} de aderência, e separa falta de palavra de falta de experiência.",
    quickWinNote:
      "Você tem a experiência e o currículo comprova — sob outra grafia. Trocar a palavra é a coisa mais barata desta lista.",
    quickWinWarn: "Trocar a palavra só vale se a evidência já estiver lá.",
    quickWinWarnTail: "para casar com um termo.",
    auditNote: "Cada uma traz a frase do currículo que a produziu, para você julgar.",
    realGapNote:
      "O mercado pede e o currículo não mostra, sob grafia nenhuma. Nem toda lacuna precisa ser fechada — algumas são de vagas que você não quer.",
  },
  common: {
    loading: "Carregando…",
    empty: "Nada aqui ainda.",
    back: "voltar",
    close: "Fechar",
    jobs: "vagas",
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
