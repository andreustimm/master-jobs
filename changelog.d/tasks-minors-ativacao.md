## Técnico

### Corrigido

- Coordenador de tarefas: a janela de entrega começa no **instante** do primeiro claim (`firstClaimedAt`, novo campo opcional do registro de coordenação), não em "Iniciado em". O campo do Project é de data e era lido como meia-noite UTC, aceitando como entrega um merge do mesmo dia anterior ao claim.
- Coordenador de tarefas: o deployment de produção chega às PRs das tarefas pelos commits da promoção `staging → main`. Antes, o SHA de main só resolvia a própria PR de promoção, com base `main`, e a sugestão de "Concluído" em produção nunca disparava. Só deployment Production de main bem-sucedido, de promoção mesclada, é expandido; número de issue ou inexistente numa mensagem é descartado; promoção com 250 commits ou mais pede reconciliação explícita.
- Coordenador de tarefas: tarefa que muda entre o recibo preparado e a escrita recebe `rejected`, não `uncertain` — nada foi escrito, e `uncertain` trancava a issue até uma reconciliação.
- Coordenador de tarefas: um `reconcile` confirmado na retomada também rejeita os recibos pendentes da issue; antes só a primeira tentativa o fazia, e a issue continuava trancada.
- Coordenador de tarefas: retomar um `create` interrompido só acrescenta o pai e as dependências que ainda faltam, porque o GitHub recusa o vínculo repetido.
- `pnpm tasks refresh`: o lock da projeção guarda o pid do dono, e o de um refresh interrompido é recuperado em vez de bloquear todo refresh seguinte.

### Adicionado

- `docs/engineering/github-project-verification.md` (#189): cada cenário CAN-01…14 ligado ao teste que o prova e ao que só o ensaio real prova.
- `tests/tasks-workflows.test.ts` prende a superfície de escrita do coordenador: nenhum caminho para merge, deployment, ref ou dispatch de workflow, e só as seis mutações GraphQL conhecidas.
- `docs/engineering/github-project-tasks.md`: regras nativas do Project antes/depois e a conferência pela UI no corte (#186).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
