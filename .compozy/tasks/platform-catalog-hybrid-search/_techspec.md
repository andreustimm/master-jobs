# Tech Spec: catálogo de plataformas e busca híbrida (residual)

## Resumo executivo

Esta spec cobre só o **residual** do [PRD](_prd.md), delimitado no
[mapa de escopo](_scope-map.md). A captura por termo, a cota por plataforma, o
filtro whole-word, o pré-filtro trigrama, a completude por fonte, a
reconferência 404/410 com reabertura e o histórico de candidatura já existem e
não são reconstruídos.

O residual tem seis frentes, na ordem de dependência:

1. o banco passa a ser a fonte da verdade do catálogo, com importação única do
   `config/sources.yaml` e relatório de divergência;
2. toda execução de captura e de verificação deixa registro com escopo, ator,
   contagens e erro limitado;
3. o admin opera o catálogo e as execuções pela interface;
4. a verificação guarda eventos, e a vaga mostra disponibilidade com a data da
   última checagem;
5. a busca ganha ordenação por relevância, frase entre aspas, localização,
   explicação do casamento e um grupo separado de termos parecidos;
6. a análise estruturada da vaga fica versionada, com proveniência e evidência
   por campo.

A ordenação semântica (pgvector) fica **adiada** até o dono decidir provedor e
orçamento. A busca sem vetor é completa por contrato (ADR-001 local), então o
adiamento não bloqueia nenhuma das seis frentes.

Runtime só PostgreSQL (adenda A6). Nenhuma frente muda o scorer, o
`profile.yaml` nem `SCORER_VERSION` (G08, G11).

## Arquitetura do sistema

### Visão dos componentes

- **Catálogo** (`src/contexts/sourcing/`) — domínio puro de validação de
  escrita, capacidades derivadas do registro de adapters e decisão de
  importação; infra com as queries de `source`.
- **Execuções** (`src/contexts/operations/`) — domínio puro da máquina de
  estados de execução e da chave de idempotência; infra com `source_run`; a
  `WorkflowDispatchPort` existente passa a aceitar parâmetros.
- **Ingestão** (`src/core/ingest/`) — `syncOne()` e `recordVerdict()` gravam a
  execução-filha e o evento de verificação; continuam sem escrever em
  `application` (G02).
- **Busca** (`src/core/db/repo.ts` + domínio puro de consulta e explicação) —
  mantém o filtro whole-word como único juiz do conjunto; relevância e
  proximidade só ordenam ou aparecem em grupo separado (adenda A4).
- **Análise** (`src/core/llm/` + contexto dono da vaga) — fila em tabela
  (ADR 0009), chamada por `LlmPort`, validação e vínculo de evidência puros.
- **Interface** (`app/admin/plataformas/`, `app/admin/execucoes/`, `/jobs`,
  `/jobs/<id>`) — Server Components, `requirePage`/`guard`, texto do
  dicionário, tokens semânticos, 375 px.

Quem executa trabalho longo continua sendo o executor atrás da
`WorkflowDispatchPort` (hoje GitHub Actions). Nenhuma função da Vercel roda
sync, verificação em lote nem chamada de LLM de análise.

## Design de implementação

### Interfaces principais

