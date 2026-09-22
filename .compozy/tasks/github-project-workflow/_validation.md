# Auditoria independente do coordenador de tarefas

Auditor: agente independente `coordinator_audit`. Data: 2026-09-22. Worktree: `github-project-workflow`.

**Resultado final do escopo local: PASS. Os oito achados foram corrigidos e verificados.** Esta auditoria cobre comportamento do coordenador, protocolo, política, evidências e workflows. Não certifica o épico inteiro nem substitui `deep-review` após congelar o diff. Que o rollout remoto ainda dependa de main, credenciais e piloto é uma condição de integração prevista, não um defeito presumido.

## Contrato e independência

- Lidos `agent-output-audit/SKILL.md` e os protocolos de avaliador independente, cobertura E2E, higiene de testes e checklist.
- Fontes de requisitos: `parent.json`, `task-3.json`, `task-5.json` e `task-8.json` no diretório temporário local da execução, fora do repositório, correspondentes ao épico #181 e às fatias de comandos, eventos e aceitação.
- A autoridade operacional é o GitHub Project, conforme instrução explícita. Nenhum frontmatter, status de tarefa ou arquivo do produto foi alterado pelo auditor.
- A discovery identificou `pnpm check` e `pnpm test:e2e`. Para esta fatia de ferramenta, foi executado o gate dedicado `pnpm test:tasks`, além de provas negativas independentes. Não houve prova de produção nem alteração remota.
- Os testes com gateway simulado são testes de comportamento/unidade e de contrato, não E2E real do GitHub. O piloto com duas worktrees, runner, token e Project real permanece separado.

## Achados causais

### CA-01 — Major — Uma intenção conflitante parava o inbox inteiro — corrigido e retestado

`drain()` percorria o histórico sem isolar falhas. `process()` lançava `OPERATION_CONFLICT` antes do bloco de captura para um operationId repetido com payload diferente. Todos os comandos posteriores ficavam sem recibo; a mesma intenção interrompia todos os runs futuros, inclusive antes de uma reconciliação administrativa posterior.

Prova inicial: comando A confirmado, reutilização de seu ID com `reason` diferente, heartbeat B válido. `drain()` lançou o conflito e B não recebeu recibo. Após a correção do implementador, `drain()` registrou o conflito e B recebeu recibo.

### CA-02 — Major — Recovery reaplicava conclusão sem evidência/posse atuais — corrigido e retestado

Depois de preparar uma transição e falhar antes de `patchTask`, `recover()` comparava somente a revisão da issue e reaplicava o patch antigo. Head/checks/deployment não integram essa revisão. Além disso, patches terminais têm `execution:null`, ignorando a única checagem anterior de expiração.

Prova inicial: QA → Concluído preparado; transporte falha antes da escrita; evidência passa a falhar; replay confirmou Concluído sem segunda validação. Após a correção, a validação foi executada duas vezes, o resultado permaneceu `uncertain` e o Status continuou QA. A política de assinatura, posse e lease também passou a ser reavaliada antes de nova aplicação.

### CA-03 — Major — Reconcile colidia com a revisão pendente do journal — corrigido e retestado

Quando a coordenação remota continuava N e o recibo preparado continha N+1, `reconcile` preparava outra N+1. A leitura real do adapter então recusava duas revisões máximas iguais, antes de o coordenador conseguir aplicar a reconciliação ou rejeitar o recibo anterior.

A prova combinou o coordenador real com `GitHubGateway.verifyCoordinationJournal`, sem reproduzir essa regra no fake. Inicialmente retornou `uncertain / Ambiguous coordination revision`, sem escrita. Após a correção que considera o maior revision/generation do journal, confirmou a reconciliação e aplicou uma escrita.

### CA-04 — Major — Pausa interrompida não tinha recuperação — corrigido e retestado

Depois de gravar o recibo preparado, falha antes de atualizar o comentário de controle deixava um recibo `uncertain` sem `before` ou `patch`. `recover()` o devolvia indefinidamente. Novos pause/unpause eram recusados pela própria operação pendente. Para unpause, havia ainda o retorno antecipado quando o controle continuava pausado.

Prova inicial: `first=uncertain`, `replay=uncertain`, `next=rejected`, `paused=false`; mensagem: `Unresolved operations prevent pause acknowledgement; reconcile them first`.

Reteste: pause recupera `uncertain → confirmed`; unpause também recupera com controle ainda pausado, finaliza `paused=false` e incrementa `manualEpoch` uma única vez. `controlBefore/controlAfter` dão a precondição para reaplicar apenas o PATCH conhecido.

### CA-05 — Major — Resposta perdida ao criar o recibo duplicava a operação lógica — corrigido e retestado

