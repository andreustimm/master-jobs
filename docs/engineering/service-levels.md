# Níveis de serviço e governança operacional

O Master Jobs não oferece SLA contratual: não há compromisso externo de
atendimento, disponibilidade ou compensação. Os objetivos abaixo são **SLOs
internos provisórios**, definidos em 22/09/2026 para um serviço pessoal,
operado por Andreus Timm. Dev e staging validam mudanças; a janela de serviço
mede somente produção.

Responsável por metas, incidentes e decisões de risco: **Andreus Timm**.
Revisão semanal do relatório e revisão das metas após os primeiros 30 dias
com cobertura suficiente. Mudar a meta exige PR com justificativa; não apagar
um período ruim nem alterar o denominador para obter conformidade.

## Metas e o que cada uma mede

A configuração executável está em [`POLICY`](../../scripts/governance/model.ts).
A janela móvel é de **30 dias**, incluindo noites, fins de semana e manutenção.

| Indicador | Objetivo inicial | Fonte e denominador | Cobertura atual |
|---|---|---|---|
| Disponibilidade pública observada | **99,5%** dos ciclos bons | Uma sonda a cada 10 min; ciclo bom exige login 200 com marcadores da aplicação, `/jobs` redirecionando para login e perfil inexistente 404 | Workflow `Governança em produção`, após promoção para main |
| Latência pública do login | **95% em até 3 s**, p95 informado | GET completo a `/login` a partir do runner; falhas/timeouts também são eventos ruins | Mesma sonda; inclui acesso ao banco, rede e cold starts |
| Latência das jornadas `/jobs`, `/` e `/searches` | **95% em até 2 s**, por rota | Duração de servidor de todas as requisições elegíveis, incluindo falhas; mínimo de 100 amostras por rota | **Sem dados suficientes**; depende da tarefa 18 e de coleta sem viés |
| Atualização do acervo | **95% das fontes elegíveis com sucesso nas últimas 30 h** | Fontes habilitadas e permitidas em produção; inclui falhas temporárias, exclui somente pausa deliberada | Depende da telemetria B-11; workflow verde sozinho não prova frescor de cada fonte |