```ts
// sourcing/domain — puro
export type Capabilities = {
  snapshot: "complete" | "partial" | "unknown";
  termSearch: boolean;
  verify: boolean;
  statusReason: false; // nenhum adapter atual prova filled/cancelled/paused
};
export function capabilitiesOf(kind: string): Capabilities; // kind fora do registro → tudo indisponível
export type ProbeOutcome = "reachable" | "empty" | "blocked" | "failed";
export function classifyProbe(result: { status: number | null; count: number | null }): ProbeOutcome;
// 401/403/429 → blocked; 5xx, timeout ou rede → failed; nunca "empty" sem resposta 2xx

export type CatalogWrite = {
  kind: string; handle: string; label: string; enabled: boolean;
  secretRef: string | null; // NOME da variável, nunca o valor (G41)
};
export function validateCatalogWrite(
  input: CatalogWrite, existing: { kind: string; handle: string }[],
): { ok: true; value: CatalogWrite } | { ok: false; code: CatalogError };

// CatalogRow carrega managedAt; o regime é por linha, sem chave global.
export function planCatalogImport(
  yaml: CatalogWrite[], db: CatalogRow[],
): { inserts: CatalogWrite[]; mirrors: CatalogWrite[]; orphans: string[]; drift: DriftItem[] };
// orphans = linhas não geridas sem entrada no YAML; a aplicação as desabilita

// operations/domain — puro
export type RunScope =
  | { kind: "source"; sourceId: string }
  | { kind: "all" }
  | { kind: "verify"; sourceId: string | null };
export type RunStatus =
  | "queued" | "running" | "succeeded" | "partial"
  | "failed" | "cancelled" | "interrupted";
export function runKey(scope: RunScope, configRevision: number): string;
export function nextRunStatus(current: RunStatus, event: RunEvent): RunStatus | null; // null = transição recusada
export function isStale(run: { status: RunStatus; heartbeatAt: string }, now: string, leaseMs: number): boolean;

// ingest — puro; reaproveita ProbeVerdict de src/core/ingest/probe.ts
export type StatusReason = "closed" | "filled" | "cancelled" | "paused" | "unknown";
export function currentAvailability(
  events: { checkedAt: string; id: number; verdict: ProbeVerdict }[],
  now: string, staleMs: number,
): "open" | "closed" | "stale" | "unknown";

// busca — puro
export type ParsedQuery = { terms: string[]; phrases: string[] };
export function parseQuery(raw: string): ParsedQuery; // aspas desbalanceadas → texto simples
export type MatchField = "title" | "company" | "location" | "description";
export type RankedRow = { fields: MatchField[]; fit: number | null; postedAt: string | null; id: number };
export function compareByRelevance(a: RankedRow, b: RankedRow): number;
// campo mais forte (título > empresa > localização/descrição), depois fit, recência e id
// A mesma ordem vira o ORDER BY da consulta; o teste compara as duas na fixture.

// análise — puro
export type Provenance = "explicit" | "normalized" | "unknown" | "conflict";
export type AnalyzedField<T> = {
  value: T | null; provenance: Provenance; confidence: number; evidence: string[];
};
export function bindEvidence(raw: unknown, sourceText: string): JobStructure; // trecho que não é substring vira unknown
```

### Modelos de dados

Todas as migrations são **aditivas** (G51 continua suspendendo a promoção
automática até a revisão humana). Toda FK declara `onDelete` por escrito, igual
no DDL (G20).

**`source` (alterada)**

| Coluna | Tipo | Regra |
|---|---|---|
| `retired_at` | `text` nulo | Aposentadoria suave. Aposentada não entra em execução "todas" nem aceita captura; vagas e execuções continuam legíveis. |
| `origin` | `text` (`yaml` \| `admin`) | Quem criou a linha. |
| `config_revision` | `integer` não nulo, padrão 1 | Sobe a cada edição; entra na chave de idempotência e no retrato da execução. |
| `secret_ref` | `text` nulo | Nome da variável de ambiente. Validado por padrão de nome; um valor com cara de chave é recusado antes de gravar. |
| `managed_at` | `text` nulo | Quando a linha passou a ser governada pelo banco (importação ou edição do admin). |

**Fonte da verdade.** Não há tabela de chave-valor no schema, então o regime
é por linha, marcado por `managed_at`:

- linha **não gerida** (`managed_at` nulo) continua espelhando o YAML, agora
  inclusive `enabled: false`. Hoje isso não acontece em dois lugares:
  `parseSourcesConfig()` (`src/core/sources/config.ts`) descarta a entrada
  desabilitada e remove o campo `enabled`, e `ensureSources()` força
  `enabled: true`. A tarefa 01 muda os dois: o carregador devolve a entrada
  com `enabled`, e os chamadores de `loadSources()` que contavam só com as
  habilitadas passam a filtrar explicitamente;
- linha não gerida **sem entrada no YAML** (removida do arquivo) é desabilitada
  pelo espelhamento — hoje ela fica `enabled = true` para sempre;
- `jho sources import --apply` grava o estado do YAML e carimba `managed_at`
  em todas as linhas; toda escrita do admin também carimba;
- linha **gerida** nunca é sobrescrita por `ensureSources()`: o YAML só
  insere o que falta;
- o sync seleciona fontes do banco com
  `enabled and retired_at is null and kind in (<kinds com adapter de sync>)`,
  não mais da lista do YAML. O filtro por kind é o que mantém fora linhas
  como `manual:sample` da fixture (`src/core/db/seed-fixtures.ts`) e a fonte
  `manual` de `src/core/ingest/manual.ts`, que existem em `source` sem adapter;
