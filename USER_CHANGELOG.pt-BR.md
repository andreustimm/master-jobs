# Novidades

O que muda no Master Jobs a cada versão, em linguagem simples. É este arquivo
que aparece no rodapé do sistema quando a interface está em português.

Para o histórico técnico completo — nomes de módulo, decisões de arquitetura,
o defeito exato que cada correção fecha — veja `CHANGELOG.md`.

> **O que não entra aqui.** Caminho de arquivo, nome de tabela, endereço de
> banco, nome de variável de ambiente. Esta tela é aberta por qualquer pessoa
> com acesso ao sistema, e descrever a implementação seria contar como ele é
> montado por dentro. O que se descreve é o efeito.

<!-- sem-nota-usuario: 1.0.1 mudança interna, nada muda para quem usa -->
<!-- sem-nota-usuario: 1.1.1 - 2026-08-22 mudança interna, nada muda para quem usa -->

<!-- sem-nota-usuario: 1.7.0 - 2026-09-16T17:56:44.121Z -->

## [Unreleased]

### Melhorado

- Preparação para buscar vagas de mais de um tipo, com régua própria para cada
  um. As notas de aderência são recalculadas uma vez nesta versão; a nota que
  aparece continua sendo a do seu objetivo principal.

### Corrigido

- Uma vaga arquivada que volta a ser anunciada reaparece na lista de vagas. Antes
  ela voltava a contar como aberta, mas continuava escondida.

## [1.14.2] - 2026-09-19T13:44:44.288Z

### Corrigido

- Endurecimento do aviso de falha: o filtro que impede seus dados de
  acompanharem um relatório de erro passou a cobrir três campos que antes
  escapavam. Nada muda na tela.

## [1.14.1] - 2026-09-19T13:22:18.417Z

### Corrigido

- Endurecimento interno do aviso de falha que entrou nesta versão: um problema
  no próprio mecanismo de aviso não pode mais impedir o sistema de iniciar.
  Nada muda na tela.

## [1.14.0] - 2026-09-19T03:29:37.809Z

### Adicionado

- Quando uma tela falha, o sistema passa a avisar sozinho quem cuida dele. Antes,
  uma falha só era descoberta quando alguém tentava usar o produto e não
  conseguia. O aviso leva o necessário para achar o problema — a tela onde
  ocorreu e o erro técnico — e **não** leva o que você digitou, o que você
  pesquisou, seus dados de acesso nem o conteúdo do seu currículo.

## [1.13.2] - 2026-09-19T02:38:58.911Z

### Corrigido

- Depois da última atualização, todas as telas que mostram vagas, funil ou
  login pararam de abrir e devolviam erro. A conexão com o banco era recusada
  por uma exigência de segurança que estava rígida demais: ela também barrava
  configurações que **aumentam** a proteção, não só as que diminuem. Agora só
  barra o que de fato enfraquece. As telas voltaram, e nenhum dado foi perdido
  nem alterado durante a queda.

## [1.13.1] - 2026-09-18T19:54:03.273Z

### Corrigido

- Abrir o funil numa página que não existe deixa de dizer que você não tem
  candidatura nenhuma. Agora a lista volta para a última página com conteúdo.

## [1.13.0] - 2026-09-18T19:00:08.565Z

### Novidade

- Recrutadores passam a ter uma área própria, com as pessoas que os autorizaram
  a acompanhar o funil. Quem cria essa autorização é o próprio candidato, e o
  recrutador vê apenas o andamento — nunca o funil de quem não o autorizou.

## [1.12.0] - 2026-09-18T18:01:07.970Z

### Melhorado

- A publicação do sistema passa a aproveitar a configuração de banco que o
  provedor já mantém, em vez de exigir uma cópia manual que envelhece. Quando a
  senha do banco é trocada do lado do provedor, o sistema continua no ar sem
  ninguém precisar atualizar nada à mão.
### Corrigido

- Preparar uma versão de teste falhava quando já existia um currículo de exemplo
  gravado com outro nome. Agora a preparação atualiza o currículo que está lá em
  vez de tentar criar um segundo.
### Novidade

- O funil agora mostra quando a vaga foi encerrada ou saiu do quadro, ao lado do
  estágio da sua candidatura. Uma coisa não mexe na outra: a vaga encerrar não
  move você de estágio.
