/**
 * Filtros da lista de vagas: rótulos, dicas, atalhos, avisos e países.
 *
 * Parte do dicionário de `pt-BR.ts`; o par em inglês é `filters.en.ts`.
 */
export const filtersPtBR = {
  /** Por que um filtro da URL foi ignorado. Chave = código do aviso. */
  filterNotices: {
    term_too_short: "O termo precisa de pelo menos 2 caracteres; a busca foi ignorada.",
    term_too_long: "O termo passa de 60 caracteres; a busca foi ignorada.",
    term_invalid_char: "O termo tem um caractere não aceito — use letras, números, espaço e + # . - /; a busca foi ignorada.",
    term_no_alnum: "O termo precisa de pelo menos uma letra ou número; a busca foi ignorada.",
    pay_invalid: "O valor da faixa precisa ser um número inteiro de 1 a 2.000.000; o filtro foi ignorado.",
    fit_invalid: "O score precisa ser um número de 0 a 100; o valor ilegível foi ignorado.",
    range_swapped: "O mínimo estava acima do máximo; os dois foram trocados.",
    track_unknown: "Essa trilha não existe ou está arquivada; mostrando a principal.",
    term_unknown: "Esse termo salvo não existe; o filtro foi ignorado.",
    cluster_unknown: "Esse cluster não pertence à trilha escolhida; o filtro foi ignorado.",
    scores_pending: "Suas vagas ainda não têm nota: ela é calculada depois que você salva o currículo. Até lá as vagas aparecem sem nota, e o filtro de Score não as esconde.",
  },
  /** Hub da vaga publicada uma vez por país. */
  jobCountries: {
    back: "← vagas",
    lead: "Esta vaga foi publicada em {countries} países, em {postings} anúncios. Escolha onde quer se candidatar.",
    // O plural estava fixo na frase acima e o número contava marcas, não países:
    // "publicada em 1 países, em 2 anúncios" acontecia com duas cidades do mesmo
    // país, e "2 países" acontecia com um país mais uma localização que não
    // resolve — o mesmo cabeçalho afirmava e negava, duas linhas acima do
    // "1 sem país identificado".
    leadOneCountry: "Esta vaga foi publicada em 1 país, em {postings} anúncios. Escolha onde quer se candidatar.",
    leadNoCountry: "Esta vaga tem {postings} anúncios, nenhum com país identificado. Escolha onde quer se candidatar.",
    withoutCountry: "{count} sem país identificado — a localização aparece como veio.",
    empty: "Nenhuma publicação deste grupo continua aberta.",
  },
  filters: {
    search: "buscar um termo…",
    searchHint: "Palavra inteira no cargo, na empresa, na localização e na descrição: “java” não traz “JavaScript”. Entre aspas, a frase exata.",
    track: "trilha",
    trackPrimary: "principal",
    trackAll: "todas as trilhas",
    broughtBy: "trazida pelo termo",
    broughtByAny: "qualquer",
    pay: "faixa salarial",
    payAmount: "mínimo",
    payMax: "máximo",
    payCurrency: "moeda",
    payPeriod: "período",
    perMonth: "por mês",
    perYear: "por ano",
    payNoFloor: "sem mínimo",
    payNoCap: "sem teto",
    payMinThumb: "piso da faixa salarial",
    payMaxThumb: "teto da faixa salarial",
    apply: "Aplicar",
    disclosedOnly: "só com salário informado",
    submit: "Buscar",
    clear: "limpar",
    score: "score",
    scoreMin: "mínimo",
    scoreMax: "máximo",
    scoreNoFloor: "0",
    scoreNoCap: "100",
    scoreMinThumb: "score mínimo",
    scoreMaxThumb: "score máximo",
    all: "todas",
    quality: "qualidade",
    pipeline: "funil",
    grouped: "agrupar repetidas",
    notApplied: "ainda não enviadas",
    workMode: "modalidade",
    remote: "Remoto",
    hybrid: "Híbrido",
    onsite: "Presencial",
    unblocked: "sem bloqueio",
    named: "empresa identificada",
    fresh: "recentes",
    described: "com descrição",
    paid: "com salário",
    cluster: "cluster",
    company: "empresa",
    companyPlaceholder: "nome da empresa…",
    source: "fonte",
    sourceAll: "todas as fontes",
    sourceCount: "{count} de {total}",
    sort: "ordenar",
    byFit: "aderência",
    byRelevance: "relevância",
    byRecent: "mais recentes",
    byComp: "maior salário",
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
    archived: "Arquivadas",
    archivedHint: "vagas que você tirou das listas",
  },
  hints: {
    unblocked: "Esconde vagas que exigem autorização de trabalho, presença física ou W2",
    named:
      "Esconde agregadores que ocultam o empregador — não dá para pesquisar nem acionar rede",
    fresh: "Publicadas nos últimos 3 dias — taxa de resposta muito maior",
    described:
      "Vaga sem descrição zera um componente de 30 pontos — a nota fica não-medida, não baixa",
    paid: "Apenas vagas que divulgam remuneração",
    track:
      "Qual alvo de carreira dá a nota desta lista. Trocar a trilha reordena tudo, porque a mesma vaga vale notas diferentes para alvos diferentes.",
    broughtBy:
      "Qual das suas buscas salvas trouxe a vaga até aqui. Não muda a nota — só mostra a origem.",
    cluster:
      "O tipo de posição que o score reconheceu no cargo: liderança, arquitetura, IC sênior.",
    grouped:
      "A mesma vaga publicada em vários países vira uma linha só, com a bandeira de cada um. Desligue para ver cada publicação separada.",
    notApplied:
      "Esconde as vagas que você já enviou — vale a data de envio registrada, então uma recusa ou desistência continua escondida",
  },
} as const;
