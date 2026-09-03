# Incidente de cota do Turso — 03/09/2026

**Status:** contido temporariamente; correção definitiva pendente.

**Ambiente afetado:** produção (`master-jobs`).

**Impacto:** o Master Jobs consumiu quase toda a cota compartilhada da
organização Turso e passou a ameaçar também o Contas Casal. A aplicação segue
disponível, mas as duas automações que iniciavam a varredura foram desligadas.
Leituras normais da aplicação não foram bloqueadas.

## Contenção aplicada

Às 14:45 BRT de 03/09/2026, os dois gatilhos externos conhecidos estavam
desligados:

| Gatilho | Execução anterior | Estado atual |
|---|---|---|
| GitHub Actions `Varredura de vagas` | diariamente às 03:00 BRT, além de execução manual | `disabled_manually` |
| Vercel Cron `/api/cron/recheck` | diariamente às 07:00 BRT | cron do projeto desabilitado (`disabledAt = 2026-09-03T17:45:28.794Z`) |

O bloqueio do cron da Vercel é por projeto. A definição continua aparecendo na
lista, mas não é executada enquanto `disabledAt` estiver preenchido. Esse é o
comportamento documentado pela própria Vercel em
[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### Como verificar a contenção

Não exponha o conteúdo das variáveis do projeto ao guardar evidências.

```bash
rtk gh api repos/andreustimm/master-jobs/actions/workflows/varredura.yml \
  --jq '{name,state,path}'

rtk vercel api \
  "/v9/projects/prj_JmXV32dUXEZwSPVXPdIwT6ydLcbc?teamId=team_NKFvr5jGCuTJPlLbskLlIuxC" \
  --raw | jq '.crons | {disabledAt,definitions}'
```

Resultados esperados:

- GitHub: `state` igual a `disabled_manually`;
- Vercel: `disabledAt` diferente de `null`;
- Vercel: a definição de `/api/cron/recheck` pode continuar listada.

## Evidência do consumo

O painel do Turso mostrava aproximadamente **452,92 milhões de 500 milhões de
linhas lidas** (91% da cota). O banco `master-jobs` respondia por:

- **453.301.777 linhas lidas**;
- **208.580 linhas escritas**;
- **642,44 MB** armazenados;
- 99,800% das leituras e 99,751% das escritas exibidas para a organização.

Restavam aproximadamente 47,08 milhões de leituras. A consulta dominante,
executada por `enqueueStale()` em `src/core/ingest/verify-queue.ts`, leu cerca
de **155 milhões de linhas em apenas duas execuções nas últimas seis horas**:
77,4 milhões por execução e duração média de 174 segundos. Uma única nova
execução já ultrapassaria a cota restante em aproximadamente 30,32 milhões de
linhas.

O plano local equivalente mostrou o problema:

```text
SEARCH job USING INDEX job_closed_idx
CORRELATED SCALAR SUBQUERY 1
  SEARCH job_score USING INDEX job_score_fit_idx
CORRELATED SCALAR SUBQUERY 2
  SEARCH job_score USING INDEX job_score_fit_idx
USE TEMP B-TREE FOR ORDER BY
```

`job_score` possui chave primária `(candidate_id, job_id)` e índice iniciado
por `fit`, mas não possui índice iniciado por `job_id`. As duas subconsultas
correlacionadas que calculam `max(fit)` repetem trabalho para cada vaga.

## Por que havia duas execuções

Dois agendadores independentes acionavam partes sobrepostas do mesmo pipeline:

1. `.github/workflows/varredura.yml` executava sync, scraping, recheck,
   rescore e scoring completo diariamente;
2. `vercel.json` acionava `/api/cron/recheck` quatro horas depois.

O recheck enfileira vagas por meio da consulta cara de `enqueueStale()`. A
duplicação explica as duas ocorrências observadas na janela de seis horas.

## Amplificadores confirmados

O consumo não vem apenas do agendamento duplicado:

- `syncOne()` trata toda resposta como fotografia completa e fecha vagas
  abertas que não vieram na resposta;
- o adapter Himalayas busca somente as 1.200 vagas mais recentes de um acervo
  muito maior, portanto entrega uma janela parcial que hoje é interpretada
  como fotografia completa;
- em 03/09, só o Himalayas abriu 1.003 registros e fechou 1.187 na mesma
  varredura; o Lever/Jobgether abriu 989 e fechou 815;
- mudanças em título, empresa ou local alteram o `fingerprint`, criando uma
  vaga nova e fechando a anterior, mesmo quando a fonte fornece identidade
  estável por `externalId`;
- a exclusão de scores por `job_id` também não tem índice líder em `job_id` e
  apareceu com 3,48 milhões de linhas lidas em 128 execuções;
- o dashboard calcula facetas em consultas separadas, repetindo leituras que
  podem ser agregadas em uma única passagem.

O crescimento de armazenamento tem a mesma origem de retenção excessiva. Em
uma base local representativa, `job` ocupava 274,99 MB e `job_page` 139,80 MB.
Somente JSON bruto em `job` ocupava 125,26 MB; HTML e texto de descrição,
aproximadamente 133,41 MB; 206 páginas já parseadas ainda retinham 136,75 MB de
HTML bruto.

## Regra de reativação

**Não reative nenhum agendador apenas porque a cota virou.** Primeiro conclua
a tarefa B-11 em [`../product/backlog.md`](../product/backlog.md) e valide um
canário controlado.

A reativação precisa obedecer a esta ordem:

1. publicar a consulta sem subconsulta correlacionada e o índice por `job_id`;
2. publicar a distinção entre fonte completa e janela parcial;
3. definir um único dono do agendamento de recheck;
4. executar um canário manual com medição no Turso;
5. comprovar redução mínima de 99% em relação às 77,4 milhões de leituras;
6. só então habilitar o agendador escolhido.

Comandos de reativação, para uso somente após os gates acima:

```bash
# GitHub Actions — habilitar somente se ele for o agendador escolhido
rtk gh api --method PUT \
  repos/andreustimm/master-jobs/actions/workflows/varredura.yml/enable

# Vercel — habilitar somente se ela for o agendador escolhido
rtk vercel api \
  "/v1/projects/prj_JmXV32dUXEZwSPVXPdIwT6ydLcbc/crons?teamId=team_NKFvr5jGCuTJPlLbskLlIuxC" \
  --method PATCH --field enabled=true --raw
```

Nunca habilite os dois sem uma justificativa explícita e um orçamento de
leituras separado para cada rotina.

## Evidências relacionadas

- GitHub Actions, varredura de 01/09: run `33502650730`;
- GitHub Actions, varredura de 02/09: run `33622521000`;
- GitHub Actions, varredura de 03/09: run `33747298900`;
- implementação da fila: `src/core/ingest/verify-queue.ts`;
- configuração do workflow: `.github/workflows/varredura.yml`;
- configuração do cron: `vercel.json`;
- schema e índices: `src/core/db/schema.ts`.