- Dá para filtrar o funil por estágio e percorrer o histórico em páginas. O
  total continua sendo o mesmo enquanto você navega, e o filtro fica no endereço
  — recarregar ou voltar não perde o que você estava vendo.
### Novidade

- A limpeza do acervo ganhou um passo reversível: vagas encerradas há muito
  tempo podem sair da lista ativa sem serem apagadas, e voltam sozinhas se a
  vaga reabrir. Nada do que você registrou sobre uma candidatura — o estágio, as
  anotações, as datas — é tocado nesse passo. Antes de mudar qualquer coisa, o
  comando mostra o que faria.

## [1.11.1] - 2026-09-18T16:55:28.948Z

### Corrigido

- Preparar uma versão de teste com dados de exemplo podia falhar quando duas
  publicações aconteciam ao mesmo tempo. Agora a preparação se acerta sozinha e
  termina com o mesmo conjunto de exemplos, sem repetir nada.

## [1.11.0] - 2026-09-18T15:58:18.484Z

### Melhorado

- A busca automática de vagas só roda no sistema publicado. Versões de teste
  não disparam mais buscas nem consomem a cota dos sites de vagas, mesmo que
  compartilhem alguma configuração por engano.

## [1.10.0] - 2026-09-18T15:23:04.431Z

### Melhorado

- As versões de teste do sistema passam a vir com um conjunto pequeno de vagas
  e contas de exemplo, cobrindo remoto, híbrido, presencial e vagas já
  encerradas. Quem experimenta uma dessas versões vê as telas funcionando sem
  depender de dados reais.

## [1.9.0] - 2026-09-18T15:01:18.066Z

### Melhorado

- Os ambientes de teste do sistema deixam de buscar vagas de verdade: eles
  passam a trabalhar só sobre dados de exemplo. Quem usa o sistema publicado não
  vê diferença; quem experimenta uma versão de teste não consome mais a cota
  dos sites de vagas nem mistura dados reais com ensaio.

## [1.8.0] - 2026-09-18T02:18:09.098Z

### Adicionado

- O detalhe da vaga passa a mostrar o histórico da candidatura: cada mudança de
  estágio com a data e a nota que você escreveu naquele momento.

## [1.7.2] - 2026-09-18T02:01:07.561Z

### Corrigido

- Ao mover uma candidatura, a lista mostra só os estágios para onde ela pode ir
  a partir de onde está.
- Se a mudança for recusada, a nota que você digitou continua na tela, e o aviso
  diz de qual estágio para qual não é possível ir.
- Depois de uma recusa, a tela passa a mostrar o estágio atual da candidatura e
  as opções que realmente levam a algum lugar, sem precisar recarregar.
- Uma nota escrita sem mudar o estágio deixa de ser descartada ao salvar.

## [1.7.1] - 2026-09-16T22:56:50.789Z

### Corrigido

- Valores de remuneração com centavos agora são importados corretamente.

## [1.6.0] - 2026-09-16T05:24:04.621Z

### Melhorado

- As manutenções agora verificam se suas vagas e decisões continuam preservadas
  antes de uma mudança de banco.

## [1.5.0] - 2026-09-16T02:16:17.210Z

### Melhorado

- A busca de vagas passa a descartar automaticamente cópias técnicas que não
  são usadas depois do processamento, mantendo o banco menor e reduzindo o
  risco de indisponibilidade por cota.
- Os contadores do cockpit consultam o acervo com menos leituras, sem alterar
  os filtros nem os resultados mostrados.

## [1.4.1] - 2026-09-15T23:55:25.383Z

### Correção

- Recrutadores e administradores agora encontram as vagas abertas no quadro,
  mesmo sem um perfil de candidato associado, e podem abrir o detalhe e
  exportar a lista sem acessar o funil de outra pessoa.
- Uma conta que deixa de ser candidata não mantém acesso ao seu funil privado
  ao entrar novamente.
## [1.4.0] - 2026-09-15T18:14:00.754Z

### Novidade

- Filtre as vagas por Remoto, Híbrido ou Presencial no painel e na lista de vagas.
  Escolha Todas para incluir também vagas sem modalidade informada.
