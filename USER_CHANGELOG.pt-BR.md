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

## [Unreleased]

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
