# ADR 0023 — GitHub Project como autoridade operacional

**Status:** implementação; ativação depende do aceite de [#191](https://github.com/andreustimm/master-jobs/issues/191) · 2026-09-22

## Decisão e fronteira

O [Project 3](https://github.com/users/andreustimm/projects/3) guarda Status,
Prioridade, Tipo, datas observadas e ordem nativa. Issues guardam escopo, aceite,
responsáveis humanos e decisões; relações nativas guardam pai, subtarefas,
dependências e PRs. Git guarda código, especificações e resultados de testes.
Esta decisão substitui apenas a autoridade operacional atribuída ao backlog e
ao grafo local pela ADR 0011. A fronteira do ciclo de vida da documentação continua.

Arquivos Compozy de outras branches nunca são republicados no Project. A CLI
lê o remoto antes de uma operação e pode gerar uma projeção descartável marcada
com revisão e instante. O snapshot ajuda leitura, mas não concede posse nem
autoriza operação offline. Resultados de QA e status de findings são evidência,
não estados concorrentes da tarefa.

## Coordenação e garantias

Todos os pedidos entram como comentários duráveis na [issue de controle
#207](https://github.com/andreustimm/master-jobs/issues/207). Uma Action executa
código de `main` sob um grupo fixo de concorrência, `queue: max` e sem cancelar
o escritor ativo. A ordem é a dos pedidos persistidos; a posição na fila de
Actions não é uma prova de ordem causal. O reconciliador agendado recupera
pedidos cujo run foi cancelado ou não iniciou.

Cada operação possui UUID, hash do payload, revisão esperada e recibo
`prepared`, `confirmed`, `rejected` ou `uncertain`. A confirmação exige nova
leitura do GitHub. Uma resposta perdida não é sucesso; um pedido incompleto
impede novos efeitos naquela issue até sua recuperação. Não há transação entre
campos, comentário e fechamento: os recibos documentam essa fronteira.

Cada execução possui chave Ed25519 própria, vinculada à branch e ao gitdir da
worktree. O comentário de coordenação guarda apenas chave pública, ator,
executionId, worktreeId, geração, revisão e lease de 90 minutos. Uma assinatura
inválida, geração antiga, outro checkout ou lease vencido não autoriza escrita.
Transferência exige a chave pública do destino; expiração nunca apaga WIP.

Recibos, controle e coordenação também são assinados pelo escritor, com uma
chave privada disponível somente à Action confiável. O contexto da assinatura
inclui repositório e issue. A chave pública é versionada; outro processo do
mesmo login GitHub não pode fabricar uma confirmação só copiando metadados.
O journal é confrontado com a coordenação para detectar replay de uma geração
antiga. A garantia pressupõe que o administrador preserve a chave do escritor
e o histórico remoto; não protege contra o dono que apaga toda a auditoria ou
troca deliberadamente o código/chave confiáveis.

## Limite de edição manual

A API de Projects não oferece CAS em `updateProjectV2ItemFieldValue`.
Releitura, timestamp e `clientMutationId` não bloqueiam uma edição de UI entre
leitura e escrita. O teste CAN-07 demonstra essa janela, inclusive uma edição
que pode ser sobrescrita sem ser observada. Não há promessa de exclusão contra
drag-and-drop irrestrito.

Status manual exige `pause`, recibo confirmado, edição e `unpause`; retomar
incrementa o epoch e invalida revisões anteriores. Prioridade e ordem podem
ser editadas durante a execução: transições não escrevem esses campos.
Eventos de PR/CI/deploy produzem sugestões com evidências reconsultadas;
somente a transição assinada pelo detentor altera o Status. Essa escolha evita
transformar um webhook atrasado em decisão de aceite.

## Integração e ativação

Uma PR para `dev` entrega a ferramenta, mas não ativa eventos que dependem da
branch padrão. A promoção `staging → main` continua humana. A credencial
`PROJECTS_TOKEN`, a chave `TASKS_WRITER_PRIVATE_KEY`, os campos e a identidade
precisam de preflight real. O piloto deve comprovar disputa entre duas
worktrees, recibo, transferência e recuperação antes de habilitar
`TASKS_ENFORCEMENT=true` e exigir o check de vínculo na proteção de branches.

`Concluído` depende do contrato de entrega: integração em dev, produção com
deploy e fumaça do SHA que contém a PR, artefato aceito ou operação remota
aceita. Filha cancelada não equivale a entregue. Fechar issue ou mesclar PR
não demonstra esses contratos por si só.

## Alternativas rejeitadas

- Sincronização de arquivos para o quadro: uma branch antiga reverteria
  prioridade, estado ou dependências decididos remotamente.
- Lock por timestamp no Project: a API não possui operação condicional.
- Posse pelo assignee: duas execuções usam o mesmo usuário humano.
- Automação por merge/fechamento sem contrato: confundiria dev com produção.
- Secret em checkout da PR: permitiria código cliente usar privilégio do escritor.

O [contrato operacional](../engineering/github-project-tasks.md) detalha
comandos, transições, recuperação e critérios de ativação.