- A opção ver todas mantém seus filtros, e a paginação preserva a quantidade de
  vagas por página.

### Correção

- Limpar a busca agora esvazia o campo; voltar pelo histórico recupera o texto
  correspondente aos resultados.

## [1.3.10] - 2026-08-28T03:09:49.668Z

### Correção

- Ao girar o aplicativo instalado para a horizontal, o topo volta à altura normal sem
  perder a proteção contra relógio, sinal e bateria no modo retrato.

## [1.3.9] - 2026-08-27T20:34:24.046Z

### Correção

- O aplicativo instalado passa a buscar atualizações quando volta ao primeiro
  plano e troca automaticamente para a versão nova, sem continuar mostrando o
  visual da versão anterior.
- O topo volta a ocupar toda a largura da tela em celular, tablet e computador.
  No celular, o conteúdo aproveita 95% da tela, e os links aparecem diretamente
  no topo sempre que houver espaço para eles.
- A janela de **Novidades** agora aparece somente depois de entrar no sistema.

## [1.3.8] - 2026-08-27T14:52:18.260Z

### Correção

- No aplicativo instalado no celular, o topo voltou a nascer abaixo da barra
  do sistema: relógio, sinal e bateria não ficam mais por cima do nome
  **Master Jobs** nem dos botões, em retrato ou paisagem.

### Melhorado

- O topo ganhou respiro: ficou mais alto e com margem interna em cima e em
  baixo, em qualquer tamanho de tela.
- O conteúdo usa agora a largura inteira da tela com margens iguais dos dois
  lados, do celular ao monitor.

## [1.3.7] - 2026-08-26T20:06:11.585Z

### Correção

- O topo não mostra mais os links empilhados junto com o botão de menu durante
  uma atualização. Em qualquer tamanho de tela, apenas o menu adequado fica
  visível.
- Nomes de conta longos não alargam mais a página nem desalinham os controles
  do topo.

## [1.3.6] - 2026-08-26T16:50:32.312Z

### Melhorado

- O logotipo **Master Jobs** agora leva para a tela inicial, e o menu não
  repete a opção **Cockpit**.
- No celular, o botão de menu abre e fecha a lista sempre que for tocado,
  sem ficar preso aberta.

## [1.3.5] - 2026-08-26T13:25:10.198Z

### Correção

- No celular, o relógio e os indicadores do sistema não cobrem mais a marca nem
  os controles do topo, inclusive na horizontal. O conteúdo aproveita 95% da
  tela, e o menu completo aparece sempre que houver espaço para todos os links.

## [1.3.4] - 2026-08-26T03:36:26.414Z

### Correção

- Em celulares e tablets na horizontal, o topo agora mantém o menu compacto
  até haver espaço para todos os links. O menu aberto também continua abaixo
  do cabeçalho quando a tela gira, sem cortar conteúdo.

## [1.3.3] - 2026-08-25T19:02:27.543Z

### Melhorado

- Ações que salvam, alteram, excluem ou atualizam dados agora mostram uma
  confirmação ou um aviso de erro no idioma ativo. A mensagem desaparece
  sozinha depois de cinco segundos.
- Ao trocar de tela, o carregamento fica centralizado na página inteira,
  inclusive no celular, e os status das candidaturas aparecem traduzidos e em
  ordem alfabética.

### Corrigido

- A janela de edição de conta agora fecha depois que as alterações são salvas
  com sucesso.

## [1.3.2] - 2026-08-25T12:11:42.279Z

### Correção

- No aplicativo instalado no celular, a marca, o menu e os controles do topo
  agora ficam abaixo da barra do sistema, tanto em retrato quanto em paisagem.

## [1.3.1] - 2026-08-25T05:09:18.271Z

### Correção

- Ao abrir ou recarregar uma página inexistente ou sem permissão, a tela de
  abertura não fica mais presa. A mensagem correta aparece e permite voltar
  para uma área disponível da aplicação.

## [1.3.0] - 2026-08-24T20:02:56.775Z

### Novidade

- Ao trocar de tela pelos menus, links, filtros ou histórico do navegador, o
  Master Jobs agora mostra a mesma abertura visual do início do aplicativo.