- `jho sources diff` lista a divergência YAML × banco sem gravar nada.

Banco vazio (local, fixture sintética da ADR 0021) continua funcionando: sem
linha gerida, o YAML inicializa o catálogo como hoje.

**`source_run` (nova)**

| Coluna | Regra |
|---|---|
| `id` | `integer` com identidade, como as demais tabelas |
| `scope_kind`, `source_id` | Escopo da execução. `source_id` com `onDelete: "restrict"` — fonte não é apagada, é aposentada. |
| `parent_id` | Execução "todas" → filhas por fonte. `onDelete: "restrict"`. |
| `retry_of` | Nova tentativa aponta a original, que não muda. `onDelete: "restrict"`. |
| `idempotency_key` | Índice único **parcial** onde `status in ('queued','running')`. |
| `actor_user_id` | Quem pediu; nulo para agendador. `onDelete: "set null"`. |
| `config_snapshot` | `jsonb` com kind, handle, revisão e capacidades no momento do pedido. Nunca segredo. |
| `status`, `heartbeat_at`, `queued_at`, `started_at`, `finished_at` | Máquina de estados de `nextRunStatus()`. |
| `fetched`, `inserted`, `updated`, `unchanged`, `closed`, `inconclusive` | **Nulos** = desconhecido (a tela mostra "desconhecido", não zero). |
| `completeness` | O que o adapter declarou (`SourceSnapshot`). |
| `error_code`, `error_detail` | Detalhe limitado a 500 caracteres, com URL sem query string, sem e-mail e sem telefone (mesma redação de `evidence`). |

Linhas em estado terminal não são atualizadas: toda escrita de progresso
filtra `status in ('queued','running')`, e o teste de integração prova que um
UPDATE numa linha terminal afeta zero linhas. A captura por termo continua em
`term_capture` e aparece só como agregado na tela de execuções (adenda A3).

**`job_check_event` (nova)**

| Coluna | Regra |
|---|---|
| `job_id` | `onDelete: "cascade"` — a retenção só apaga vaga sem candidatura, e o evento não tem valor sem a vaga. |
| `run_id` | `onDelete: "set null"`. |
| `checked_at`, `verdict`, `http_code`, `reason` | `reason` só é diferente de `unknown` com evidência; hoje só `closed` (404/410). |
| `evidence` | Até 280 caracteres, redigido. |

Hoje `recordVerdict(taskId, jobId, verdict, status)` atualiza a vaga e
conclui a linha de `verify_task` em comandos separados, sem transação, e o
caminho em lote `jho jobs verify` não tem `verify_task`. A tarefa 04 separa as
duas metades: uma função `applyVerdict(jobId, verdict, runId)` grava vaga e
evento na mesma transação e é usada pelos dois caminhos; concluir a
`verify_task` fica só na fila. Assim o lote deixa de fechar vaga sem registrar
o veredito.
Chegada fora de ordem: `currentAvailability()` ordena por `checked_at` e
desempata por `id`; um evento mais antigo não reabre nem fecha a vaga.

**`job_analysis` (nova)**

| Coluna | Regra |
|---|---|
| `job_id` | `onDelete: "cascade"`. |
| `requested_by` | `onDelete: "set null"`. Visível só para admin. |
| `retry_of` | `onDelete: "restrict"`. |
| `status` | `queued`, `running`, `succeeded`, `partial`, `failed`, `paused_quota`, `interrupted`. |
| `claimed_at`, `heartbeat_at` | Lease do processador. `running` sem batimento além do lease vira `interrupted` pela mesma `isStale()` de `source_run`, e sai do índice de idempotência; sem isso, um processador morto prenderia a vaga para sempre. |
| `input_hash` | SHA-256 do texto normalizado analisado; a tela compara com o texto atual para mostrar "vaga mudou depois da análise". |
| `prompt_version`, `schema_version`, `provider_slug`, `model_id` | Nunca a chave. |
| `result` | `jsonb` validado por Zod depois de `bindEvidence()`. |
| `input_tokens`, `output_tokens`, `cost_estimate` | Só admin vê. |
| chave de idempotência | Índice único parcial em `(job_id, input_hash, schema_version)` onde `status in ('queued','running')`. |

