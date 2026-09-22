# Tarefas no GitHub Project

O [Project 3](https://github.com/users/andreustimm/projects/3) é a referência
operacional de master-jobs. O [épico #181](https://github.com/andreustimm/master-jobs/issues/181)
separa implantação da ferramenta de sua ativação. Durante o bootstrap, somente
ações administrativas registradas nas issues coordenam trabalho existente;
nenhum arquivo local é promovido a fonte da verdade.

## Autoridade e identidade

| Informação | Fonte e escritor |
|---|---|
| Status, Tipo e datas reais | Campos do Project; coordenador serializado |
| Prioridade e ordem | Campos/ordem nativos do Project; decisão humana, preservada pelas transições |
| Escopo, entrega exigida e aceite | Corpo e comentários da issue |
| Responsável humano | Assignees nativos; não representa execução exclusiva |
| Pai, subtarefas e bloqueadores | Relationships nativos; sem grafo local concorrente |
| Código e specs autorais | Git: `.compozy/tasks/<slug>/` e `docs/` conforme ADR 0011 |
| QA, resultados e findings | Artefatos autorais de evidência; não alteram Status por si |
| Posse, geração e lease | Um comentário de coordenação assinado na issue |
| Pedidos e recibos | [Caixa de entrada #207](https://github.com/andreustimm/master-jobs/issues/207); histórico de operações |

`config/tasks-project.json` contém identidades públicas e localização do
escritor. Nenhum token, chave privada ou estado de fila é versionado. IDs de
campos/opções são descobertos e preservados. O Project 2 é referência somente
leitura; este código de setup recusa outro alvo.

## Estados e entrega

O quadro usa a ordem e as cores observadas no Project 2 pela API e pela view,
que divergiam do arquivo local de referência. A ordem visual não define a
máquina de estados.

| Estado (cor) | Entrada e saída |
|---|---|
| Analisar (roxo) | Escopo em análise; pode voltar ao Backlog ou ser cancelado; claim validado inicia execução |
| Backlog (cinza) | Issue incluída; claim exige dependências Concluído, assignee e execução sem concorrente |
| Bloqueado (vermelho) | Detentor registra motivo e estado anterior; resume exige evidência e dependências resolvidas |
| Em execução (azul) | Claim confirmado; trabalho pode ir a QA ou ser bloqueado/cancelado |
| QA (laranja) | Evidência de revisão; pode voltar à execução, seguir a Testando ou concluir entrega de dev/artefato já comprovada |
| Testando (amarelo) | Checks do HEAD atual; pode voltar à execução, seguir a Implantar ou concluir entrega comprovada |
| Implantar (rosa) | Pronto para promoção; passa a Implantando, volta à execução ou conclui entrega já verificada |
| Implantando (roxo) | Promoção em andamento; falha volta a Implantar, sucesso só conclui com o contrato completo |
| Concluído (verde) | Entrega exigida cumprida; grava data real, libera posse e fecha issue como completed |
| Cancelado (cinza) | Motivo explícito; libera posse e fecha como not_planned; não conta como dependência entregue |

`block` é permitido de qualquer estado não terminal com posse. `release`
preserva o estado de trabalho e libera a execução; `transfer` preserva trabalho
e incrementa geração. Heartbeat renova lease válido por 90 minutos. Reabrir
uma entrega terminal exige decisão humana, pausa do escritor, reabertura e
estado coerente na UI, seguida de unpause e novo claim. O histórico permanece.

Toda issue contém exatamente um marcador de contrato de entrega:
`<!-- task-delivery:dev -->`, `production`, `artifact` ou `operation`.
A CLI create/adopt registra o marcador. Issues abertas pela UI são incluídas
automaticamente pelo escritor; sem escolha explícita de entrega, assumem
`production`, que impede uma conclusão prematura. Ajustar esse contrato é uma
decisão explícita no corpo da issue.

| Entrega | Evidência para Concluído |
|---|---|
| dev | PR nativamente vinculada, branch da execução → dev, checks atuais e merge posterior ao primeiro claim ("Iniciado em"), para que reclaim ou transferência durante a espera pela promoção não invalidem a entrega |
| production | Mesmo vínculo/merge + deployment Production bem-sucedido + execução mais recente do workflow exato de fumaça em main, mesmo SHA e posterior ao mesmo merge; ancestralidade comprovada pela API |
| artifact | Comentário do assignee na própria issue com `Entrega aceita:` e link do artefato; motivo de aceite no comando |
| operation | Mesmo aceite explícito, com evidência observável da operação remota |

Merge anterior ao início da execução não encerra automaticamente uma tarefa
nova. Handoff após entrega e importação histórica precisam de reconciliação e
aceite explícitos; não se inventa um novo merge. Um épico só conclui quando
suas subtarefas e dependências estão Concluído. Cancelamento de uma filha exige
decisão de escopo, não soma automática ao progresso entregue.

## Comandos públicos

Pré-requisitos: Node conforme `package.json`, pnpm, Git e `gh` autenticado.
Cada harness chama a mesma CLI e lê primeiro a issue remota.

```sh
rtk pnpm tasks show 184 --json
rtk pnpm tasks preflight --json
rtk pnpm tasks create --title 'Título concreto' --body-file /tmp/task.md \
  --priority Alta --type feat --delivery dev --parent 181 --depends-on 183
rtk pnpm tasks adopt 184 --priority Alta --type feat --delivery dev
rtk pnpm tasks claim 184 --execution <uuid-da-execução>
rtk pnpm tasks heartbeat 184 --execution <uuid> --revision <revisão-lida>
rtk pnpm tasks verify 184 --execution <uuid>
rtk pnpm tasks transition 184 --execution <uuid> --revision <revisão> \
  --status QA --evidence https://github.com/andreustimm/master-jobs/pull/NUMERO
rtk pnpm tasks block 184 --execution <uuid> --revision <revisão> --reason 'Motivo'
rtk pnpm tasks resume 184 --execution <uuid> --revision <revisão> --evidence <url>
rtk pnpm tasks release 184 --execution <uuid> --revision <revisão> --reason 'Handoff registrado'
rtk pnpm tasks key --execution <uuid-do-destino>
rtk pnpm tasks transfer 184 --execution <uuid> --revision <revisão> \
  --to-execution <uuid-do-destino> --to-branch feat/continuacao \
  --to-worktree <id-git-do-destino> --to-public-key <SPKI-base64> --reason 'Handoff'
rtk pnpm tasks refresh 181 --out .compozy/projections/github-project
```

Use slugs de branch ASCII conforme as regras do repositório. A chave de
execução é criada no gitdir real da worktree (`git rev-parse --absolute-git-dir`),
em diretório privado e arquivo 0600; apenas a chave pública sai no comando
`key`. `claim` infere branch/worktree e assina o pedido. O destino de uma
transferência cria sua chave antes e compartilha apenas a pública.

Escritas aceitam `--operation <uuid>` para retomar a mesma operação, e
`--timeout-ms` para limitar a espera. Guarde o UUID retornado. Mesma chave com
payload/ator diferente é conflito. Saída **0** confirma leitura/recibo remoto;
**1** é rejeição/erro; **2** é pendência. Sem confirmação, não iniciar trabalho.

Uma projeção contém origem, revisão e instante. `refresh` exige diretório
exclusivo e recusa sobrescrever arquivos autorais, arquivos desconhecidos ou
projeção modificada. `.compozy/projections/` é ignorado pelo Git. Specs, PRD,
contrato de testes e evidências não são reescritos pelo refresh.

## Edição manual e recuperação

Prioridade e ordem podem mudar durante execução. Para Status manual:

```sh
rtk pnpm tasks pause --reason 'Ajuste manual de Status' --operation <uuid>
# Só após recibo confirmed: editar o quadro e registrar a decisão na issue.
rtk pnpm tasks unpause --reason 'Ajuste conferido' --operation <outro-uuid>
```

Pause é global. Só é confirmada depois de resolver operações incompletas; o
escritor não aceita mutações enquanto pausado. Unpause incrementa epoch e
obriga todos os clientes a reler. Editar Status fora desse protocolo pode
sobrescrever uma decisão sem detecção: a API não tem CAS. O teste CAN-07
documenta esse limite, não declara a janela segura.

Uma resposta perdida depois da escrita é `uncertain`. Repetir o mesmo UUID
permite confirmar a mutação já aplicada, sem criar outra. Divergência parcial
exige administrador, leitura atual e evidência do estado observado/WIP:

```sh
rtk pnpm tasks show 184 --json
rtk pnpm tasks reconcile 184 --revision <revisão-atual> \
  --reason 'Estado remoto conferido; WIP preservado' --evidence <url> --operation <uuid>
```

Reconcile preserva detentor ainda válido e nunca transfere posse implicitamente.
Lease vencido é liberado com nova geração; a worktree antiga não é apagada.
Pedidos substituídos ficam rejeitados com referência à reconciliação. Para
interrupção do serviço, mantenha GitHub como autoridade e use pausa auditada;
nunca recupere o quadro publicando snapshots de branches.

## Automação, CI e segurança

`tasks-project.yml` executa somente checkout de `main`, sem credencial Git
persistida e sem scripts de instalação. Conteúdo de issue é dado validado,
nunca código ou argumento de shell. Todos os escritores usam um único grupo
por Project com `queue: max` e `cancel-in-progress: false`; a agenda de dez
minutos drena intenções duráveis e recupera inclusão de issues perdidas.

Eventos de PR/CI/deploy reconsultam HEAD, tentativa, ambiente, lease e vínculos
nativos, depois registram evidência/sugestão idempotente. Não alteram Status.
Payload atrasado, fechamento ou merge isolado não concluem nem regridem tarefa.
O pipeline dev → staging → main e os deployments de branches permanentes
continuam sob os gates existentes; promoção de main continua humana.

`TASKS_WRITER_ENABLED=true` habilita os eventos automáticos somente depois de
o código confiável e as credenciais estarem prontos. Enquanto a flag estiver
desligada, somente dispatch manual pode inicializar ou recuperar o escritor.
Isso permite integrar o workflow em dev sem executar um arquivo ainda ausente
de main. A flag de enforcement é separada para permitir o piloto.

O check `Vínculo da tarefa / canonical-task` executa código de main e exige PR
para dev com assignee, vínculo nativo, Project, claim válido da branch e
dependências concluídas. Promoção staging → main e retorno main → dev preservam
seus fluxos próprios. `TASKS_ENFORCEMENT=true` habilita o check após o piloto;
ele deve ser incluído nos checks exigidos da proteção de dev durante o corte.

O escritor usa `PROJECTS_TOKEN` com acesso ao Project pessoal e às issues,
PRs, checks e deployments deste repositório. Não há fallback ao `GITHUB_TOKEN`.
O [guia do GitHub para Projects pessoais](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions)
descreve o uso de PAT clássico com escopo `project`; a permissão de repositório
também precisa permitir as operações acima. O provisionamento deve explicitar
esse alcance e a expiração, sem reutilizar automaticamente a sessão local do `gh`.
`TASKS_WRITER_PRIVATE_KEY` assina controle, coordenação e recibos; `writerPublicKey`
permite confirmação independente. Nunca guardar token/chave privada no Git,
comentários ou logs. A credencial administrativa e a chave são provisionadas
separadamente, e ambas precisam de verificação real na Action.

## Setup e corte

`rtk pnpm tasks:setup` exporta estado atual e plano sem escrever.
`--apply --bootstrap` aplica o plano antes de existir controle; depois disso
é obrigatório pausar o escritor. O planejador preserva IDs e opções não
reconhecidas, recusa troca destrutiva de tipo e confirma os campos por releitura.
Opção extra preservada pode reprovar preflight: reconciliar seu significado
manualmente é preferível a apagar itens por inferência.

As regras nativas do Project foram configuradas e conferidas no bootstrap:
sub-issue auto-add, item novo → Backlog e Concluído → fechar issue ativos;
fechar item → Concluído, PR vinculada → Em execução e merge → Concluído
desativados. A API pública não altera essas opções; conferir pela UI antes do
corte. Auto-close reflete uma decisão já validada, não prova entrega.

Sequência de ativação em [#191](https://github.com/andreustimm/master-jobs/issues/191):

1. Concluir revisão/gates e integrar ferramenta e regras em dev.
2. Confirmar a [migração](github-project-migration.md), WIP e vínculos sem duplicação.
3. Promover pelo fluxo normal; a aprovação staging → main é humana.
4. Provisionar os dois secrets, conferir configurações nativas e executar o
   workflow `Coordenador do GitHub Project` com mode `initialize` em main.
5. Habilitar `TASKS_WRITER_ENABLED=true` e fazer piloto com duas worktrees:
   disputar claim, transferir, rejeitar geração
   antiga, pausar/retomar e reconciliar resposta perdida. Guardar links dos runs.
6. Habilitar enforcement e proteção de branch, executar preflight e comprovar
   tarefa real com PR em dev. Só então aceitar #191 e o épico.

`preflight` verifica acesso/campos, assinatura do controle, escritor habilitado e
run de inicialização bem-sucedido na branch/SHA registrados. Nome de secret
ou PR mesclada não substitui essa prova. Se o escritor falhar, o quadro e o
journal continuam no GitHub; corrigir/reconciliar sem habilitar fallback local.
Reexecutar `initialize` após uma falha renova somente a prova de ativação;
preserva epoch, pausa e posses existentes.

## Verificação

`rtk pnpm test:tasks` testa protocolo, assinaturas, API paginada, idempotência,
perda de resposta, lease, projeção, evidência de entrega e gate de PR sem banco
ou dados do produto. `rtk pnpm check` continua sendo o gate geral. Não há mudança
na interface do produto nesta entrega; o piloto operacional é o teste remoto
do fluxo, separado de QA de jornada do dashboard.
O [charter do piloto](../qa/charters/CH-task-worktree-handoff.md) acompanha dois
cenários ainda não testados no QA vivo. Eles são gates da ativação #191 depois
da implantação; o escritor e o enforcement permanecem desativados até suas
respectivas etapas do corte.