SLI é a medição; SLO é a meta. Um SLA acrescentaria um compromisso externo,
que este documento não estabelece. O foco inicial é medir resultados percebidos
pelo usuário com poucas métricas e tornar o custo de falhas explícito, seguindo
o [SRE Workbook](https://sre.google/workbook/implementing-slos/).

A sonda pública exercita o login, que consulta `auth_user`, mas **não** garante
que filtros, CV, funil e outras telas autenticadas funcionem. QA de jornada e
os seus gates continuam necessários. O log de performance que só registra
requisições acima de 1 s não serve de denominador para p95: ele exclui justamente
as requisições rápidas. Benchmarks locais não são medições de produção.

O relatório só declara uma meta pública dentro/fora da faixa após uma janela
completa e cobertura de pelo menos **95% dos 4.320 slots esperados**. Antes disso,
mostra `sem dados` ou `dados insuficientes`. Execuções manuais não aumentam a
cobertura; retries no mesmo slot não diluem falhas. Uma falha prevalece sobre
um sucesso no mesmo slot, por rota, e a maior duração é preservada. O p95 usa nearest rank; medianas pares usam a média
dos dois valores centrais.

## Orçamento de erros e decisão sobre entregas

Para disponibilidade, o orçamento é **0,5% dos ciclos observados**. O relatório
mostra o saldo, inclusive negativo. Com amostragem regular completa, isso
equivale a 21,6 ciclos de 10 minutos em 30 dias; **não é uma medição de 216 minutos
de indisponibilidade real**, pois a sonda não observa os intervalos entre ciclos.

- Sonda fora do contrato: o workflow falha e preserva a evidência. Investigar
  imediatamente ao tomar conhecimento, mesmo durante a formação do baseline.
- Menos de 25% do orçamento restante: priorizar confiabilidade e reduzir o
  tamanho das próximas mudanças. Inspecionar a tendência diária e os incidentes.
- Orçamento esgotado com cobertura suficiente: suspender promoção de features
  para produção até recuperação da janela ou decisão documentada de Andreus.
  Correções de incidente e segurança continuam elegíveis.
- Cobertura insuficiente: investigar a coleta; não declarar o serviço saudável
  por falta de observações. A decisão de release continua humana.

O bloqueio por orçamento é **operacional**, avaliado no relatório antes de
mesclar `staging → main`; não há bloqueio automático de merge implementado.
O monitor não faz rollback, não mescla PRs e não modifica a produção.

Os alertas de erros do Sentry complementam as sondas; um processo encerrado por
limite da Vercel pode morrer antes de enviar evento. Configuração e canário em
[alertas de produção](deploy.md#alertas-de-produção). Burn rates com múltiplas
janelas ficam para quando houver volume/cobertura adequados; percentuais de
pouquíssimas requisições podem gerar ruído. Veja a orientação para baixo tráfego
em [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/).

## Incidentes e recuperação

O atendimento é do responsável, sem escala 24×7. Metas de resposta são de
operação, contadas **após a ciência do responsável**, e não garantias externas.

| Severidade | Exemplo | Objetivo de resposta | Objetivo de restauração |
|---|---|---|---|
| SEV1 | Serviço indisponível, perda/exposição de candidatura ou credencial | Iniciar contenção em até 30 min após ciência | Até 4 h, ou registrar impedimento e próxima ação |
| SEV2 | Busca, login parcial ou rotina principal degradados | Triagem em até 4 h úteis | Até 1 dia útil |
| SEV3 | Defeito limitado, sem perda de jornada principal | Próximo dia útil | Priorizar no backlog |

Registrar início observado, detecção, ciência e restauração separadamente em
[`governance-ledger.json`](governance-ledger.json), com link para evidência e
severidade. `cause` distingue mudança, outra causa e causa ainda desconhecida;
esta última impede afirmar taxa de falha de mudanças. `restoredAt: null` significa incidente aberto. A restauração precisa
ser confirmada pela jornada afetada, e não apenas por um deploy pronto.
Dados de usuário, tokens, URLs com segredo e conteúdo de candidaturas não entram
no ledger público. Canários sintéticos não contam como incidentes do produto.

O ledger tem `schemaVersion: 1`, `recordingStartedAt` e os arrays `changes` e
`incidents`. Datas usam UTC em ISO 8601, como `2026-09-22T12:00:00Z`.
`recordingStartedAt` é uma data ou `null` enquanto o acompanhamento não começou.
Preencha cada entrada com todos os campos abaixo; use `null` quando indicado,
sem omitir a chave.

| Entrada | Campo | Valor e significado |
|---|---|---|
| `changes` | `deploymentId` | ID inteiro positivo do GitHub Deployment, único no array |
| `changes` | `rework` | `true` se a entrega é retrabalho; `false` após avaliar e descartar essa classificação |
| `changes` | `assessedAt` | Data da avaliação |
| `changes` | `evidence` | URL pública da evidência, sem dados privados |
| `incidents` | `id` | Identificador único, por exemplo `INC-2026-001` |
| `incidents` | `severity` | `SEV1`, `SEV2` ou `SEV3`, conforme a tabela acima |
| `incidents` | `startedAt` | Início observado do impacto |
| `incidents` | `detectedAt` | Detecção, igual ou posterior ao início |
| `incidents` | `acknowledgedAt` | Ciência do responsável, igual ou posterior à detecção; `null` se ainda não confirmada |
| `incidents` | `restoredAt` | Restauração confirmada, igual ou posterior ao início; `null` enquanto aberto |
| `incidents` | `cause` | `change` para mudança identificada, `other` para outra causa comprovada ou `unknown` durante investigação |
| `incidents` | `causedByDeploymentId` | ID positivo obrigatório para `cause: "change"`; `null` nos outros dois casos |
| `incidents` | `evidence` | URL pública da evidência do incidente |

Após SEV1/SEV2, registrar causa, impacto, duração, ação preventiva e responsável
em até dois dias úteis. O runbook de conexão/timeouts está em
[`operations.md`](../operations.md#uma-tela-devolve-504-em-produção-e-só-às-vezes).
Não presumir backup ou recuperação comprovados: preservar candidaturas é uma
invariante; RPO/RTO de recuperação de banco só podem ser afirmados depois de um
ensaio documentado.

## Métricas de entrega — DORA

Adotamos as [cinco métricas atuais do DORA](https://dora.dev/guides/dora-metrics/).
O primeiro mês estabelece baseline. Não há meta de quantidade de deploys nem
comparação individual: reduzir espera e retrabalho mantendo estabilidade é o
objetivo. Compare a evolução do próprio projeto.

| Métrica | Cálculo nesta implementação | Fonte |
|---|---|---|
| Frequência de deployments | Deployments bem-sucedidos em produção / 30 dias | GitHub Deployments, criados por `vercel[bot]`, ambiente Production, task deploy; cron e previews excluídos |
| Lead time de mudanças | Mediana entre o commit e sua primeira entrega à produção | Commits completos entre deployments sucessivos + primeiro status success; timestamp do committer |
| Taxa de falha de mudanças | Deployments que causaram incidente / deployments entregues | Incidente ligado explicitamente a deploymentId; não inferir de CI vermelho |
| Recuperação de deployment com falha | Mediana entre início do incidente de mudança e restauração, para incidentes que atravessam a janela | Ledger; incidente aberto, inclusive anterior à janela, impede declarar uma recuperação completa |
| Taxa de deployments de retrabalho | Deployments classificados como retrabalho / deployments entregues | Avaliação explícita por deploymentId; um commit fix não é prova de retrabalho |

A coleta pagina a API e preserva histórico de success mesmo quando o deployment
fica inactive depois. Rollback/divergência ou comparação incompleta deixa lead
time sem dados; não vira zero. IDs repetidos entre páginas contam uma vez,
assim como cada commit na janela.

Antes de calcular taxas de falha/retrabalho, todos os deployments da janela
precisam estar avaliados em `changes`, com `rework`, `assessedAt` e link de
`evidence`. `recordingStartedAt` começa **null**: registre o instante real em que
o acompanhamento de incidentes passou a ser mantido. Sem cobertura da janela,
as taxas permanecem sem dados; ledger vazio não significa confiabilidade 100%.

## Executar, consultar e preservar

```bash
# Só leitura remota: três GETs públicos e APIs do GitHub; requer gh autenticado.
rtk pnpm governance:collect
# Separar uma verificação manual da série agendada.
rtk pnpm governance:collect --out /tmp/master-jobs-governance
```

Saídas em `data/governance/`: `report.md`, `report.json` e `history.json`.
Não versionar esses arquivos. O relatório pode ser compartilhado: guarda apenas
rotas constantes, status, duração, timestamps e metadados públicos de commits e
deployments. Não coleta sessão, texto da página, termos de busca, CV ou IP.

O workflow roda apenas de main, a cada 10 minutos, e lê a evidência anterior
antes de acrescentar uma sonda. Os dados de entrega são renovados diariamente.
Cada artefato contém a série móvel inteira de 31 dias; o GitHub guarda os
artefatos por três dias para limitar armazenamento. Arquivar o relatório mensal
antes de expirar. Se o histórico anterior existir mas estiver expirado/ilegível,
a execução falha e exige recuperação; não apagar arquivos para forçar verde.
A primeira execução inicia uma janela nova, sem retroagir medições.

### Recuperar uma coleta interrompida

`--restore` é usado pelo workflow: exige `GITHUB_REPOSITORY=andreustimm/master-jobs`
e `GITHUB_REF=refs/heads/main`, lê o último artefato válido da branch main e
confere sua origem no workflow `governanca.yml`. Ele valida e restaura somente
`history.json` antes de medir. Não é uma opção de importação de arquivo local.
Não simule essas variáveis no terminal para contornar a restrição.
Sem artefato, também confere `GITHUB_RUN_ID` contra o histórico do workflow:
somente a primeira tentativa (`run_attempt: 1`) da primeira execução comprovada
pode iniciar uma série automaticamente. Reexecutar o mesmo run não autoriza
descartar observações anteriores.

Uma falha fatal informa a etapa com um rótulo fixo: restauração ou validação do
histórico, validação do ledger, sonda, relatório ou persistência. Detalhes de
transporte, conteúdo externo e mensagens de parsers não são publicados.

Para inspecionar ou recuperar uma cópia ainda disponível:

```bash
rtk gh run list --workflow governanca.yml --branch main --limit 10
# Substituir <run-id> por uma execução que tenha publicado o artefato.
rtk gh run download <run-id> --name governanca-producao --dir /tmp/master-jobs-governance-recovery
rtk pnpm governance:collect --out /tmp/master-jobs-governance-recovery
```

O último comando valida a cópia e acrescenta apenas uma sonda manual: ela não
preenche slots que faltaram. Preserve `history.json` junto do relatório ao
arquivar a evidência mensal. A cópia local não é republicada automaticamente
no Actions. Se o problema era acesso à API ou uma regressão do coletor, corrija
a causa e execute novamente `Governança em produção` em main; a restauração
normal retoma do artefato válido e mantém os intervalos sem coleta.

Se todos os artefatos expiraram, só uma cópia previamente preservada permite
investigar a série anterior. Sem cópia, há perda real de observações: registre
o incidente de coleta e mantenha o indicador sem dados. Uma nova série exige
uma mudança explícita revisada, com data de início e justificativa; o coletor
não oferece uma flag para apagar o período ruim ou inventar sua recuperação.

O agendador do GitHub pode atrasar ou descartar execuções; isso aparece como
perda de cobertura, conforme a [documentação de schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
O monitor faz cerca de 12.960 GETs públicos em 30 dias. Revisar esse consumo
junto às cotas existentes; ele não cria conta, plano pago ou segredo novo.
Notificações de falha dependem das preferências existentes do GitHub; recebimento
por e-mail não foi comprovado pelo monitor. O Sentry tem seu alerta independente.

## Gates de governança já obrigatórios

Toda entrega continua exigindo PR para dev, responsável, validação proporcional,
deslop e deep-review SHIP; mudanças visíveis percorrem QA. Dev promove para
staging automaticamente; main exige decisão humana. Previews de branches de
tarefa permanecem desativados. Estes são critérios de liberação, não percentuais
inferidos do dashboard de disponibilidade.