A análise é da **vaga**, não da pessoa: o prompt novo
(`docs/prompts/system/job-structure.md`) não recebe CV, perfil nem dossiê.
Por isso um resultado pode ser lido por qualquer sessão que pode ler a vaga
sem vazar dado de candidato. O `jho analyze` atual, que usa o dossiê, continua
como está e não é substituído.

### Contratos de entrada

Novas entradas e as políticas que exigem (inventário de G39/G40):

| Entrada | Política | Observação |
|---|---|---|
| `/admin/plataformas`, `/admin/plataformas/[id]` | `requirePage` com permissão de operação | Página de admin |
| `/admin/execucoes`, `/admin/execucoes/[id]` | idem | Termo de captura nunca aparece (A3) |
| Actions: salvar, habilitar, desabilitar, aposentar, sondar fonte | `guard` admin; sessão emprestada nega (G24) | Sondar não grava vaga nem saúde |
| Actions: buscar agora, buscar em todas, atualizar status, tentar de novo | idem | Criam `source_run` e despacham |
| Action: pedir análise | `guard` de leitura da vaga | Vaga ilegível → mesma resposta de inexistente |
| Action: tentar análise de novo | `guard` admin | |

CLI:

```text
jho sources import [--apply]          # padrão: simulação
jho sources diff
jho jobs sync --source <kind:handle> [--run <id>]
jho jobs verify --source <kind:handle> [--run <id>]
jho analysis queue|run|status         # não colide com o `jho analyze <id>` existente
```

URL da busca: `sort=relevance` só é aceito com `q` não vazio; sem `q`, cai
para a ordenação padrão (fit). O grupo de proximidade não tem parâmetro: ele
aparece quando há `q` e nunca altera a contagem do resultado principal.

## Pontos de integração

- **PostgreSQL/Supabase** — `pg_trgm` já habilitado (migration `0012`).
  `word_similarity()` usa a extensão existente. Não há índice trigrama em
  `job.title` (só em descrição e texto de página), então a tarefa 05 cria
  `job_title_trgm_idx` (GIN, parcial em `closed_at is null`) em migration
  aditiva própria. Numa fixture pequena o planejador escolhe varredura
  sequencial de qualquer forma; por isso o teste prova que o índice existe e
  é elegível (`EXPLAIN` com `enable_seqscan = off` dentro da transação do
  teste), não que o planejador o prefere.
- **GitHub Actions** — `WorkflowDispatchPort.dispatch()` ganha parâmetros
  (`routine`, `source`, `run`). O workflow recebe os insumos e chama a CLI.
  Sem credencial, a execução fica `queued` com o motivo visível, e não some.
- **`LlmPort`** — provedor e chave pelo cadastro BYOK; cota esgotada vira
  `paused_quota` com nova tentativa possível.

## Análise de impacto

| Componente | Tipo | Descrição e risco | Ação |
|---|---|---|---|
| `src/core/db/schema.ts`, `drizzle/postgres/` | alterado | 3 tabelas novas e 5 colunas em `source`; migration aditiva | `onDelete` escrito; `docs/data-model.md` |
| `src/core/ingest/run.ts` | alterado | `ensureSources()` muda de regime depois da importação | teste dos dois regimes |
| `src/core/ingest/verify.ts`, `verify-queue.ts` | alterado | caminho único de veredito | não afrouxar G26 |
| `src/contexts/operations/` | alterado | porta com parâmetros; estados de execução | reserva antes do `await` (G13) |
| `src/core/db/repo.ts` | alterado | relevância e grupo de proximidade | mesmo conjunto com `sort=relevance` e `sort=fit`; sem casamento em localização, conjunto idêntico ao de antes |
| `src/core/llm/` | alterado | análise estruturada e prompt novo | `docs/prompts/system/` |
| `app/admin/`, `app/jobs/` | novo/alterado | telas e textos | `tests/e2e/routes.mjs`, i18n, 375 px |
| `.github/workflows/` | alterado | insumos do dispatch | teste de isolamento de ambiente |
| `docs/` | alterado | `sources.md`, `cli.md`, `data-model.md`, `operations.md`, `product/` | regra 23 |

## Abordagem de testes

Contrato completo em [`_tests.md`](_tests.md). Domínio puro em Vitest
exaustivo; integração contra o PostgreSQL descartável com migrations reais;
E2E no harness isolado com personas admin, candidato, recrutador e sessão
emprestada. HTTP de fonte e de LLM são falsos só na borda; nenhum teste aponta
para Supabase, board público ou provedor de LLM real.

