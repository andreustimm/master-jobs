# Reconciliação do legado com o GitHub Project

Este relatório registra o inventário e as decisões de deduplicação da migração
para o [Project 3](https://github.com/users/andreustimm/projects/3), no escopo do
[épico #181](https://github.com/andreustimm/master-jobs/issues/181), do
[inventário #187](https://github.com/andreustimm/master-jobs/issues/187) e da
[migração #190](https://github.com/andreustimm/master-jobs/issues/190).
**O lote foi aplicado e verificado em 22/09/2026: 14 issues criadas no Project,
sem claims ou datas de execução inventadas.** São os 13 candidatos originais
mais a adoção posterior de novidades-build. Isso não conclui a ativação do
controlador nem o piloto de [#191](https://github.com/andreustimm/master-jobs/issues/191).
A fila e os estados vigentes ficam nas issues do Project, conforme o
[fluxo de tarefas](github-project-tasks.md).

## Escopo e rastreabilidade

O snapshot foi coletado em **22/09/2026 às 14:58:37 UTC**, a partir da revisão
[`2621ded9bd62aca301e555c3392c6f89f45142b4`](https://github.com/andreustimm/master-jobs/commit/2621ded9bd62aca301e555c3392c6f89f45142b4).
A coleta leu arquivos, worktrees e metadados do GitHub; não criou issues, não
alterou trabalho de outros agentes e não leu credenciais. A existência posterior
das issues de governança #194–205 foi confirmada por uma leitura REST separada
no mesmo dia e é tratada abaixo como vínculo existente.

O inventário técnico usa o esquema
`master-jobs.project-migration-inventory/v1`. Cada entrada conserva `legacyId`,
`path`, `title`, `classification`, `proposedStatus`, `evidenceURLs`, `unknowns`,
`dedupKey`, revisão da fonte e hash do conteúdo. Propostas de estado não são
comandos nem reivindicações de posse. O JSON da coleta tem SHA-256
`785c017efbd8bbf52e04c1c210ef096cd82bc186d8cfc7e9c4a74c0f076fa931`.
Reexecutar a transformação sobre os mesmos snapshots produziu conteúdo idêntico.

Foram cobertos 110 documentos, oito slugs fora do arquivo, quatro slugs
arquivados e 26 arquivos de tarefa. Estar fora do arquivo não prova que uma
feature ainda esteja ativa. A paginação remota cobriu 193 registros de issues
e PRs, dos quais 11 eram issues e 182 PRs, além de 56 releases, 506 deployments
e todos os 11 itens do Project existentes naquele snapshot.

| Decisão do inventário inicial | Registros | Interpretação |
|---|---:|---|
| Criar somente após nova busca de duplicidades | 13 | Aplicados nas issues #211–223, sem claim. |
| Aguardar confirmação de vínculo com o detentor | 6 | Quatro identidades originais; novidades-build foi adotada depois, em #224. |
| Reutilizar publicação de outro agente | 2 | Duas worktrees da mesma iniciativa de governança. |
| Preservar somente como histórico | 85 | Não gerar issues concluídas a partir de documentos antigos. |
| Reutilizar issue existente | 11 | Épico #181 e suas issues #182–191. |
| **Total** | **117** | Contagem de registros de origem, não de novas tarefas. |

## Resultado aplicado — bootstrap/migração de #190

Antes do lote, a leitura paginada encontrou 24 issues reais e 23 itens no
Project, sem item arquivado e sem correspondência para os 13 candidatos por
marcador, título ou escopo. Cada criação foi precedida por nova leitura. Uma
mudança concorrente na paginação interrompeu a primeira tentativa depois de
#211; a retomada releu o remoto e reutilizou essa issue. A leitura passou a
ordenar por criação ascendente para evitar deslocamento por novas PRs.

O recibo `master-jobs.project-migration-applied/v1` foi confirmado às
**15:56:26 UTC de 22/09/2026**, com SHA-256
`2ed208544cff9ba133515f24caee23bad91a91645a008ab8fcc1d06c6e066d01`.
Ele conserva IDs de issue/item, identidades legadas, ações administrativas,
campos, relações e resultados das releituras, sem credenciais ou caminhos
privados. Os corpos das issues identificam a operação como
**bootstrap/migração de #190** e contêm os marcadores `task-legacy` e
`task-delivery`.

| Resultado confirmado | Quantidade |
|---|---:|
| Issues criadas e incluídas no Project | 14 |
| Novas issues reutilizando código/PR já existente | 2 (#215 e #224) |
| Issues preexistentes adotadas neste lote | 0 |
| Subtarefas nativas do épico de latência #222 | 9 |
| Relações nativas blocked by | 6 |
| Vínculo nativo bidirecional com PR | 1 (#224 ↔ #210) |
| Identidades ainda retidas para coordenação | 3 |
| Registros preservados somente como histórico | 85 |
| Claims e datas de início/fim criados | 0 |

As 14 issues foram relidas abertas, com assignee `andreustimm`, prioridade
Média, Tipo adequado ao escopo e exatamente um item não arquivado no Project.
No recibo, dez estavam em Backlog, duas em Analisar (#211/#223) e duas em
Implantar (#215/#224). Esses valores descrevem o cadastro; não substituem a
leitura atual do Project. B-11 e busca híbrida mantêm as decisões de escopo
pendentes visíveis. A migração não declarou nenhuma entrega concluída.

## Treze candidatos originais importados

As linhas abaixo preservam a identidade de deduplicação e a decisão do
inventário. Não definem prioridade ou ordem de execução. Em uma retomada,
reutilize a issue canônica e leia seu estado e suas relações atuais.

Fontes fixadas na revisão de coleta:
[backlog](https://github.com/andreustimm/master-jobs/blob/2621ded9bd62aca301e555c3392c6f89f45142b4/docs/product/backlog.md),
[performance](https://github.com/andreustimm/master-jobs/blob/2621ded9bd62aca301e555c3392c6f89f45142b4/.compozy/tasks/performance-buscas/status.md) e
[PRD de catálogo e busca híbrida](https://github.com/andreustimm/master-jobs/blob/2621ded9bd62aca301e555c3392c6f89f45142b4/.compozy/tasks/platform-catalog-hybrid-search/_prd.md).

| Origem e escopo residual | `dedupKey` | Condição de reconciliação | Issue canônica |
|---|---|---|---|
| `backlog:B-11` — custo e completude da ingestão no PostgreSQL | `andreustimm/master-jobs::backlog:B-11` | Reescrever o incidente Turso superado; delimitar recheck, completude e orçamento sem duplicar performance 11/14 ou governança operacional. | [#211](https://github.com/andreustimm/master-jobs/issues/211) |
| `backlog:O-02` — mapas de origem no Sentry | `andreustimm/master-jobs::backlog:O-02` | Confirmar detentor; separar source maps de tracing e alertas. | [#212](https://github.com/andreustimm/master-jobs/issues/212) |
| `performance:11` — conjunto filtrado calculado uma vez | `andreustimm/master-jobs::performance:11` | Preservar filtros e contratos existentes; confirmar execução atual. | [#213](https://github.com/andreustimm/master-jobs/issues/213) |
| `performance:12` — busca por termo indexada | `andreustimm/master-jobs::performance:12` | Verificar disponibilidade de `pg_trgm`/`unaccent`, preservar whole-word e reconciliar a parcela lexical da busca híbrida. | [#214](https://github.com/andreustimm/master-jobs/issues/214) |
| `performance:13` — normalização salarial compartilhada | `andreustimm/master-jobs::performance:13` | [PR #192](https://github.com/andreustimm/master-jobs/pull/192) integrada em `dev`; entrega de produção ainda não comprovada na releitura. | [#215](https://github.com/andreustimm/master-jobs/issues/215) |
| `performance:14` — cache de facetas com TTL local | `andreustimm/master-jobs::performance:14` | Depende de performance 11, 12 e da medição de produção; não amplia escopo para Redis/Upstash. | [#216](https://github.com/andreustimm/master-jobs/issues/216) |
| `performance:15` — `loading.tsx` e Suspense em `/jobs` | `andreustimm/master-jobs::performance:15` | Depende de performance 14; preservar a jornada de filtros. | [#217](https://github.com/andreustimm/master-jobs/issues/217) |
| `performance:16` — filtros que se aplicam sozinhos | `andreustimm/master-jobs::performance:16` | Depende de performance 12 e 14; o contrato de URL permanece explícito. | [#218](https://github.com/andreustimm/master-jobs/issues/218) |
| `performance:18` — tracing Sentry sem dados privados | `andreustimm/master-jobs::performance:18` | Verificar quota de spans e API de instrumentação antes de habilitar; não supor coleta segura por omissão. | [#219](https://github.com/andreustimm/master-jobs/issues/219) |
| `performance:6` — overlay somente na troca de rota | `andreustimm/master-jobs::performance:6` | Reconciliar com o comportamento entregue; preservar as transições já cobertas. | [#220](https://github.com/andreustimm/master-jobs/issues/220) |
| `performance:production-baseline` — região efetiva e tempos por estágio | `andreustimm/master-jobs::performance:production-baseline` | Deployment e smoke não comprovam região nem latência de `/jobs`; coletar amostra agregada, sem query string. Entrega: operação confirmada. | [#221](https://github.com/andreustimm/master-jobs/issues/221) |
| `slug:performance-buscas` — épico de latência das buscas | `andreustimm/master-jobs::performance:epic` | Agregar somente residuais; primeira entrega e tarefa 17 já têm evidência de inclusão em produção. | [#222](https://github.com/andreustimm/master-jobs/issues/222) |
| `slug:platform-catalog-hybrid-search` — catálogo administrado e busca híbrida | `andreustimm/master-jobs::compozy:platform-catalog-hybrid-search` | Reconciliar com PRs #118/#137 e performance 12; faltam Tech Spec, contrato de testes e decomposição do residual. A restrição SQLite foi revogada pela adenda A6. | [#223](https://github.com/andreustimm/master-jobs/issues/223) |

As issues #213–221 foram confirmadas como subtarefas nativas de #222. As seis
arestas de dependência publicadas são #216 bloqueada por #213/#214/#221,
#217 por #216 e #218 por #214/#216. Esta frase registra a migração; o grafo
atual é consultado nos Relationships nativos. Uma issue de épico agrega suas
filhas sem duplicar a execução de cada uma. Busca híbrida não substitui o
scorer determinístico nem os filtros exatos.

## Adoção posterior: novidades compiladas no build

A identidade `andreustimm/master-jobs::performance:novidades-build`, antes
retida como `worktree:perf/novidades-build`, foi reconciliada com a entrega
do outro agente e cadastrada como [#224](https://github.com/andreustimm/master-jobs/issues/224).
Uma nova busca paginada não encontrou issue equivalente. O vínculo com a
[PR #210](https://github.com/andreustimm/master-jobs/pull/210) foi criado pela
mutação pública `addCloseIssueReferences` e confirmado pelos dois lados:
`closedByPullRequestsReferences` na issue e `closingIssuesReferences` na PR.

A PR passou de aberta para mesclada durante o preflight da adoção. A releitura
confirmou merge em `dev` às **15:53:44 UTC de 22/09**, SHA
[`7457fce1dd42740a3047590cac51f803765d77bc`](https://github.com/andreustimm/master-jobs/commit/7457fce1dd42740a3047590cac51f803765d77bc),
mantendo o HEAD
[`3387ed288eaa7bec19b03ed1b7797e4464e4a518`](https://github.com/andreustimm/master-jobs/commit/3387ed288eaa7bec19b03ed1b7797e4464e4a518).
Por isso, #224 foi registrada em **Implantar**, com entrega exigida
`production`, e permaneceu aberta após o vínculo. Os checks e a revisão
relatados na PR são evidências do detentor, não testes executados pela migração.
Nenhum claim retroativo foi criado e a publicação de produção não foi presumida.

## Três identidades ainda aguardando vínculo com trabalho existente

Estas linhas registram o que precisava de confirmação na coleta. As worktrees
podem ter avançado ou sido entregues depois; releia PRs e converse com o detentor
antes de importar ou assumir o trabalho. Branch, autor de commit e usuário
GitHub compartilhado não identificam uma execução.

| Identidade (`dedupKey`) | Origens no snapshot | Confirmação necessária | Issue canônica |
|---|---|---|---|
| `andreustimm/master-jobs::backlog:O-01` | Backlog O-01 e `chore/conexao-producao-restrita` | Vínculo com o detentor e evidência do efeito remoto da role restrita. Uma worktree limpa não comprova a troca de conexão; não ler segredos para tentar comprová-la. | Pendente |
| `andreustimm/master-jobs::backlog:O-03` | Backlog O-03 e `chore/alerta-sentry` | Reconciliar o relato de configuração e o canário Sentry com a entrega do outro agente. Disparo da regra não comprova recebimento na caixa do destinatário. | Pendente |
| `andreustimm/master-jobs::operations:service-levels` | `ci/metricas-governanca` | Reutilizar trabalho de SLO, orçamento de erros e métricas; distinguir código em `dev` de ativação do workflow na branch padrão. | Pendente |

## Governança já publicada por outro agente

As worktrees `docs/governanca-regras` e `docs/auditoria-governanca-regras`
representam a mesma identidade de iniciativa:
`andreustimm/master-jobs::governance:rules-audit`. O agente responsável já criou
a [issue #194](https://github.com/andreustimm/master-jobs/issues/194) e as
issues de execução abaixo. Reutilize esses objetos; não importe duas cópias do
plano nem recrie a iniciativa como nova tarefa do legado.

| Issue existente | Escopo publicado |
|---|---|
| [#195](https://github.com/andreustimm/master-jobs/issues/195) | Vincular promoção ao commit validado |
| [#196](https://github.com/andreustimm/master-jobs/issues/196) | Tornar proteções do GitHub efetivas |
| [#197](https://github.com/andreustimm/master-jobs/issues/197) | Cobrir autorização e privacidade em toda entrada |
| [#198](https://github.com/andreustimm/master-jobs/issues/198) | Proteger rede, evidência e preparação sem envio |
| [#199](https://github.com/andreustimm/master-jobs/issues/199) | Alinhar integridade de dados e migrations PostgreSQL |
| [#200](https://github.com/andreustimm/master-jobs/issues/200) | Consolidar entrada e regras canônicas por domínio |
| [#201](https://github.com/andreustimm/master-jobs/issues/201) | Alinhar skills, comandos e referências |
| [#202](https://github.com/andreustimm/master-jobs/issues/202) | Executar browser no CI e explicitar alcance do QA |
| [#203](https://github.com/andreustimm/master-jobs/issues/203) | Adicionar gates leves de governança e PR |
| [#204](https://github.com/andreustimm/master-jobs/issues/204) | Ampliar fitness de domínio e frontend |
| [#205](https://github.com/andreustimm/master-jobs/issues/205) | Verificar resultado final e preparar handoff |

A [issue #188](https://github.com/andreustimm/master-jobs/issues/188) conserva
o escopo de regras e integração do fluxo do Project no épico #181. Sobreposição
com governança exige coordenação entre essas issues, sem duplicar seu trabalho.

## Contradições que a migração deve resolver

| Registro | Evidência posterior ou lacuna | Decisão de migração |
|---|---|---|
| **C-01 — F-07/F-08 ainda mandam implementar no mapa de 16/09.** | F-08: PRs [#91](https://github.com/andreustimm/master-jobs/pull/91), [#92](https://github.com/andreustimm/master-jobs/pull/92), [#93](https://github.com/andreustimm/master-jobs/pull/93). F-07: [#95](https://github.com/andreustimm/master-jobs/pull/95), [#100](https://github.com/andreustimm/master-jobs/pull/100), [#101](https://github.com/andreustimm/master-jobs/pull/101). Seus commits são ancestrais do SHA de produção verificado abaixo. | Preservar contratos e evidência; não repetir a ordem histórica nem criar novas entregas completas. |
| **C-02 — `job-lifecycle-retention/task_03.md` permanece `in_progress`.** | [Fonte fixada](https://github.com/andreustimm/master-jobs/blob/2621ded9bd62aca301e555c3392c6f89f45142b4/.compozy/tasks/job-lifecycle-retention/task_03.md) versus [PR #101](https://github.com/andreustimm/master-jobs/pull/101), que registra UT-007/IT-004/E2E-002 e está incluída no SHA verificado. | Frontmatter e checklist locais não reabrem trabalho entregue. Inclusão do código não inventa uma nova sessão de QA. |
| **C-03 — performance 13 ainda contém nota anterior à PR.** | [#192](https://github.com/andreustimm/master-jobs/pull/192) foi integrada em `dev` em 22/09 às 14:37:35 UTC, SHA [`5ddc1ec`](https://github.com/andreustimm/master-jobs/commit/5ddc1ecdf5bea610670bb44476b28aed6394fca7). [#193](https://github.com/andreustimm/master-jobs/pull/193) estava aberta no snapshot. | Registrar a entrega em `dev`; exigir nova evidência de produção antes de concluir uma tarefa que a requer. |
| **C-04 — plano Supabase ainda descreve pré-corte.** | PRs [#81](https://github.com/andreustimm/master-jobs/pull/81), [#80](https://github.com/andreustimm/master-jobs/pull/80), [#107](https://github.com/andreustimm/master-jobs/pull/107) e [#116](https://github.com/andreustimm/master-jobs/pull/116) registram implementação, corte e correções posteriores. | Não repetir importação ou DDL do plano antigo. O-01 é um residual separado até confirmar o efeito remoto. |
| **C-05 — B-11 mistura incidente Turso e trabalho atual.** | A revisão do backlog de 21/09 registra a varredura ativa, enquanto o texto anterior a chama de desabilitada. O runtime passou a PostgreSQL. Recheck, completude por fonte, orçamento e telemetria exigem delimitação atual. | Reescrever somente o residual, sem reabrir B-12, retenção entregue ou tarefas de facetas. Reler o agendador antes de qualquer alteração. |
| **C-06 — M-06 aparece duas vezes.** | Pedido e entrega se referem à mesma identidade; PRs [#7](https://github.com/andreustimm/master-jobs/pull/7) e [#50](https://github.com/andreustimm/master-jobs/pull/50) são evidências existentes. | Uma identidade, duas origens históricas; nenhuma nova issue completa. |
| **C-07 — plano antigo de autenticação ainda diz planejado.** | [Plano fixado](https://github.com/andreustimm/master-jobs/blob/2621ded9bd62aca301e555c3392c6f89f45142b4/docs/product/task-auth.md) antecede os contratos atuais de autenticação e papéis. | Conservar o plano como histórico; uma nova tarefa exige lacuna concreta no sistema atual. |
| **C-08 — O-03 aparece pendente e há relato local de configuração.** | O outro agente registrou regra e canário; a coleta não verificou a caixa do destinatário nem concede posse sobre sua worktree. | Reutilizar a entrega e sua evidência atual após coordenação; não inferir sucesso de notificação. |
| **C-09 — PRD híbrido inclui parcelas entregues e SQLite.** | [#118](https://github.com/andreustimm/master-jobs/pull/118), SHA [`77db094`](https://github.com/andreustimm/master-jobs/commit/77db094ce3666c839bef83b4e768fa17b0b0a0ff), e [#137](https://github.com/andreustimm/master-jobs/pull/137), SHA [`9f860e9`](https://github.com/andreustimm/master-jobs/commit/9f860e99299751aeb6900d0a411df1addbd6c026), já implementam parcelas. A adenda A6 adota PostgreSQL. | Delimitar catálogo, captura e busca residual antes da decomposição; coordenar índice lexical com performance 12. |
| **C-10 — duas worktrees de governança.** | A iniciativa foi publicada como [#194](https://github.com/andreustimm/master-jobs/issues/194) e #195–205 por seu agente. | Reutilizar as issues existentes; preservar a origem e o WIP, sem publicar um segundo plano. |

## Evidência de entrega e limites

A coleta associou o deployment `6592054627`, ambiente `Production`, ao SHA
[`463688f3704fdd2187732edba798acd1d81a1070`](https://github.com/andreustimm/master-jobs/commit/463688f3704fdd2187732edba798acd1d81a1070),
da promoção humana [#178](https://github.com/andreustimm/master-jobs/pull/178).
Seu status de deployment era sucesso às 13:41:03 UTC, com
[smoke #35734894855](https://github.com/andreustimm/master-jobs/actions/runs/35734894855)
concluído com sucesso no mesmo SHA. Estes são dados do snapshot, não uma
afirmação sobre o deployment mais recente quando este documento for lido.

A verificação de ancestralidade incluiu a primeira entrega de performance
[#175](https://github.com/andreustimm/master-jobs/pull/175), SHA
[`7967112362491c0a8a1abf8bc7f782833baca761`](https://github.com/andreustimm/master-jobs/commit/7967112362491c0a8a1abf8bc7f782833baca761),
e a tarefa 17, [#159](https://github.com/andreustimm/master-jobs/pull/159), SHA
[`a7b431f619f48fa81715a4671da3bad4c52f7adf`](https://github.com/andreustimm/master-jobs/commit/a7b431f619f48fa81715a4671da3bad4c52f7adf).
O SHA de #192 não era ancestral dessa produção. Inclusão de código e smoke
comprovam essa cadeia; não comprovam todos os critérios funcionais, ganhos de
latência, região efetiva ou efeitos externos de configuração.

## Preservação dos 85 registros históricos

Os registros ficam nos documentos e no histórico Git; não viram uma centena
de issues “concluídas”. Entre as origens reconciliadas estão os quatro slugs
arquivados (PRs [#16](https://github.com/andreustimm/master-jobs/pull/16),
[#25](https://github.com/andreustimm/master-jobs/pull/25),
[#27](https://github.com/andreustimm/master-jobs/pull/27) e
[#35](https://github.com/andreustimm/master-jobs/pull/35)), `next-backlog-wave`
([#50](https://github.com/andreustimm/master-jobs/pull/50)), `workspace-hygiene`
([#72](https://github.com/andreustimm/master-jobs/pull/72)) e
`term-search-target-tracks` ([#118](https://github.com/andreustimm/master-jobs/pull/118)).

O inventário distingue 39 alegações históricas com evidência de entrega e 40
alegações históricas não verificadas; essas classificações são diferentes do
destino de importação. Ausência de evidência não autoriza marcar conclusão,
mas também não transforma automaticamente uma alegação antiga em demanda
ativa. Duplicidades exatas, sobreposições e itens superados conservam a origem
e a decisão de reconciliação.

## Corte e verificação ainda necessários

O cadastro deste lote foi confirmado por leitura remota e está identificado
nas issues como bootstrap/migração de #190. O recibo separa a publicação das
issues da execução do trabalho e da ativação do coordenador. Criação de issue
não concede posse a uma execução; o claim segue o protocolo. As três
identidades retidas continuam aguardando a coordenação com seus detentores,
sem alteração de seus arquivos, configuração ou estado remoto nesta migração.

Backlog, mapa Compozy, frontmatter, memória e runs antigos deixam de escrever
status operacional. Projeções são geradas de leitura remota e não importam
alterações locais. Skills e automações que ainda escolham trabalho ou concluam
tarefas a partir desses arquivos precisam ser reconciliadas antes da ativação
do fluxo; o estado de ingestão de vagas do produto é um domínio separado.

A retomada administrativa reutilizou #211 e a releitura do lote inicial
confirmou uma issue por `dedupKey`; #224 também foi retomada pelo marcador,
preservando seu vínculo nativo. Isso não substitui o piloto do coordenador:
ainda é necessário comprovar claims concorrentes, retomada de worktree antiga,
transferência e rejeição de eventos obsoletos no fluxo ativado. Para pausar ou
reverter o controlador, preserve as issues, a trilha de evidência e a
autoridade remota: não restaure o estado de uma branch antiga como fila canônica.
