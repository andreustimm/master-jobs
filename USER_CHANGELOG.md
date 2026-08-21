# Novidades

O que muda no Master Jobs a cada versão, em linguagem simples. É este arquivo
que aparece no rodapé do sistema.

Para o histórico técnico completo — nomes de módulo, decisões de arquitetura,
o defeito exato que cada correção fecha — veja `CHANGELOG.md`.

> **O que não entra aqui.** Caminho de arquivo, nome de tabela, endereço de
> banco, nome de variável de ambiente. Esta tela é aberta por qualquer pessoa
> com acesso ao sistema, e descrever a implementação seria contar como ele é
> montado por dentro. O que se descreve é o efeito.

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