## Sequência de desenvolvimento

### Ordem de construção

1. Catálogo no banco, importação única e divergência (tarefa 01).
2. Histórico de execução e captura de uma fonte (tarefa 02).
3. Telas do catálogo e das execuções (tarefa 03).
4. Eventos de verificação e disponibilidade na vaga (tarefa 04).
5. Relevância, aspas, localização, explicação e proximidade (tarefa 05) —
   independente das anteriores.
6. Análise estruturada (tarefa 06) — independente das anteriores.
7. Ordenação semântica (tarefa 07) — bloqueada por decisão do dono.

### Dependências técnicas

- Decisão do dono: provedor de embedding e orçamento (só a tarefa 07).
- Janela humana para aplicar migration em produção (G51).
- Leitura, no Supabase de produção, da disponibilidade da extensão `vector`
  antes da tarefa 07; não supor instalada.

## Monitoramento e observabilidade

Por execução: contagens, duração, completude e código de erro, só agregados.
Por análise: status, tokens e custo estimado. Nunca registrar descrição de
vaga, termo de candidato, CV, URL com query string, chave nem corpo de
resposta de provedor. Execução `running` sem batimento além do lease vira
`interrupted` na leitura seguinte e oferece nova tentativa.

## Considerações técnicas

### Decisões

- **Regime por linha (`managed_at`) em vez de trocar a fonte da verdade de
  uma vez** — ambientes vazios e fixtures continuam inicializando pelo YAML;
  produção muda por um comando explícito e auditável, e uma edição do admin
  protege só a linha que ele tocou.
- **A ordenação não muda o conjunto** — para os mesmos filtros e o mesmo
  termo, `sort=relevance` e `sort=fit` devolvem as mesmas vagas e a mesma
  contagem. A extensão à localização muda o conjunto de propósito (A4), e por
  isso é medida à parte: numa consulta cujo termo não aparece em nenhuma
  localização, o conjunto é idêntico ao de antes da tarefa 05.
- **Sem `QueuePort` genérica** — há uma só implementação de fila (tabela,
  ADR 0009). A variação real é quem executa, e ela já tem porta.
- **Relevância por campo casado, sem `tsvector` na primeira leva** — o filtro
  whole-word já decide o conjunto (A4); ordenar por onde o termo casou
  (título > empresa > localização/descrição) com desempate por fit, recência e
  id é determinístico e explicável. `ts_rank` entra só se a medição mostrar
  falta de sinal.
- **Habilidades não ganham campo próprio** — a vaga não persiste habilidades;
  elas estão na descrição, que o filtro já cobre. A4 fica atendida por
  localização + descrição.
- **Proximidade em grupo separado e limitado** — `word_similarity()` do termo
  contra o título, limiar constante calibrado na fixture, no máximo 20 itens,
  só entre vagas que passam pelos filtros exatos e **não** casaram o termo.
  O resultado principal e sua contagem não mudam.
- **Análise sem dado de candidato** — torna o resultado compartilhável entre
  sessões e elimina o risco de vazar CV por um campo de evidência.
- **Evidência verificada por substring** — trecho que não aparece no texto
  normalizado da vaga rebaixa o campo para `unknown` (regra 7 aplicada à vaga).

### Riscos conhecidos

- Limiar de proximidade mal calibrado gera ruído: o grupo é separado, rotulado
  e limitado, e o teste de fixture fixa exemplos positivos e negativos.
- A latência da análise via executor externo pode passar de um minuto: a tela
  mostra pendente que sobrevive a refresh; se virar incômodo, a decisão de
  executar na própria requisição volta para o dono com medição.
- A importação do catálogo pode divergir do YAML versionado: `jho sources diff`
  existe para isso e a documentação de operação registra quando rodá-lo.

## Registros de decisão

- [ADR-001: Busca híbrida com fallback lexical](adrs/adr-001.md)
- [ADR-002: Definição de fonte separada do escopo de busca](adrs/adr-002.md)
- [ADR-003: Análise da vaga versionada e presa à evidência](adrs/adr-003.md)
- [ADR 0009: Fila em tabela](../../../docs/adr/0009-fila-de-raspagem.md)
- [ADR 0020: Ciclo de vida e histórico de candidaturas](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)
- [ADR 0021: Ambientes não produtivos com dados sintéticos](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)
