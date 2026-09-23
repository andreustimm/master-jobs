# Mapa de escopo: catálogo de plataformas e busca híbrida

Reconciliação do [PRD](_prd.md) e das [histórias](_user_stories.md) com o que
o código de `dev` já entrega (leitura de 2026-09-23, após o merge da PR #269).
É a entrada da [Tech Spec do residual](_techspec.md) e do
[contrato de testes](_tests.md). O PRD, as histórias e as ADRs locais ficam
intactos como artefatos autorais; onde este mapa diverge deles, vale a leitura
do código aqui registrada e a adenda A6 (runtime só PostgreSQL).

Estado, prioridade e dependências continuam no Project 3 e na issue #223
(regra 24). Este arquivo não comanda nada: ele diz o que existe e o que falta.

## Legenda

- **Entregue** — existe no código de `dev`, com teste, e não deve ser
  reconstruído.
- **Parcial** — existe uma base que o residual estende; o residual não cria
  uma segunda implementação paralela.
- **Lacuna** — não existe; entra no residual.
- **Adiado** — fica fora da primeira leva do residual, com o motivo.

## 1. Catálogo de plataformas (US-001–US-006)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| Tabela `source` (`kind`, `handle`, `label`, `enabled`, saúde `last_*`) | Parcial | `src/core/db/schema.ts` (`source`). Falta aposentadoria (`retired_at`), origem da linha e revisão de configuração. |
| Fonte da verdade do catálogo | Lacuna | `ensureSources()` em `src/core/ingest/run.ts` regrava `config/sources.yaml` a cada sync e força `enabled: true`. Uma edição feita pelo admin seria desfeita no sync seguinte — é o risco que o PRD pede para fechar. |
| Sondagem de handle sem gravar | Parcial | `jho sources probe` (`src/cli.ts`) já sonda sem escrever. Falta a mesma sondagem atrás de guarda de admin na interface. |
| Lista de saúde por fonte | Entregue | `jho sources list` e `app/admin/operacoes/page.tsx` (PR #137). |
| Saúde de captura por termo e cota | Entregue | `app/admin/captures/page.tsx`, `platform_quota`, `term_attribution` (PR #118). |
| CRUD admin, habilitar/desabilitar, aposentar, capacidades na tela | Lacuna | Nada em `app/admin/` edita `source`. |
| Negação para candidato, recrutador e sessão emprestada | Parcial | `can()`/`guard()` e a regra de impersonação já existem; faltam as políticas das ações novas. |

## 2. Execuções de captura (US-007–US-011, US-027, US-028, US-030, US-031)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| Contagens por fonte em uma rodada | Parcial | `SyncSourceResult` em `src/core/ingest/run.ts` conta buscadas, novas, inalteradas, alteradas, reabertas e fechadas, mas **não persiste**: só `source.last_*` é gravado. |
| Completude da listagem e fechamento por ausência | Entregue | `SourceSnapshot.completeness` e `decideAbsenceClosure()` (`src/core/ingest/lifecycle.ts`, PR #269). Janela parcial não fecha nada. |
| Captura por termo, com fila, estados, cota e idempotência diária | Entregue | `term_capture` (migration `0007_term_captures`), `jho terms run/status` (PR #118, `term-search-target-tracks` concluído). É o escopo A2 do PRD e não é refeito. |
| Quem executa rotina longa | Entregue | `WorkflowDispatchPort` (`src/contexts/operations/ports.ts`): a tela pede, o GitHub Actions executa. A Vercel não roda sync (30 s contra 18–27 min). |
| Histórico de execução com escopo, ator, contagens e erro limitado | Lacuna | Não há tabela de execução. |
| Captura de **uma** plataforma | Lacuna | `jho jobs sync` percorre todas as fontes; não aceita fonte. A rotina `sync` do painel também é global. |
| Chave de idempotência e nova tentativa ligada à original | Lacuna | Só `jho scrape retry` (fila de raspagem). |

## 3. Verificação e ciclo de vida (US-012–US-016)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| Só 404/410 fecham; 401/403/429, 5xx e rede são inconclusivos | Entregue | `classify()` em `src/core/ingest/probe.ts` (G26). |
| Fila de reconferência com reabertura | Entregue | `verify_task`, `recordVerdict()` em `src/core/ingest/verify-queue.ts`, `decideReopen()`; `jho recheck queue/run/status`. Recheck com CTE agregado e índice `job_score_job_idx` (PR #269). |
| Última verificação na vaga | Entregue | `job.checked_at`, `check_status`, `check_code`. |
| Histórico de candidatura após fechamento e arquivamento | Entregue | `job-lifecycle-retention` (ADR 0020): `archived_at`, histórico do candidato e do recrutador. |
| Caminho em lote `jho jobs verify` | Parcial | `src/core/ingest/verify.ts` fecha com `closedAt`, mas não grava `check_status`; dois caminhos decidem a mesma coisa com registros diferentes. |
| Evento de verificação (histórico imutável de vivo/fechado/inconclusivo) | Lacuna | Só o último estado fica na vaga; o fechamento anterior se perde na reabertura. |
| Motivo `filled`/`cancelled`/`paused` | Adiado | Nenhum adapter atual prova esses motivos além de 404/410 (pergunta aberta do PRD). O vocabulário entra; só `closed` e `unknown` têm produtor. |
| Disponibilidade na tela com "última verificação" e estado vencido | Lacuna | A tela da vaga não mostra `checked_at` nem distingue "nunca verificada". |

## 4. Busca por texto e proximidade (US-017–US-019, US-021)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| Filtro por termo, palavra inteira, em título, empresa e descrição | Entregue | `src/core/db/repo.ts` com o padrão de `src/core/term.ts` (ADR-012 de `term-search-target-tracks`). Decide **o que** volta (adenda A4). |
| Pré-filtro trigrama indexado (performance 12, #214) | Entregue | Migrations `0012_enable_pg_trgm` e `0013_term_search_trgm`, índices `job_description_trgm_idx` e `job_page_text_trgm_idx` (PR #253). O `~*` continua decidindo. O `status.md` de `performance-buscas` ainda não marca a tarefa 12; a entrega em produção é conferida em #214, não aqui. |
| Filtros exatos (modalidade, fonte, status, piso salarial, fit) | Entregue | Filtros da tela Vagas (v1.18.0) e piso da adenda A5. |
| Termo em localização e habilidades | Lacuna | A4 estende o filtro whole-word a esses campos. |
| Frase entre aspas | Lacuna | O termo é uma expressão; não há análise de consulta. |
| Ordenação por relevância e explicação do casamento | Lacuna | Ordenações existentes: fit, remuneração, recência. |
| Grupo de proximidade (`Techlead` × `Tech Lead` já casa por `[ -]?`; grafia próxima não) | Lacuna | `pg_trgm` está instalado, mas não há `similarity()`/`word_similarity()`. |
| `tsvector`/`websearch_to_tsquery` | Adiado | A4 limita o full-text a sinal de ordenação. Só entra se a medição da ordenação lexical simples (tarefa 05) mostrar que falta sinal; não é pré-requisito de nada. |

## 5. Ordenação semântica opcional (US-020)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| pgvector, tabela de embeddings, porta de embedding | Adiado | Não existe nada. Depende de duas decisões do dono (provedor padrão e orçamento diário, perguntas abertas do PRD) e de ler a disponibilidade de `vector` no Supabase. A busca sem vetor é completa por contrato (ADR-001), então adiar não bloqueia as outras tarefas. Nunca toca o scorer (G11). |

## 6. Análise estruturada (US-022–US-026)

| Parcela | Estado | Onde está / o que falta |
|---|---|---|
| `LlmPort`, cadastro de provedores/modelos BYOK | Entregue | `src/core/llm/port.ts`, `llm_provider`, `llm_model`. |
| `jho analyze <id>` | Parcial | `src/core/llm/analyze.ts` com o prompt `docs/prompts/system/job-analysis.md`. Texto livre no terminal, sem persistência — é a alternativa rejeitada pela ADR-003 local. |
| Análise versionada, estruturada, com proveniência e evidência, pedida da tela | Lacuna | Sem tabela, sem fila, sem versão de esquema. |

## Relação com trabalho vizinho

- **#214 (performance 12)** entregou o índice trigrama como pré-filtro. O
  residual reaproveita esse índice e a extensão; não cria outro índice sobre o
  mesmo texto sem medição.
- **#211 (custo e completude da ingestão)** entregou a completude por fonte.
  O histórico de execução deste residual grava a completude que o adapter já
  declara; não redefine a regra de fechamento.
- **`term-search-target-tracks`** é dono do filtro whole-word, da captura por
  termo e da cota por plataforma. O residual só ordena e explica.
- **ADR 0009** (fila em tabela) é o padrão das filas novas; não existe um
  `QueuePort` genérico, e o residual não cria um sem segunda implementação.
