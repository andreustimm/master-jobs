/**
 * Casca da aplicação: tela de abertura, transição entre telas, aviso de operação, status de rota, novidades, navegação, tema e os textos comuns.
 *
 * Parte do dicionário de `pt-BR.ts`; o par em inglês é `shell.en.ts`.
 */
export const shellPtBR = {
  /** Tela de abertura e rodapé. Ver `src/core/pwa/splash.ts`. */
  splash: {
    loading: "Carregando o Master Jobs",
  },
  transition: {
    loading: "Carregando a próxima tela",
    updating: "Atualizando esta tela",
    prolonged: "Ainda estamos carregando. Isso está levando mais tempo que o normal.",
    offlineTitle: "Sem conexão",
    offlineBody: "Não foi possível carregar esta tela. Verifique sua conexão e tente novamente.",
    retry: "Tentar novamente",
    failedTitle: "Não foi possível abrir esta tela",
    failedBody: "A navegação falhou. Tente novamente.",
  },
  feedback: {
    success: "Operação concluída com sucesso.",
    error: "Não foi possível concluir a operação. Tente novamente.",
    dismiss: "Fechar notificação",
  },
  routeStatus: {
    forbiddenTitle: "Acesso negado",
    forbiddenBody: "Você não tem permissão para abrir esta tela.",
    notFoundTitle: "Página não encontrada",
    notFoundBody: "Este endereço não existe ou não está mais disponível.",
    back: "Voltar ao início",
  },
  changelog: {
    link: "Novidades",
    title: "Novidades",
    lead: "O que mudou no sistema a cada versão.",
    close: "Fechar",
    internal: "Melhorias internas, sem mudança visível.",
  },
  nav: {
    skipToHeader: "Ir para o cabeçalho",
    menu: "Menu",
    cockpit: "Cockpit",
    jobs: "Vagas",
    pipeline: "Funil",
    referrals: "Referrals",
    candidate: "Candidato",
    compareJob: "Comparar vaga",
    searches: "Buscas",
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
  common: {
    loading: "Carregando…",
    empty: "Nada aqui ainda.",
    back: "voltar",
    close: "Fechar",
    jobs: "vagas",
  },
} as const;