- Se o aplicativo instalado for aberto sem internet, uma tela segura informa
  a situação e permite tentar novamente sem guardar dados da conta no aparelho.

## [1.2.0] - 2026-08-23T20:57:34.519Z

### Correção

- Leitores de tela agora identificam corretamente o editor de currículo, e os
  dados de contas desativadas permanecem legíveis com contraste adequado.

## [1.1.4] - 2026-08-23T19:19:40.742Z

### Correção

- As telas de **Cockpit** e **Vagas**, a janela de **Novidades** e as janelas de
  administração de contas voltaram a usar espaçamentos consistentes com as
  demais telas.
- Ao editar uma conta, **Salvar alterações** agora fecha a janela quando dá
  certo e mostra uma confirmação. Se algo impedir o salvamento, a janela
  permanece aberta e explica o problema.

## [1.1.3] - 2026-08-23T14:37:30.883Z

### Correção

- A janela de **Novidades** agora ocupa a altura útil do celular. Em alguns
  iPhones, apenas o cabeçalho aparecia e os cards das versões ficavam
  recortados, impedindo abrir e ler as descrições.

## [1.1.2] - 2026-08-23T04:48:48.209Z

### Novidade

- A janela de **Novidades** agora separa cada versão em um card, mantém somente
  a mais recente aberta no início e permite comparar duas ou mais versões
  abertas ao mesmo tempo.
- Datas novas mostram também a **hora local do seu dispositivo**: em português,
  no formato `dd/mm/aaaa HH:mm`; em inglês, `mm/dd/aaaa HH:mm`. Datas antigas
  que não possuem hora confiável continuam exibindo apenas o dia.
- A descrição agora interpreta **negrito**, listas, títulos, links seguros,
  citações e blocos de código sem mostrar os marcadores de Markdown.

### Melhorado

- Mais espaço interno, melhor leitura no celular, rolagem dentro da janela e
  navegação completa por teclado e leitor de tela.

## [1.1.0] - 2026-08-21

### Novidade

- O ranking agora leva em conta **o currículo de quem está logado**. Antes todas
  as vagas eram ordenadas pelo mesmo perfil; agora cada pessoa vê a lista
  montada para o que ela sabe fazer.
- No celular, o **menu deixou de rolar escondido**: um botão abre a lista inteira,
  com os itens grandes o suficiente para tocar.

### Correção

- Com o sistema sob carga, digitar a **senha certa** podia ser recusado como se
  estivesse errada — e ainda descontar da contagem de tentativas. Corrigido.

### Mais rápido

- A atualização diária das vagas ficou **muito mais rápida**: o que antes eram
  milhares de conversas com o banco virou poucas.

## [1.0.0] - 2026-08-21

### Novidade

- O sistema ganhou nome e endereço próprios: **Master Jobs**, em
  `jobs.mastertimm.com.br`.
- Sua conta agora tem **nome completo**, e é o nome que aparece no topo depois
  que você entra — antes aparecia o e-mail.
- Quem administra pode **editar e excluir contas** por uma janela própria, sem
  sair da lista. A exclusão avisa antes o que some junto e o que fica.
- As vagas passaram a ser **buscadas sozinhas, todo dia de madrugada**. Antes
  dependia de alguém rodar a busca no computador.
- Recarregar a página agora mostra uma **tela de abertura** com o nome do
  aplicativo, em vez de piscar branco até tudo carregar.
- Este **histórico de novidades**, aqui no rodapé.

### Correção

- No aplicativo instalado no celular, o **topo da tela não fica mais escondido**
  atrás do relógio e do indicador de bateria.
- Depois de uma atualização, o aplicativo passa a **carregar a versão nova de
  verdade**. Antes ele podia continuar servindo arquivos guardados da versão
  anterior.
- As páginas ficaram **mais rápidas**: o sistema foi aproximado do banco de
  dados, e cada consulta deixou de atravessar o continente.
- Vagas que já foram encerradas são **reconferidas com mais frequência**, então
  a lista mostra menos link que não abre mais.
- Na linha de comando, digitar um número errado em `vaga`, `tarefa` ou `skill`
  agora recebe um aviso curto em vez de uma mensagem técnica extensa — e
  comandos que antes diziam "pronto" sem ter feito nada passaram a avisar.