Se o POST do recibo `prepared` era aplicado e a resposta se perdia, a variável `durable` continuava vazia. O catch publicava um segundo recibo `rejected` para o mesmo operationId. Replay então falhava em `Duplicate trusted receipts` e a CLI também recusava dois recibos. O journal precisa recuperar a persistência ambígua antes de decidir que não existe registro.

Prova inicial: recibos `[prepared,rejected]`, nenhuma escrita de tarefa, retry recusado por duplicidade.

Reteste: a mesma resposta perdida produz um único recibo confirmado e uma escrita. Uma segunda injeção ocultou temporariamente o recibo da leitura de recuperação: o resultado foi `uncertain`, zero escritas e Status Backlog; depois de visível, replay confirmou uma única vez, preservando um único recibo.

### CA-06 — Major — Bootstrap persistido por run que falhou não podia ser renovado — corrigido e retestado

`initialize()` persistia `activation.workflowRun`, mas uma resposta/read-back perdida fazia esse run falhar. A próxima inicialização recusava qualquer controle existente, enquanto o preflight exige sucesso no run registrado. É necessário renovar a atestação de prontidão sem resetar leases/epoch ou duplicar o controle.

Prova inicial em `coordinator-bootstrap-proof.ts`: primeiro erro `control exists, response lost`; retry `Control already exists; initialization never resets leases/epoch`; run persistido permaneceu 10 em vez do novo 11.

Reteste: o retry renovou a atestação para run 11, manteve um único controle e não recriou estado de posse/época. O código preserva o estado existente e substitui apenas `activation`.

### CA-07 — Major — Comando terminal podia escolher smoke antigo — corrigido e retestado

`validateEvidence()` consultava apenas IDs oferecidos no comando. Um run verde antigo do mesmo SHA podia ser apresentado mesmo após um run posterior vermelho. O coletor de eventos já tinha a política de selecionar o último run, mas a transição canônica não a compartilhava. O implementador introduziu `latestWorkflowRun`, cuja consulta exige o run/attempt atual. A prova independente `coordinator-smoke-proof.ts` rejeitou oldGreen/newFailure e aceitou o run atual verde.

### CA-08 — Medium — Workflow não encaminhava eventos de PR ao coletor — corrigido e verificado

`collectEventEvidence` implementa PRs, porém `tasks-project.yml` não declarava `pull_request`/`pull_request_target`, e `tasks-check.yml` só executa o gate de vínculo. Abertura/merge sem um evento de CI correlacionável não alcançava a coleta. Esta lacuna era de ligação entre workflow e código; não pedia transição automática sem assinatura.

Verificação final: o workflow passou a escutar `pull_request_target` para PRs destinadas a dev, filtra o repositório de origem, continua no mesmo grupo serializado e faz checkout explícito de main com credenciais não persistidas. A coleta continua fornecendo evidências, não transições sem assinatura.

## Comandos e provas

| Prova / comando | Saída | Resultado |
|---|---|---|
| Discovery do contrato da skill | exit 0 | Identificou check e E2E do produto |
| `rtk proxy env PATH=…/node/v24.19.0/bin:… pnpm test:tasks`, 12:28 | exit 0; 10 arquivos; 178 testes | Baseline verde |
| `rtk proxy node …/coordinator-independent-proof.ts`, antes dos fixes | exit 0; asserts dos defeitos reproduzidos | CA-01/02/03 reproduzidos |
| Mesma prova, após primeiros três fixes | exit 0 | CA-01/02/03 corrigidos; CA-04/05 reproduzidos |
| `rtk proxy node …/coordinator-bootstrap-proof.ts` | exit 0 | CA-06 reproduzido |
| Scan de skip/only em `tests/tasks-*` | exit 1, sem matches | Nenhum teste desabilitado encontrado |
| `pnpm test:tasks`, 12:37, durante edição simultânea | exit 1; 177 passam, 7 falham | Fixtures de evidence ainda sem a nova porta de último smoke; não é rodada congelada nem suspeita de flaky |
| `pnpm test:tasks`, 12:41, após o ponto estável informado | exit 0; 10 arquivos; 195 testes | Gate específico final verde |
| `coordinator-independent-proof.ts`, reteste final | exit 0 | Inbox, evidência, journal, pause/unpause, resposta perdida e invisibilidade transitória passam |
| `coordinator-bootstrap-proof.ts`, reteste final | exit 0 | Ativação recupera sem duplicar o controle |
| `coordinator-smoke-proof.ts`, reteste final | exit 0 | Smoke antigo recusado quando há run posterior vermelho |

Os scripts de reprodução ficaram no diretório temporário local da execução, fora do repositório; importam os módulos reais. Usam transporte controlado para injetar falhas nas fronteiras, sem escrever no GitHub. Os asserts dos scripts finais exigem o comportamento corrigido. As observações anteriores dos defeitos permanecem documentadas acima.

## Matriz de requisitos e cobertura

| Requisito | Evidência | Situação |
|---|---|---|
| CAN-02 dois claims, mesmo ator | Teste de coordenação, revisão + identidade criptográfica | Coberto sob seção serializada; piloto remoto separado |
| CAN-03/10 geração antiga/outro detentor | Testes de transferência, assinatura e escopo | Coberto em unidade |
| CAN-05 prioridade manual preservada | Patch mínimo + teste de repriorização | Coberto |
| CAN-06 pausa/época invalida comando antigo | Teste de manualEpoch | Coberto, incluindo falha antes de pause e unpause |
| CAN-07 UI fora do protocolo | Teste demonstra overwrite na janela sem CAS | Limitação declarada; não há promessa de exclusão irrestrita |
| CAN-08 repetição/conflito sem duplicação | Testes de UUID/hash + provas CA-01/05 | Coberto, incluindo POST ambíguo e entrada temporariamente invisível |
| CAN-09/12 resposta perdida e crash parcial | Provas CA-02/03/04/05/06 | Coberto nas fronteiras exercitadas, com retestes independentes |
| CAN-04/11/14 entrega do SHA correto | Testes de vínculo, checks, merge, SHA/ambiente, ancestria | Coberto em unidade/contrato; wiring verificado por leitura; piloto remoto separado |
| CAN-13 issue/filho cancelado não conclui | Testes de dependência e aceite agregado | Coberto |

## Higiene e qualidade

- RF-1: nenhum skip/only inserido encontrado. RF-2/RF-4: sem relaxamento de teste anterior ou snapshot modificado observado nesta fatia nova.
- RF-3: mocks presentes, classificados como unidade/contrato; não foram usados como prova E2E do serviço real.
- RF-5: há caminhos negativos relevantes, mas as lacunas de falha entre etapas acima não estavam cobertas inicialmente.
- RF-6: as provas independentes revelaram comportamentos ausentes da suíte inicialmente verde; regressões novas são necessárias para fechar os achados.
- Flaky rate, cobertura global do produto, build e E2E global: não medidos nesta auditoria focada. Não há alegação de PASS nesses gates.
- Zero Critical/High abertos neste escopo: **PASS** após retestar os oito achados. Nenhum defeito aberto remanescente foi identificado nesta auditoria focada.
- Nenhuma tarefa foi marcada concluída ou reaberta por este auditor. A implementação ainda estava ativa e não congelada.

## Pendências externas deliberadas

A prova E2E real exige workflow confiável em main/default, token de Projects, chave privada do escritor no secret, preflight e piloto em duas worktrees. A promoção staging → main continua humana. Esse estado deve constar do handoff; não se deve anunciar que todas as tarefas já são governadas pelo fluxo apenas porque os testes locais passam ou a PR entra em dev.

## Estado examinado no encerramento

Timestamp UTC: 2026-09-22T15:44:03.974784+00:00

Hashes SHA-256 dos arquivos do escopo (a árvore ainda será congelada para deep-review):

```text
7a2e7892c641a924874d8916a6aec7881e09b8be57d36a04447442cf0eadfef7  scripts/tasks/coordinator.ts
2b083365f41600aec4887bb250b5aabbb8039055992ca85573053eaf8765853f  scripts/tasks/domain.ts
94481fc45b3365857fb6216e9e99f258702b631c98a7e0a8548a071af9868388  scripts/tasks/protocol.ts
e10ad6bd761db5bdfb4e2339f0ac2e33c1b523e8405cd3aecfe4fc7f99210eae  scripts/tasks/writer.ts
1c6fc6ec08d256a206ede0d08edf2ec9c4330508e39a516e9fbbd78eb3f67153  scripts/tasks/evidence.ts
8676d01cc641fe88998df8d87c36a959174095b7eca43716adac9a90a4a93eeb  scripts/tasks/check-pr.ts
f0544acbfad2104a8b8b8dafa8688303434dbd05222358e5a7a0c8b9499b8c4f  .github/workflows/tasks-project.yml
66323097d1f4898c14e6ede1d4e4e994a1eafbe1f83df9da68a5a35b234565b7  .github/workflows/tasks-check.yml
```

O PASS se limita ao comportamento local auditado e às provas acima. Não significa PR mesclada, default branch atualizada, migração concluída, token provisionado ou protocolo ativo para os demais agentes. Essas afirmações exigem suas próprias evidências de integração.
