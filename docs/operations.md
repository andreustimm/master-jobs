# Operação diária

> **Incidente encerrado — 19/09/2026:** a varredura automática está **ligada** e
> foi validada de ponta a ponta em produção sobre o PostgreSQL do Supabase (0 de
> 47 fontes com erro, sync em 18m46s). A cota do Turso que motivou o desligamento
> deixou de ser o banco de runtime. Mantido abaixo o histórico do incidente de
> 03/09/2026, porque o runbook de reativação explica o que foi conferido antes:
> [`operations/turso-quota-incident-2026-09-03.md`](operations/turso-quota-incident-2026-09-03.md).

> **Banco atual:** o runtime usa PostgreSQL (`DATABASE_URL`) e migrations usam
> `DATABASE_MIGRATION_URL`. Alguns diagnósticos SQL mais abaixo preservam a
> fotografia do snapshot SQLite pré-corte; trate-os como referência histórica e
> não os execute literalmente. Para a operação atual, prefira os comandos
> `jho` e as rotinas de `docs/engineering/deploy.md`.

## Catálogo de fontes: passar a verdade para o banco

Com a migration `0020_source_catalog` aplicada, o catálogo continua espelhando
`config/sources.yaml` linha a linha até alguém importá-lo. A transição é
explícita e de uma vez (#223):

1. `pnpm jho sources diff` — confira o que o arquivo e o banco discordam.
2. `pnpm jho sources import` — simulação; mostra o que vai inserir, regravar e
   desabilitar.
3. `pnpm jho sources import --apply` — grava e marca toda linha como gerida.

Depois disso, editar o YAML só acrescenta fontes novas; mudar ou desligar uma
existente é escrita no banco. Rode o `diff` sempre que mexer
no arquivo: divergência em linha gerida não é aplicada sozinha.

> **Não rode o passo 3 antes da tela de Plataformas** (tarefa 03 da #223).
> Hoje nenhum comando nem tela edita, desliga ou aposenta uma fonte gerida, e
> não há como desfazer `managed_at`: depois do `--apply`, desligar um board
> quebrado exigiria SQL manual em produção. Os passos 1 e 2 não gravam nada e
> podem rodar a qualquer momento.

## Varredura horária: ativar o agendador

Desde a [ADR 0025](adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)
a varredura roda na Vercel em fatias: `GET /api/cron/varredura?fatia=<nome>`,
com `sync`, `termos`, `captura`, `reconferencia`, `sem-nota`, `manutencao` e
`repontuar`. Cada chamada faz o
que cabe em 20 s, grava uma linha em `production.sweep_run` e devolve o
relatório em JSON. Quem chama é o `pg_cron` do Supabase — e ligá-lo é **passo
humano**, uma vez, depois de o código estar em produção (as migrações
`0016_sweep_lease_and_runs` e `0019_score_cursor` aplicadas).

**Só em produção** ([ADR 0027](adr/0027-cadencia-das-notas-em-lotes-com-cursor.md)).
O SQL do agendador é aplicado **somente no projeto Supabase de produção** — ele
recusa rodar se o Vault não apontar para `https://jobs.mastertimm.com.br`. Em
preview, dev, staging ou local a rota responde `503` (`varredura só roda em
produção`) em toda fatia, sem trabalhar, mesmo com o segredo certo. O `after()`
de quem salva o currículo não depende disto e funciona em qualquer ambiente.

1. **Vercel, produção.** O valor de uma variável *Sensitive* não volta pela API,
   então gere um segredo novo e cadastre (ou substitua) `CRON_SECRET`:
   `openssl rand -hex 32`, depois `vercel env rm CRON_SECRET production` e
   `vercel env add CRON_SECRET production` (marcar como Sensitive). Confira
   também `JHO_SOURCE_ALLOWLIST` em produção — o mesmo valor da variável do
   Actions; sem ela as fatias de rede respondem 503 por política (ADR 0021).
   `JHO_USER_AGENT` é recomendado (`master-jobs/0.1 (+https://jobs.mastertimm.com.br)`).
   Redeploy de produção para as variáveis valerem.
2. **Fumaça.** Sem cabeçalho a rota recusa; com ele, a fatia que não toca
   terceiros responde:
   `curl -s -o /dev/null -w '%{http_code}\n' "https://jobs.mastertimm.com.br/api/cron/varredura?fatia=sem-nota"` → `401`;
   `curl -s -H "authorization: Bearer $CRON_SECRET" "https://jobs.mastertimm.com.br/api/cron/varredura?fatia=sem-nota"` → JSON com `durationMs`.
3. **Um agendador por vez.** Imediatamente antes de rodar o SQL do passo
   seguinte, desligue o disparo agendado do Actions:
   `gh variable set VARREDURA_AGENDADOR --body supabase --repo andreustimm/master-jobs`.
   O disparo manual e a tela de operações continuam. Se o passo 4 falhar,
   `gh variable delete VARREDURA_AGENDADOR --repo andreustimm/master-jobs`
   devolve a execução diária.
4. **Supabase, SQL Editor do projeto de produção.** Habilite `pg_cron` e
   `pg_net` (Integrations, ou as linhas `create extension` do arquivo), grave os
   dois segredos no Vault — o **mesmo** valor do passo 1:
   `select vault.create_secret('<CRON_SECRET>', 'jho_cron_secret');`
   `select vault.create_secret('https://jobs.mastertimm.com.br', 'jho_cron_base_url');`
   e rode [`supabase/cron/varredura.sql`](../supabase/cron/varredura.sql). O
   arquivo é idempotente: rodar de novo atualiza as agendas pelo nome e remove
   as que deixaram de existir (`jho-varredura-pontuar`).
5. **Conferir em minutos.**
   `select jobname, schedule, active from cron.job where jobname like 'jho-varredura-%';`
   e `select status_code, count(*) from net._http_response where created > now() - interval '15 minutes' group by 1;`
   — tudo `200`. (`pg_net` só guarda respostas por 6 h.)

**Prova de 24 h** (a entrega da #281). Toda fonte com intervalo ≤ 60 min e
nenhuma chamada perto do teto:

```sql
with s as (
  select unit, started_at::timestamptz as at,
         lag(started_at::timestamptz) over (partition by unit order by started_at) as antes
  from production.sweep_run
  where slice = 'sync' and unit is not null
    and started_at::timestamptz > now() - interval '24 hours'
)
select unit, count(*) as syncs, max(at - antes) as maior_intervalo
from s group by unit order by maior_intervalo desc nulls first;

select slice, count(*) as chamadas, max(duration_ms) as mais_lenta_ms, sum(errors) as erros
from production.sweep_run
where unit is null and started_at::timestamptz > now() - interval '24 hours'
group by slice;
```

`duration_ms` mede o trabalho dentro da função; o teto de 30 s da plataforma se
confere nos logs da Vercel (nenhum `FUNCTION_INVOCATION_TIMEOUT` em
`/api/cron/varredura`) e no painel *Usage*, que também diz se a cadência cabe
no plano. Fonte ausente da primeira consulta não sincronizou nas 24 h — o
alarme "fonte há mais de 2 h sem sync" (log da função e Sentry, uma vez por
hora) já deveria tê-la apontado.

**Desfazer:** `select cron.unschedule(jobname) from cron.job where jobname like 'jho-varredura-%';`
e `gh variable delete VARREDURA_AGENDADOR --repo andreustimm/master-jobs` — a
execução diária do Actions volta a valer na manhã seguinte.

## Pedir manutenção pela interface — `/admin/operacoes`

Tela de administrador com um botão por rotina: varredura inteira, buscar vagas
novas, repetir as buscas por termo, conferir expiradas e repontuar. Mostra
quantas fontes estão sem erro, qual foi a varredura mais recente e o detalhe das
que falharam.

**A tela pede; quem executa é o GitHub Actions.** Não é preferência: a função
web morre em 30 segundos e o sync levou de 18 a 27 minutos nas últimas medições.
Rodar a rotina dentro do pedido seria prometer o que a plataforma não entrega —
e foi assim que duas telas passaram a devolver 504 antes da 1.15.5.

O pedido vira um `workflow_dispatch` em `varredura.yml`, com o input `rotina`.
Cada passo do workflow declara a que rotina pertence, então pedir "conferir
expiradas" não gasta cota de fonte nem repontua o acervo. Execução agendada não
tem input: ela continua rodando tudo.

**Sem credencial, a tela diz isso.** O disparo imediato precisa de
`GITHUB_DISPATCH_TOKEN` — um PAT fine-grained com `actions:write` no repositório
— cadastrado como variável de ambiente da aplicação; o **nome** da variável é o
que o código conhece, nunca o valor (regra 16). Sem ela, o botão explica o que
falta e a execução diária das 06:00 UTC continua de pé: o sistema fica mais
devagar, nunca incorreto.

**O estado não vem da API do GitHub.** Vem das tabelas que as rotinas escrevem —
`source.lastSyncedAt`, `source.lastStatus` — pela mesma leitura que a CLI usa em
`jho sources list`. Assim a tela não depende de token para dizer a verdade sobre
o acervo.

### Execuções registradas (`source_run`)

Captura e verificação pedidas pelo catálogo viram uma linha em `source_run`
(#223): escopo, quem pediu, o retrato da configuração, contagens e erro
redigido. O pedido cria a execução `queued` e a despacha com a rotina
`execucao` do `varredura.yml` (insumos `acao`, `execucao` e `fonte`); o workflow
roda só `pnpm jho jobs sync --run <id>` ou `pnpm jho jobs verify --run <id>`, e
nenhum passo da varredura inteira. `jho jobs sync` pela cron também registra
uma execução `all`.

- **Sem credencial**, a execução fica `queued` com `error_code = no_token`: ela
  não some. Para rodá-la à mão: `pnpm jho jobs sync --run <id>`.
- **Clique duplo** devolve a mesma execução: a chave de idempotência tem índice
  único parcial nos estados ativos.
- **Executor morto**: `running` sem batimento por 15 min vira `interrupted` na
  próxima execução pedida pela CLI (e libera um novo pedido). Nova tentativa é
  outra linha, ligada por `retry_of`; a original não muda.
- A varredura fatiada da Vercel (`/api/cron/varredura`) ainda não registra em
  `source_run`; ela continua medida por `sweep_run`.

## Repontuação de candidato: fatias na web

Candidato que salva o currículo não espera a varredura: a ação enfileira em
`score_task` e roda **uma fatia** da fila no `after()`, depois da resposta. A
fatia tem orçamento de `SCORE_SLICE_MS` (20 s): só começa um lote de 100 que
caberia pelo mais lento até ali, as 100 vagas mais recentes primeiro, e cabe no
teto de 30 s da função; o que não couber volta à fila sem gastar tentativa
([ADR 0026](adr/0026-fila-de-repontuacao-em-fatias-na-web.md); mecânica em
[`scoring.md`](scoring.md#quando-a-nota-é-calculada-a-fila-e-as-fatias)).

A continuação é a fatia **`repontuar`** da varredura (`GET
/api/cron/varredura?fatia=repontuar`, mesmo `CRON_SECRET`, mesma borda
`cronDenied`, métrica em `sweep_run`), agendada a cada dois minutos em
`supabase/cron/varredura.sql` (`jho-varredura-repontuar`). Ela não consulta a
política de ingestão: só grava nota no banco do próprio ambiente. O relatório
traz `items` (tarefas concluídas ou recusadas), `errors` (tentativas que
falharam) e `detail: { scored, deferred,
pending }` — `pending > 0` quer dizer que ainda há fila; o agendador não
decide nada com isso, chama no próximo ciclo de qualquer jeito.

As fatias `sem-nota` e `manutencao` (seção seguinte) são outra coisa: mantêm a
nota de todo candidato pela cadência, sem pedido. Elas não concluem a tarefa da
fila nem registram a recusa — e é a tarefa que a tela de candidato lê.

**Ativar.** O agendamento entra junto com as outras fatias ao reaplicar
`supabase/cron/varredura.sql` no SQL Editor de produção (idempotente; passo 4
de "Varredura horária: ativar o agendador" acima). Enquanto não for
reaplicado, o que sobra da fatia do `after()` espera a próxima ação do
candidato ou `jho jobs rescore run`. À mão:

```bash
curl -sS -H "authorization: Bearer $CRON_SECRET" "https://jobs.mastertimm.com.br/api/cron/varredura?fatia=repontuar"
```

**Diagnóstico.** `jho jobs rescore status` conta a fila por estado. Tarefa em
`scoring` há mais de `MINUTOS_CLAIM_MORTO` (10 min) é de uma função que morreu
no meio, e a próxima fatia a retoma. `done` com `last_error` `sem-curriculo`,
`curriculo-fraco` ou `catalogo-vazio` é **recusa**, não falha: a tela de
candidato mostra o motivo; `catalogo-vazio` pede `jho skills seed`.

## Cadência das notas: `sem-nota` e `manutencao`

[ADR 0027](adr/0027-cadencia-das-notas-em-lotes-com-cursor.md), #288. Toda
pontuação — `after()`, `repontuar`, as duas fatias abaixo e a CLI — percorre as
vagas abertas **da mais recente para a mais antiga**, em **lotes de 100**, e
grava depois de cada lote onde parou (`production.score_cursor`, uma linha por
candidato e trilha). A chamada seguinte retoma dali; perfil novo recomeça do
topo.

| Fatia | Agenda (`pg_cron`) | Quem | Intervalo mínimo por candidato |
|---|---|---|---|
| `sem-nota` | `5-55/10 * * * *` (`jho-varredura-sem-nota`) | trilha principal nunca completou uma passada | 9 min |
| `manutencao` | `11 * * * *` (`jho-varredura-manutencao`) | já completou | 59 min |

Cada chamada tem 20 s: o candidato que pega a fatia usa o orçamento em lotes
(só começa um lote que caberia pelo mais lento até ali), e o seguinte só começa
se ainda couber. Quem não terminou volta na agenda seguinte, do cursor. A
reserva é `pontuacao:<candidato>` em `sweep_lease`, comum às duas filas.

**Ativar.** Depois do deploy de produção com a migração `0019_score_cursor`
aplicada, reaplique `supabase/cron/varredura.sql` no SQL Editor do projeto de
**produção** (passo 4 de "Varredura horária" acima). Entre o deploy e o SQL, a
agenda antiga ainda chama `fatia=pontuar`, que agora responde `400`: vaga nova
só ganha nota pelo `after()` e pela `repontuar` até o SQL ser reaplicado.
Conferir:

```sql
select jobname, schedule, active from cron.job where jobname like 'jho-varredura-%' order by 1;
-- espera: sem-nota, manutencao, repontuar, sync, reconferencia, captura, termos; nenhum `pontuar`
```

À mão (produção): `curl -sS -H "authorization: Bearer $CRON_SECRET" "https://jobs.mastertimm.com.br/api/cron/varredura?fatia=manutencao"`.

**Consultas de prova.** Em que fila cada candidato está, e as três medidas do
pedido — tempo até o primeiro lote, tempo até completo e atraso da manutenção:

```sql
-- Fila atual por candidato (trilha principal).
select c.id, c.created_at, sc.created_at as primeiro_lote, sc.first_completed_at, sc.last_completed_at,
       case when sc.last_completed_at is null then 'sem-nota' else 'manutencao' end as fila
from production.candidate c
left join production.target_track t on t.candidate_id = c.id and t.is_primary
left join production.score_cursor sc on sc.candidate_id = c.id and sc.track_id = t.id
order by c.id;

-- Tempo até o primeiro lote e até completo, a partir do primeiro currículo salvo.
with cv as (
  select candidate_id, min(created_at)::timestamptz as salvo
  from production.candidate_document where kind = 'cv' group by candidate_id
)
select sc.candidate_id,
       sc.created_at::timestamptz - cv.salvo as ate_primeiro_lote,
       sc.first_completed_at::timestamptz - cv.salvo as ate_completo
from production.score_cursor sc
join production.target_track t on t.id = sc.track_id and t.is_primary
join cv on cv.candidate_id = sc.candidate_id
where cv.salvo > now() - interval '7 days'
order by cv.salvo desc;

-- Atraso da manutenção: há quanto tempo cada candidato completou a última passada.
-- Esperado: até ~1 h (mais as agendas que um acervo grande precisar).
select sc.candidate_id, now() - sc.last_completed_at::timestamptz as desde_a_ultima_passada,
       sc.position_job_id is not null as passada_em_curso
from production.score_cursor sc
join production.target_track t on t.id = sc.track_id and t.is_primary
where sc.last_completed_at is not null
order by 2 desc;

-- Cadência e teto nas últimas 24 h, por fila.
select slice, count(*) filter (where unit is null) as chamadas,
       count(*) filter (where unit is not null) as candidatos_atendidos,
       max(duration_ms) filter (where unit is null) as mais_lenta_ms,
       -- A linha da chamada já soma os erros das unidades: contar as duas dobraria.
       sum(errors) filter (where unit is null) as erros
from production.sweep_run
where slice in ('sem-nota', 'manutencao', 'repontuar')
  and started_at::timestamptz > now() - interval '24 hours'
group by slice;
```

`first_completed_at` e `created_at` do cursor só valem para candidato que
entrou depois desta versão: quem já tinha nota ganha cursor na primeira passada
depois do deploy (passa uma vez por `sem-nota`, quase só leitura).

## Por que isto existe

O `master-jobs` não é um produto: é uma rotina. O banco só vale alguma coisa se
duas coisas acontecerem com regularidade — o sync roda (o mundo muda) e você
registra o que fez (o sistema não tem como adivinhar). Este documento é o
runbook dessas duas coisas: o que rodar por dia, o que rodar por semana, como
saber se está funcionando, e o que fazer quando quebra.

A assimetria que organiza tudo: **vagas são re-buscáveis, candidaturas não.**
Um `job` perdido volta no próximo `jho jobs sync`. Uma linha de `application`
perdida é histórico que ninguém reconstrói. Toda a operação abaixo é desenhada
em volta disso.

> **Invariante:** Ingestão nunca escreve em `application`. `syncOne()` insere,
> atualiza e fecha `job`; jamais toca decisão do usuário. Se um agente precisar
> "corrigir" o pipeline durante um sync, a resposta é não.

Todos os comandos assumem o diretório do projeto e `pnpm` instalado. `pnpm jho`
expande para `node --experimental-strip-types --no-warnings
--env-file-if-exists=.env src/cli.ts`.

---

## O ciclo diário

Quatro passos, na ordem. Leva ~15 minutos quando não há nada de novo.

### 1. Sync

```bash
pnpm jho jobs sync
```

O que acontece, em ordem: `runMigrations()` (por isso não existe passo separado
de migração no dia a dia) → `loadSources()` lê `config/sources.yaml` → `catalogForSync()`
espelha o arquivo nas linhas não geridas e seleciona do banco as fontes habilitadas e não
aposentadas → `syncAll()` roda as fontes com concorrência 4 →
`scoreAll()` no final, salvo se você passar `--no-score`.

| Flag | Default | Quando usar |
|---|---|---|
| `--concurrency <n>` | `4` | Baixe para 1–2 se suspeitar de rate limit; suba pouco — são APIs públicas gratuitas de terceiros |
| `--no-score` | (score ligado) | Só quando quiser inspecionar a ingestão sem pagar o custo do scoring |

A linha por fonte é `fetched / +new / updated / closed / durationMs`. Leia três
sinais:

- **`+new` alto e `updated` zero** em um board pequeno: normal na primeira vez.
- **`updated` alto todo dia**: a fonte reescreve o corpo da vaga a cada request
  (o `contentHash` cobre `title|locationRaw|employmentType|compMin|compMax|descriptionText.slice(0,4000)`);
  não é erro, é ruído da fonte.
- **`closed` alto de repente**: a fonte devolveu menos vagas que da última vez.
  Confira se não foi degradação da API antes de acreditar que 200 vagas
  fecharam no mesmo dia.
- **`partial window: absence closes nothing`** ao lado da linha: a fonte é uma
  janela (as mais recentes, as primeiras páginas) e não fecha nada por
  ausência — `closed` ali é sempre 0. Essas vagas só fecham por 404/410 na
  reconferência. A lista de fontes completas e parciais está em
  [`sources.md`](sources.md#completude-da-listagem).

> **Invariante:** ausência só fecha vaga quando a fonte listou tudo o que tem.
> Janela parcial nunca fecha por ausência, e lista vazia não fecha nada nem em
> fonte completa (`decideAbsenceClosure()` em `src/core/ingest/lifecycle.ts`).
> A reconferência agendada tem um único dono por vez: o `pg_cron` do Supabase
> depois da troca de agendador, o GitHub Actions diário até ela
> ([ADR 0025](adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)).
> A Vercel não tem cron próprio.

> **Invariante:** Uma fonte que falha é registrada e pulada, nunca aborta a run.
> O `try/catch` de `syncOne()` grava `source.lastStatus = 'error'` e
> `source.lastError` e segue para a próxima. Nenhum handle errado pode custar as
> outras 14 fontes ativas.

**Depois do sync, do score, da raspagem ou da verificação, os chips de `/jobs`
e do painel `/` podem ficar até 60 s atrás.**
As contagens dos filtros ficam num cache de cada instância da função, e o sync
roda fora dela, sem como avisar. A lista e o total do rodapé são sempre lidos
na hora. Não há o que fazer: em um minuto os chips alcançam. Detalhe em
`docs/engineering/performance-buscas.md`, seção "Cache das facetas".

`source.lastError = "quota"` numa fonte da Remotive, do RemoteOK ou da
Himalayas não é defeito: o livro de cota recusou a chamada porque o limite do
dia (ou do minuto) já foi gasto — pela sincronização ou pelas buscas por termo.
A próxima janela resolve sozinha.

### 1b. Buscas por termo

```bash
pnpm jho terms run
pnpm jho terms status
```

`terms run` repete de uma vez as buscas por termo salvas e imprime agregados
por plataforma. `terms status` mostra a saúde de cada plataforma. Três sinais:

- **`waiting` alto na Remotive**: esperado. A Remotive pede no máximo quatro
  chamadas por dia, e as duas entradas `remotive` do `sources.yaml` gastam duas.
  O resto fica para a janela seguinte, e a tela Buscas diz isso ao candidato.
- **`red: true`** com `lastErrorCode: "endpoint_gone"`: o endpoint de busca da
  plataforma mudou. Rode `pnpm jho sources probe <kind> --term <t>`; enquanto
  não for corrigido, as outras plataformas seguem.
- **`dailyRepeatPaused: true`**: nenhuma captura da varredura em 36 horas — a
  varredura automática está parada.

### 2. Revisar o topo da lista

```bash
pnpm jho jobs list --min-fit 60
pnpm jho jobs list --min-fit 45 --cluster architect --limit 20
```

`FIT` é colorido por faixa: **verde ≥ 70**, **amarelo ≥ 50**, cinza abaixo
disso. Linhas com `⚠` listam os `blockers` — não são descarte automático: um
blocker custa 12 pontos, não zera a vaga, exatamente para que um bom papel que
diz "US preferred" continue visível, só que não no topo.

Duas armadilhas do comando, ambas por implementação e não por bug:

- `--cluster` é filtro **em memória**, aplicado depois do SQL. O CLI busca
  `limit * 3` linhas, filtra e corta em `limit`. Com um cluster raro e um
  `--limit` pequeno, você pode ver menos linhas do que existe.
- `--status` também é filtrado em memória, dentro de `listBoard()`, e o SQL
  ordena por `fit` — uma vaga já trackeada com fit baixo pode não entrar na
  janela. Para ver o funil, use `jho pipeline`, não `jobs list --status`.

`--json` devolve as `BoardRow` cruas, que é o formato certo para um agente
consumir.

### 3. Triar

Para qualquer coisa que mereça atenção, leia o motivo antes de decidir:

```bash
pnpm jho jobs show 42
```

Isso imprime o breakdown (`title / keywords / seniority / geo / comp / penalty`),
as `reasons`, os `blockers`, matched/missing keywords, o estado no pipeline e os
primeiros 1200 caracteres da descrição. É a única tela que responde *por que*
esta vaga está aqui.

Então mova no funil:

```bash
pnpm jho track 42 shortlisted -n "AI architect, board Ashby, remoto worldwide"
pnpm jho track 42 preparing   -n "CV variant: architect"
```

Estados válidos, na ordem em que `jho pipeline` os imprime:

| Status | Significado operacional |
|---|---|
| `backlog` | Entrou no radar, ainda não avaliado (é o default da coluna) |
| `shortlisted` | Passou na sua leitura, vale candidatar |
| `preparing` | CV/cover em preparação |
| `applied` | Enviado — carimba `applied_at` na **primeira** vez que chega aqui |
| `screening` | Triagem com recruiter |
| `interviewing` | Entrevista técnica em diante |
| `offer` | Proposta na mesa |
| `rejected` | Recusa deles |
| `withdrawn` | Você saiu |
| `archived` | Encerrado sem resultado, mantido para histórico |

Status inválido é rejeitado **antes** de tocar o banco, com `process.exitCode = 1`.

### 4. Agir

O que sai do sistema: candidatar-se pelo `applyUrl ?? url` que o `jho jobs show`
imprime, e as ações de posicionamento no LinkedIn.

> **Invariante:** Nunca faça scraping do LinkedIn. Publicação usa a API oficial
> (`w_member_social`, self-serve). Comentário, conexão e busca são **assistidos**
> — o agente redige, o humano abre a URL e executa. Está escrito no próprio
> schema, na tabela `engagement`: *"Rows here are NEVER executed automatically…
> This is the deliberate boundary that keeps the account inside the LinkedIn
> User Agreement."* Razões completas em
> [`docs/adr/0001-nao-fazer-scraping-do-linkedin.md`](adr/0001-nao-fazer-scraping-do-linkedin.md).

---

## O ciclo semanal

### Repontuar depois de mexer no perfil

Editou `profile/profile.yaml` (títulos, clusters, keywords, blockers, faixa de
compensação) ou o scorer?

```bash
pnpm jho profile                       # valida o YAML e imprime os alvos resolvidos
# bump SCORER_VERSION em src/core/scoring/score.ts
pnpm jho jobs score --all
```

> **Invariante:** mexeu em `profile.yaml` ou no scorer, **bump
> `SCORER_VERSION`** (`src/core/scoring/score.ts`, hoje `"1.0.0"`) e rode
> `pnpm jho jobs score --all`. Sem `--all`, `scoreAll()` só processa vagas
> abertas onde `job_score.job_id IS NULL` **ou**
> `job_score.scorer_version <> SCORER_VERSION` — ou seja, sem o bump os scores
> velhos passam por válidos e se misturam com os novos sem ninguém perceber.

Não existe repontuação de uma vaga só: `scoreAll()` aceita `{ all }` e, na fila
da web, um `deadline` que interrompe entre lotes.
`loadProfile(true)` força releitura do YAML a cada run, então não há cache
antigo em jogo.

### Limpar o que morreu

```bash
pnpm jho db prune --days 90
```

Deleta `job` com `closed_at` anterior ao corte **e** que não está referenciada em
`application`. Hoje isso retorna 0, mas não por falta de vagas fechadas: o banco
já tem 24 linhas com `closed_at` preenchido, todas fechadas em 2026-08-18, e
`pruneClosed()` compara `closed_at` com `now - 90 dias`. Nenhuma delas é velha o
bastante para ser recolhida ainda.

> **Invariante:** Vaga que some é fechada, não deletada — `closedAt` recebe
> timestamp e a linha fica. `pruneClosed()` é a única exclusão permitida, e ela
> se protege sozinha com `job.id not in (select job_id from application)`.

### Arquivar sem perder o funil

O arquivamento é uma operação diferente de `prune`: marca `archived_at` em
vagas confirmadamente fechadas e antigas, mas preserva `job`, `application` e
`application_event`. O candidato continua vendo a candidatura e o recrutador
autorizado continua vendo o registro dentro do seu escopo. Fechar a vaga não
muda `application.status`.

```bash
pnpm jho jobs archive --closed-days 90            # dry-run: inventário
pnpm jho jobs archive --closed-days 90 --apply    # aplica
```

O padrão é dry-run: sem `--apply` nada muda. Cada execução examina até
`--limit` vagas (500 por omissão) e avisa quando sobrou trabalho — rodar de
novo continua de onde parou. Rodar duas vezes não arquiva duas vezes, e duas
execuções simultâneas reclamam cada linha uma só vez.

Um `alive` posterior na fila de reconferência **desfaz** o arquivamento junto
com o fechamento, na mesma linha: vaga que volta a responder volta ao quadro.

O comando **não faz rede nem descobre evidência**: ele consome o `closedAt` já
confirmado pelo sync/probe. `404`/`410` ou uma reconciliação completa podem
sustentar esse fechamento; `401`, `403`, `429`, `5xx`, timeout e falha parcial
são inconclusivos — e vaga cuja última sondagem foi inconclusiva nunca é
arquivada. Fonte manual e de recrutador ficam de fora: ali "fechada" é
digitação de alguém, não ausência observada. A implementação e os critérios estão em
[`job-lifecycle-retention`](../.compozy/tasks/job-lifecycle-retention/) e na
[ADR 0020](adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md).

### Dev e staging: somente fixtures

A promoção para staging é vinculada a um SHA com CI aprovado. Retomada manual
exige `target-sha` e respeita a guarda de migrações; siga o
[contrato de promoção](engineering/promotion.md) para reutilizar o mesmo alvo
depois de uma falha.

Os ambientes remotos de dev e staging não devem executar `jobs sync`, download
de descrição, scraping, recheck, probe ou busca de novas vagas. Eles
usam uma amostra sintética com as modalidades e estados necessários para UI,
scoring, arquivamento e autorização. O bloqueio deve existir no scheduler e no
caso de uso, com falha explícita, antes de qualquer chamada HTTP ou criação de
fila. Qualquer exceção diagnóstica deve ser um modo local explicitamente
allowlisted; não há probe remoto em dev/staging. O runtime local usa PostgreSQL
por `DATABASE_URL` (e `DATABASE_MIGRATION_URL` somente para migrations) e pode
fazer diagnóstico apenas contra essa instância isolada. Ver
[`environment-sample-only`](../.compozy/tasks/environment-sample-only/) e a
[ADR 0021](adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md).

### Exportar o snapshot pro vault

```bash
pnpm jho report                      # <JHO_VAULT_PATH>/<JHO_REPORT_DIR>/vagas-match-YYYY-MM-DD.md
pnpm jho report --min-fit 60 --limit 40
pnpm jho report --stdout             # não escreve nada, só imprime
```

`JHO_REPORT_DIR` tem default `05_Interviews/LinkedIn`. Sem `JHO_VAULT_PATH` e
sem `--out`, o markdown é impresso em vez de gravado. O arquivo é nomeado pelo
dia, então rodar duas vezes no mesmo dia **sobrescreve** — é intencional: o
banco é a fonte da verdade e o vault é a superfície de leitura.

O relatório separa `Novas oportunidades` (sem status ou `backlog`) de
`Em andamento` (qualquer outro status).

### Revisar o funil

```bash
pnpm jho pipeline
pnpm jho sources list
pnpm check                 # changelogs, tracker de QA, tsc --noEmit, vitest, skills de QA
```

`jho pipeline` imprime só os status com contagem > 0, mais a lista ordenada por
`application.updated_at DESC`. `jho sources list` cruza o YAML com a tabela
`source` e mostra `ok | error | never` por fonte, com `↳ <lastError>` embaixo.

---

## O que é "bom", em números

### Baseline do sistema (verificado em `data/jobs.db` após o sync de
2026-08-18T17:46Z)

| Métrica | Valor |
|---|---:|
| `job` ingeridas | 5021 |
| `job` com `closed_at` preenchido | 24 (todas fechadas em 2026-08-18) |
| `job_score` gravados | 5021 (toda vaga aberta pontuada; inclui as 24 fechadas) |
| Fontes configuradas | 12 (todas `ok`, nenhuma com `last_error`) |
| Fit máximo / médio | 74,2 / 29,3 |
| Vagas com fit ≥ 70 | 1 |
| Vagas com fit ≥ 60 | 15 |
| Vagas com fit ≥ 45 | 346 (abertas) |
| Vagas com ao menos um blocker | 21 |

Distribuição de cluster no acervo: `other` 2491, `ai_lead` 1114, `eng_lead`
1032, `architect` 236, `staff` 143, `senior_ic` 5. Acima do corte de 45 a
proporção muda: `ai_lead` 212, `architect` 57, `staff` 44, `eng_lead` 33 —
e `other` desaparece por completo, que é o sinal de que o corte funciona.

Leituras práticas disso:

- **Fit médio ~30 é esperado**, não é sintoma. Os agregadores são ruidosos por
  design — o scorer filtra, não o fetcher.
- **`other` sendo metade do acervo é o comportamento correto** do
  `scoreTitle()`: o default é `{ score: 0, cluster: "other" }`.
- **Fit acima de 70 é raro** porque os defaults do scorer são conservadores: sem
  anos declarados a seniority vale 7,2/12; sem região declarada a geo vale
  8,25/15; sem compensação divulgada a comp vale 4/8. Vaga perfeita e calada não
  chega perto de 100 — não persiga 100.
- **Um dia normal de sync** move dezenas de linhas, não milhares.
  `lever:jobgether` sozinho traz 4.639 das 5.021; qualquer variação grande vem
  de lá.

### Métricas de posicionamento (auditoria, §2.1 e §14)

A auditoria registra o baseline a bater e é explícita: *"Não há garantia de
números de entrevista; use métricas de tendência."* Não invente meta de
conversão — compare com o baseline.

| Métrica | Baseline registrado | Direção |
|---|---:|---|
| SSI total | 59/100 | subir o pilar fraco (`Interagir oferecendo insights`, 8,10/25) |
| Exibições (7 dias, 14–20/jul) | 1.362 | tendência, não pico |
| Ocorrências em resultados de pesquisa (7 dias) | 72 | subir |
| % de exibições originadas em pesquisa | 5,3% | subir — é o indicador de descoberta por keyword |
| Visualizações por recrutadores (12 meses) | 97 | subir e, sobretudo, melhorar a qualidade |
| Post original de referência | 10 reações / 538 impressões | cadência importa mais que o pico |

Cadência que a auditoria define (§14):

- **5–8 candidaturas por semana**, segmentadas, adaptando topo do CV e Featured
  ao cluster — não volume cego.
- **1 publicação original por semana** e **2 comentários substantivos por dia
  útil**.
- **30 min/semana medindo o funil**: exibições → buscas → visitas → contatos →
  entrevistas.
- **Taxa de resposta por cluster** (`architect`, `staff`, `ai_lead`) — é o número
  que decide onde investir CV e conteúdo, e o único que este banco consegue
  calcular sozinho.

Funil local, direto do banco (o `jho pipeline` dá os totais; o SQL dá o corte
por cluster):

```bash
sqlite3 data/jobs.db "
  select s.cluster,
         count(*)                                                as candidaturas,
         sum(a.status in ('screening','interviewing','offer'))   as responderam,
         sum(a.status in ('interviewing','offer'))               as entrevistas
  from application a
  join job j            on j.id = a.job_id
  left join job_score s on s.job_id = j.id
  where a.applied_at is not null
  group by s.cluster;"
```

Nada disso é confiável sem o passo seguinte.

### Registrar métricas do LinkedIn

A tabela `metric_snapshot` (`id`, `at`, `key`, `value`, `note`, único em
`(at, key)`) já vem com o baseline da auditoria carregado por código:

```bash
pnpm jho db seed
```

`db seed` roda `runMigrations()` e depois `seedPositioning()`
(`src/core/positioning/seed.ts`), que insere as 31 tarefas do
`POSITIONING_PLAN` e as **11 métricas** do baseline de `2026-07-27` —
`ssi_total`, `ssi_brand`, `ssi_people`, `ssi_insights`, `ssi_relationships`,
`search_appearances_7d`, `profile_views_7d`, `views_from_search_pct`,
`recruiter_views_1y`, `followers`, `recommendations_received`. O insert é
`onConflictDoNothing()` sobre `(at, key)`, então rodar de novo não duplica nada.

> **Invariante:** `db seed` é idempotente nos dois sentidos e nunca destrói
> progresso: métricas repetidas caem no `onConflictDoNothing()`, e a tarefa de
> posicionamento que já existe tem **só o texto** atualizado (`horizon`,
> `title`, `why`, `how`, `expected`, `priority`, `effort`, `sourceRef`) — o
> `status` e o `doneAt` são do usuário e ficam intactos.

O que **não** existe é comando para registrar a medição da semana seguinte. Para
acrescentar um ponto novo na série, é SQL:

```bash
sqlite3 data/jobs.db "
  insert into metric_snapshot (at, key, value, note)
  values ('2026-08-18','search_appearances_7d', 72, 'medição semanal');"
```

Use sempre a mesma `key` do baseline — é a chave que torna a série comparável.

### Tocar o plano de posicionamento

O mesmo seed carrega o plano derivado da auditoria (31 tarefas nos horizontes
`24h`, `week`, `30d`, `60d`, `90d`):

```bash
pnpm jho tasks list                    # só todo/doing
pnpm jho tasks list --horizon week
pnpm jho tasks list --all              # inclui done e skipped
pnpm jho tasks show PT-0003            # detalhe + a referência à auditoria
pnpm jho tasks done PT-0003
pnpm jho tasks done PT-0003 --status skipped
```

`tasks done` aceita `--status todo | doing | done | skipped`; `doneAt` só é
carimbado quando o status é `done`, e volta a `null` em qualquer outro. O `<id>`
é normalizado com `toUpperCase()`, então `pt-0003` funciona. Os ids vão de
`PT-0001` a `PT-0031`.

---

## Registrar que você aplicou — e por que isso importa

```bash
pnpm jho track 38 applied -n "aplicado via ATS, CV variant architect"
```

O que `setApplicationStatus()` faz: cria a linha em `application` se não existir,
atualiza `status` e `updated_at`, carimba `applied_at` **apenas na primeira vez**
que o status vira `applied`, e sempre insere um `application_event` com
`kind = "status_change"`, `from_status`, `to_status` e o `-n` em `detail`.

**Por que isso importa mais do que parece:**

1. `application` é a única tabela que o sync nunca sobrescreve. Tudo em `job` é
   fato observado e descartável; tudo em `application` é decisão sua e
   insubstituível.
2. `pruneClosed()` usa a existência da `application` como escudo. Vaga sem
   candidatura registrada pode ser deletada 90 dias depois de fechar; com
   candidatura, nunca.
3. `application_event` é append-only e é o que torna a taxa de resposta por
   cluster calculável em retrospecto. Se você não trackeia, o dado não existe —
   e não dá para reconstruir depois.

> **Invariante:** `job` é fato observado, `application` é decisão do usuário, e
> a fronteira não se cruza. Ver
> [`docs/adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md`](adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md).

### Campos que o CLI não escreve

`jho track` só grava `status`, `applied_at` e `updated_at`. As colunas
`channel`, `cv_variant`, `cover_letter_path`, `contact_name`, `contact_url`,
`rate_discussed`, `next_action`, `next_action_at` e `notes` existem no schema e
nenhum código as preenche. E só **três** delas chegam a ser exibidas:

| Coluna | Quem lê |
|---|---|
| `notes` | `jho jobs show` |
| `next_action` | `jho jobs show` (`next: …`) e `jho pipeline` (`next: …`) |
| `next_action_at` | `jho jobs show`, entre parênteses depois do `next_action` |
| `channel`, `cv_variant`, `cover_letter_path`, `contact_name`, `contact_url`, `rate_discussed` | ninguém — nenhum comando do CLI lê ou imprime |

Ou seja: escrever `cv_variant` ou `rate_discussed` via SQL guarda o dado, mas
nada no CLI o mostra de volta hoje. Até existir UI, é SQL:

```bash
sqlite3 data/jobs.db "
  update application
     set channel        = 'ats',
         cv_variant     = 'architect',
         next_action    = 'follow-up com o recruiter',
         next_action_at = '2026-08-25',
         notes          = 'rate discutido: 75/h USD',
         updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where job_id = 38;"
```

Cuidado com o `-n`: a nota do `jho track` vai para `application_event.detail`,
**não** para `application.notes`. `jho jobs show` imprime `application.notes` —
que continua vazio até você escrevê-lo. Para ler o histórico:

```bash
sqlite3 data/jobs.db "
  select e.at, e.from_status, e.to_status, e.detail
  from application_event e
  join application a on a.id = e.application_id
  where a.job_id = 38 order by e.at;"
```

---

## Ativar o e-mail de recuperação (Resend)

Se `RESEND_API_KEY` ou `RESEND_FROM` faltar no ambiente, a recuperação de senha
responde normalmente para quem pede, mas **nenhum e-mail sai**. Em produção e
qualquer deployment o log das funções mostra só este alerta, sem destinatário
nem link:

```
[auth] ALERTA: e-mail transacional NÃO enviado — RESEND_API_KEY e RESEND_FROM precisam estar configurados neste ambiente. …
```

O link nunca vai para o log hospedado porque ele é uma credencial: quem o lê
troca a senha da conta. Localmente, sem chave, o e-mail inteiro continua
aparecendo no terminal, que é a tela de quem opera.

Checklist do dono — só ele tem acesso à conta do Resend, ao DNS e aos
segredos da Vercel; nenhum agente faz estes passos:

1. **Chave.** No Resend, crie uma API key com permissão **somente de envio**
   (*Sending access*), restrita ao domínio remetente.
2. **Domínio.** Verifique o domínio remetente (ex.: `mastertimm.com.br`) no
   Resend e publique no DNS (Cloudflare) os registros SPF e DKIM que ele
   indicar. Espere o Resend marcar o domínio como verificado.
3. **Variáveis.** Na Vercel, ambiente **Production**: `RESEND_API_KEY` como
   *Sensitive* e `RESEND_FROM` com o remetente do domínio verificado (ex.:
   `Master Jobs <no-reply@mastertimm.com.br>`). As duas formam um par: uma sem a
   outra não envia e continua só alertando.
4. **Redeploy.** Variável nova só vale no deploy seguinte.
5. **Prova.** Peça recuperação para uma conta de teste em `/login/forgot` e
   confirme que o e-mail chega e o link funciona uma vez.
6. **Log limpo.** No log das funções, confira que o pedido não imprimiu o link
   nem o alerta acima. No banco, o evento esperado é `reset_requested` com
   `detail = 'via resend'`:

   ```sql
   select kind, detail, at from production.auth_event
   where kind like 'reset_%' order by at desc limit 5;
   ```

   `reset_send_failed` com `resend respondeu 4xx` aponta chave ou domínio;
   `resend respondeu 5xx` ou mensagem de rede é falha do provedor — peça a
   recuperação de novo alguns minutos depois; `e-mail não configurado` aponta variável
   faltando no ambiente.

---

## Troubleshooting

### A busca está lenta

**Meça antes de mexer.** A análise completa está em
[`engineering/performance-buscas.md`](engineering/performance-buscas.md); o
roteiro curto:

1. **A função está na região do banco?** O cabeçalho `x-vercel-id` da resposta
   deve dizer `<borda>::gru1::…` — o primeiro trecho é a borda de quem pediu, só
   o segundo é a região da função. `<borda>::iad1::…` é a função na Virgínia com
   o banco em São Paulo: cada ida ao banco atravessa o continente, sem erro
   nenhum. `vercel.json` fixa a região e `tests/function-region.test.ts` trava o
   par com o pooler de produção.
2. **Onde a requisição gasta o tempo?** `/jobs` e `/` registram uma linha JSON
   no log da função quando passam de 1 s — ou sempre, com `JHO_PERF_LOG=1` no
   ambiente: `{"perf":"/jobs","totalMs":…,"region":"gru1","stages":{"auth":…,
   "prelude":…,"board":…,"facets":…,"tail":…}}`. A linha sai também quando a
   leitura falha, com o estágio que falhou medido. Não sai se a plataforma mata
   a função (o 504 aos 30 s): para esse caso existe o vigia de 22 s. Só número e
   nome de estágio; sem query string nem identidade. Na Hobby o log da Vercel
   dura 1 h: reproduza e leia logo.
3. **É o servidor ou o navegador?** `pnpm perf:jobs` roda 6 cenários sobre 10 mil
   vagas num Postgres local e diz o tempo e o **número de idas** de cada um.
   Sem rede, é o piso: o custo em produção é `estágios em série × round-trip`.
   Guarde o relatório com `JHO_PERF_OUT=antes.txt` e compare depois.

Para guardar a comparação completa, use também `JHO_PERF_JSON=arquivo.json`.
`JHO_PERF_RUNS` e `JHO_PERF_WARMUPS` (inteiros positivos) controlam as repetições. A evidência inclui
resultados de referência, volume de SQL, parâmetros e o plano da maior consulta;
compare os resultados antes/depois, além dos tempos. O comando continua usando
somente o banco sintético isolado.

`tests/db-fan-out.test.ts` afirma que `/jobs` lê as trilhas e o câmbio uma vez
cada — a régua de pico de conexões não enxerga round-trip: cada consulta cabe no
teto e a soma em série ainda é lenta. O que o teste **não** cobra é o paralelismo
dos estágios (prelúdio, contagem, cauda): esse é medido por `pnpm perf:jobs`.

### Uma tela devolve 504 em produção, e só às vezes

**Conte quantas consultas aquele caminho dispara ao mesmo tempo.** O cliente do
banco abre **três** conexões (`max: 3`, em `src/core/db/client.ts`), e esse
número é uma invariante de produção, não detalhe de configuração.

Uma requisição que pede as três exatas cabe — e por isso a tela responde 200
quando ninguém mais a está pedindo. Mas a instância serverless é reaproveitada
entre requisições concorrentes: **duas** na mesma instância pedem seis conexões
a um pool de três, cada uma espera a outra, e a Vercel mata as duas aos 30
segundos.

Foi exatamente isso em `/candidate/skills`, em 2026-09-20. Nos logs da Vercel o
par aparece cru:

```
...393589  /candidate/skills  →  200
...393855  /candidate/skills  →  504   ← 266ms depois, mesma rota
```

**O teto é `POOL - 1`, não `POOL`.** Uma leitura de tela precisa caber deixando
conexão para o resto da requisição e para a requisição do lado.
`tests/db-fan-out.test.ts` mede o pico de consultas em voo por caminho e afirma
esse teto; quando a régua foi apertada de `<= 3` para `<= 2`, encontrou na hora
três caminhos que ninguém tinha notado.

**O teto é por REQUISIÇÃO, e a régua só alcança função.** É a lição de
2026-09-21, e ela custou uma segunda rodada. A régua apertada media
`loadSkillsScreen`, `trackOverview` e `trackSuggestion` — três funções. Tela não
é função: quem compõe as leituras no corpo do Server Component fica fora da
medição por construção, e eram justamente as três maiores.

| Tela | Consultas em voo antes | Pool |
|---|---:|---:|
| `/` (cockpit, `start_url` da PWA e rota do pós-login) | 7 | 3 |
| `/jobs` (a tela mais aberta do produto) | 5, e 6 com faixa salarial | 3 |
| `/searches` | 4 | 3 |

Duas armadilhas dentro disso, que não aparecem contando `Promise.all`:

- **Uma leitura pode ser várias consultas.** `boardFacets` eram três
  simultâneas — o pool inteiro dentro de uma leitura, antes de qualquer chamador
  somar. Hoje são duas.
- **Duas leituras corrigidas somam de novo na página que usa as duas.**
  `trackOverview` e `termOverview` foram levadas a duas cada, e `/searches`
  rodava as duas em paralelo: quatro.

**Regra prática ao escrever tela:** a composição das leituras mora em um módulo
de dados (`app/cockpit-data.ts`, `app/jobs/jobs-data.ts`,
`app/searches/searches-data.ts`, `app/candidate/skills/data.ts`), nunca no corpo
da página, e cada um desses módulos tem um caso em `tests/db-fan-out.test.ts`.
A guarda é o inventário V10-05 em `tests/architecture.test.ts`: ele descobre
pelo conteúdo todo arquivo de `app/` com `Promise.all` (e parentes) e exige uma de duas coisas: a função de composição
chamada em `db-fan-out.test.ts`, ou um leque literal de no máximo `max - 1`
itens (o `max` lido de `src/core/db/client.ts`) com o motivo escrito. Leque
dinâmico (`Promise.all(rows.map(…))`, ou `[...lista]` dentro da literal) conta como ilimitado, e ler `loadRates`
duas vezes na mesma composição reprova. É inventário, não medição: o leque
declarado conta chamadas, e uma chamada que abre duas consultas por dentro só
aparece no pico medido.

E **passe o câmbio adiante.** `loadRates()` é uma consulta sem cache (eram duas,
em série, antes de a data mais recente virar subconsulta), e `listBoard`,
`countBoard` e `countHiddenByPayRange` buscavam cada uma a sua: quatro idas ao
banco pelo mesmo câmbio numa requisição de `/jobs`. `BoardFilters.rates` existe
para isso.

**O Sentry não vê isso.** `FUNCTION_INVOCATION_TIMEOUT` mata o processo; o
código não falha, não reporta, e o registro da Vercel traz uma linha só. A falha
mais visível do produto é a única invisível na telemetria. O tracing (#219) não
muda isso: a transação só é enviada quando a requisição termina, e a requisição
morta não termina. Procure nos logs da Vercel, não no Sentry:

```bash
vercel logs https://jobs.mastertimm.com.br --json | grep -E "Timeout|504"
```

### Uma fonte aparece com status `error`

```bash
pnpm jho sources list
```

A linha vermelha `↳ <lastError>` é o `error.message` que derrubou aquele
`syncOne()`. Diagnósticos por formato da mensagem:

| Mensagem | Causa | Ação |
|---|---|---|
| `GET <url> -> 404` | Handle errado ou board removido | Ver "um board devolve 404" abaixo |
| `GET <url> -> 429` / `5xx` | Transiente; `getJson()` já tentou 2 retries com backoff `500 * 2**attempt` | Rodar o sync de novo mais tarde; considerar `--concurrency 2` |
| Abort por timeout | Estourou os 20 s de `DEFAULT_TIMEOUT_MS` | Repetir; se persistir, a fonte está degradada |
| `No adapter registered for source kind "<kind>"` | `workable` e `manual` passam na validação Zod de `sources.yaml` mas não estão em `ADAPTERS` | Remover a entrada do YAML ou escrever o adapter |
| `... is not a function` | Formato de campo mudou na API | Reproduzir com `sources probe`, corrigir o mapeamento |

O estado de erro é **pegajoso**: `last_error` só é limpo quando aquela fonte
completa um sync com sucesso. Consequência prática: a fonte pode aparecer
vermelha em `sources list` depois de o bug já estar consertado no código — o
registro é do último sync, não do estado atual do adapter. Foi o que aconteceu
com `arbeitnow:`, que carregou `(j.job_types ?? []).join is not a function` até
o adapter passar a usar `toList()` e rodar um sync limpo. Hoje as 12 fontes
estão `ok` com `last_error` nulo (sync de 2026-08-18T17:46Z), então essa seção
descreve um estado que você só vai reencontrar depois da próxima falha.

Antes de qualquer correção, reproduza sem tocar no banco:

```bash
pnpm jho sources probe arbeitnow ""
```

`sources probe` não passa por `withDb()` — não abre nem escreve no banco.
Imprime a contagem, os `warnings` e os 5 primeiros títulos.

Warnings que **não** são erro:

- `ashby:<handle> returned no listed jobs` — o board existe e está vazio.
- `smartrecruiters:<handle> list endpoint has no job body; keyword scoring uses titles only`
  — o endpoint de lista não traz corpo; o keyword score pontua só o título.
- `adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set` — o adapter devolve 0
  vagas de propósito em vez de falhar.

### Uma fonte devolveu 0 vagas

Nada é fechado. O bloco de fechamento em `syncOne()` só roda quando
`seenFingerprints.length > 0` — é uma proteção deliberada contra uma API que
responde `200 []` num dia ruim e apagaria o acervo inteiro daquela fonte.

### Um score parece errado

```bash
pnpm jho jobs show <id>
```

Compare o breakdown com os máximos e leia as `reasons` — elas são a saída
auditável do scorer, não decoração.

| Componente | Máx. | Sintoma típico e o que significa |
|---|---:|---|
| `title` | 35 | `0` + reason `Title contains avoided term "…"` → bateu em `targets.avoid_titles` e o cluster virou `other`. `0` + `Title does not match any target cluster` → nenhum título dos 5 clusters casou |
| `keywords` | 30 | Baixo com `Missing:` grande → a vaga é off-axis. Baixo com `Matched:` vazio → provavelmente `description_text` é `null` (SmartRecruiters) e só o título foi pontuado |
| `seniority` | 12 | `7.2` = `No explicit years requirement` (fator 0,6). `0` = pede menos que `reject_below_years: 3` |
| `geo` | 15 | `15` = LATAM/Brazil explícito. `13.5` = worldwide. `8.25` = remoto sem região declarada. `0` = sem sinal de remoto, ou restrito a uma região fora do Brasil |
| `comp` | 8 | `4` = `No compensation disclosed`. `0` = abaixo do `floor` de 90000/ano — **atenção: a moeda não é convertida**; `comp_currency` entra no `ScoreInput` e não é usada no cálculo |
| `penalty` | — | `12 × nº de blockers` + `5` fixos se houver **qualquer** keyword negativa (não é 5 por termo) |

Se o breakdown está certo e a *sua* expectativa é que estava errada, o conserto
é no `profile.yaml`, não no código: adicione o título ao cluster, ajuste o
`weight` do termo, ou escreva um blocker novo. Depois **bump `SCORER_VERSION` e
`jho jobs score --all`** — não existe caminho válido que pule esse par.

Um blocker com regex malformada não derruba a run: vira a string
`(invalid blocker pattern: <pattern>)` dentro da lista de blockers da vaga. Se
você vir isso em `jho jobs show`, o `pattern` no YAML está quebrado.

### O banco precisa ser reconstruído

Primeiro: quase nunca precisa. `runMigrations()` é idempotente e roda a cada
`jobs sync`; mudança de schema se resolve com `pnpm db:generate` (gera o SQL em
`drizzle/`) seguido de `pnpm jho db migrate`. Reconstruir do zero só faz sentido
com arquivo corrompido.

Antes de qualquer coisa destrutiva, **copie o arquivo**:

```bash
cp data/jobs.db "data/jobs.db.bak-$(date +%F)"
```

Reconstruir o acervo:

```bash
mv data/jobs.db data/jobs.db.old
pnpm jho db migrate
pnpm jho jobs sync
```

Agora o problema: `job.id` é `AUTOINCREMENT`, então os ids do banco novo **não**
correspondem aos antigos. O que amarra as duas versões é o `fingerprint`, que é
determinístico (`sha256(companySlug|normalizedTitle|normalizedLocation)`, 32
chars hex). Receita para trazer as candidaturas de volta:

```bash
sqlite3 data/jobs.db "
  attach 'data/jobs.db.old' as old;
  insert into application (job_id, status, channel, applied_at, cv_variant,
                           contact_name, contact_url, rate_discussed,
                           next_action, next_action_at, notes, created_at, updated_at)
  select j.id, a.status, a.channel, a.applied_at, a.cv_variant,
         a.contact_name, a.contact_url, a.rate_discussed,
         a.next_action, a.next_action_at, a.notes, a.created_at, a.updated_at
  from old.application a
  join old.job oj on oj.id = a.job_id
  join job j      on j.fingerprint = oj.fingerprint;"
```

Duas ressalvas honestas: candidatura cuja vaga não voltou em nenhuma fonte não
tem `job` para apontar e fica de fora; e `application_event` não é migrado
acima, porque `application.id` também muda e cada evento precisaria ser
remapeado. Por isso o `.bak` do arquivo inteiro é o backup que vale.

> **Invariante:** A receita do `fingerprint` exclui deliberadamente a fonte e a
> URL — é isso que colapsa a mesma vaga vista pelo board Ashby da empresa e por
> um agregador. Mudar a receita invalida a deduplicação de todo o banco
> existente e quebra qualquer restauração como a de cima.

### Um board devolve 404

Um 404 não é retentado (`RETRYABLE` = `{408, 425, 429, 500, 502, 503, 504}`) —
o comentário no `http.ts` diz o porquê: *"A 404 means the board handle is wrong;
retrying just wastes time."*

1. Confirme o significado do `handle` para aquele `kind`:

| Kind | O que é o `handle` |
|---|---|
| `greenhouse` | board token em `boards-api.greenhouse.io/v1/boards/<token>` |
| `lever` | company slug em `api.lever.co/v0/postings/<slug>` |
| `ashby` | board name em `jobs.ashbyhq.com/<board>` |
| `smartrecruiters` | company identifier |
| `recruitee` | subdomínio em `<handle>.recruitee.com` |
| `himalayas` | query free-text opcional (`""` = tudo que é recente) |
| `remotive` | termo de busca opcional |
| `arbeitnow` | ignorado (board inteiro) |
| `remoteok` | ignorado (board inteiro) |
| `adzuna` | `"<country>:<query>"`, exige `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` |

2. Teste o candidato sem gravar nada:

```bash
pnpm jho sources probe greenhouse stackblitz
pnpm jho sources probe ashby textlayer
```

3. Se o board realmente sumiu (empresa trocou de ATS, board despublicado),
   marque `enabled: false` na entrada do `config/sources.yaml` em vez de apagar
   a linha — o `rationale` continua explicando por que aquela empresa entrou na
   lista.

**Efeito colateral que ninguém espera:** desabilitar uma fonte não fecha as
vagas dela. O fechamento só acontece dentro do `syncOne()` daquela fonte, e
o sync só seleciona fontes habilitadas antes de sequer começar. As vagas
ficam abertas e continuam aparecendo em `jho jobs list`. Se a intenção era
aposentar a fonte, feche-as explicitamente:

```bash
sqlite3 data/jobs.db "
  update job set closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where source_id = 'arbeitnow:' and closed_at is null;"
```

Depois `pnpm jho db prune --days 90` recolhe o que não tem candidatura.

> **Invariante:** Nunca escreva um mapeamento de campos a partir de
> documentação. Todo adapter atual foi verificado contra uma resposta real via
> `jho sources probe` antes do commit — mantenha assim ao consertar um.

### O CLI estoura `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`

Alguém escreveu sintaxe TypeScript não-apagável. O runtime é o type stripping
nativo do Node 24: sem `enum`, sem parameter properties
(`constructor(private x: T)`), sem `namespace`, sem decorators.
`erasableSyntaxOnly: true` está ligado no `tsconfig.json` para pegar isso em
`pnpm typecheck`, antes de virar erro de runtime. Contexto em
[`docs/adr/0006-typescript-apagavel-sem-build-step.md`](adr/0006-typescript-apagavel-sem-build-step.md).

---

## Referência rápida

```bash
pnpm jho jobs sync                       # diário: buscar + pontuar
pnpm jho jobs list --min-fit 60          # diário: revisar o topo
pnpm jho jobs show <id>                  # diário: entender o score
pnpm jho track <id> <status> -n "nota"   # diário: mover no funil
pnpm jho tasks list                      # diário: plano de posicionamento em aberto
pnpm jho tasks done <PT-XXXX>            # diário: fechar item do plano

pnpm jho profile                         # semanal: validar profile.yaml
pnpm jho jobs score --all                # semanal: após bump de SCORER_VERSION
pnpm jho db prune --days 90              # semanal: limpar fechadas sem candidatura
pnpm jho db cleanup                      # semanal: inventário sem alterar
pnpm jho db cleanup --apply              # semanal: descartar payload reconstruível
pnpm jho report                          # semanal: snapshot no vault
pnpm jho pipeline                        # semanal: estado do funil
pnpm jho sources list                    # semanal: saúde das fontes
pnpm jho tasks show <PT-XXXX>            # semanal: detalhe de um item do plano
pnpm jho db seed                         # sob demanda: plano + baseline de métricas (idempotente)
pnpm check                               # semanal: changelogs, tracker de QA, tsc, vitest, skills de QA
```


## A rotina, atualizada

### Diária

```bash
pnpm jho jobs sync                       # busca e pontua
pnpm jho terms run                       # repete as buscas por termo salvas
pnpm jho jobs score                      # dá nota ao que os termos trouxeram
pnpm jho jobs list --min-fit 60          # ou abra localhost:3000
pnpm jho track <id> shortlisted -n "motivo"
```

No dashboard, o preset **"Aplicáveis hoje"** (`fit=60&unblocked=1&named=1`) é o
que vale abrir primeiro: corta bloqueios estruturais e agregadores anônimos de
uma vez.

### Semanal

```bash
pnpm jho fx refresh                      # cotações do BCE
pnpm jho jobs verify --min-fit 55 --limit 250   # fecha o que morreu
pnpm jho mail import ~/mail              # alertas e e-mails de ATS
pnpm jho mail suggestions                # revisa o que o e-mail sugere
pnpm jho referrals                       # onde você já conhece alguém
pnpm jho db cleanup --apply --closed-days 90
pnpm jho report                          # snapshot pro vault
```

`jobs verify` é o que mantém o board honesto: 25% dos links do Jobgether
estavam mortos na primeira execução. Sem isso, a lista envelhece em silêncio e
você perde confiança no ranking junto com os links.

### Ao mexer no perfil

```bash
# editar profile/profile.yaml
pnpm jho profile                         # valida
# bump SCORER_VERSION em src/core/scoring/score.ts
pnpm jho jobs score --all
```

---

## Ordem que importa

Uma armadilha real: **`jobs sync` sem `fx refresh` prévio** pontua vagas em
moeda estrangeira sem taxa de câmbio. Elas não quebram — o scorer recusa a
comparar e diz isso —, mas ficam com o componente de remuneração neutro.

Outra: **`jobs sync --no-score`** deixa as vagas novas sem pontuação. O sync
avisa, mas se você usar essa flag, rode `jobs score` depois.

Desde a correção da invalidação, conteúdo alterado **descarta o score
automaticamente** e o sync reporta quantos foram invalidados.



---

## Erro do Turbopack no dev server

Sintoma, depois de muitas edições com `pnpm dev` no ar:

```
FATAL: An unexpected Turbopack error occurred.
[Server HMR] Subscription error: TurbopackInternalError: Cell CellId ... no longer exists
```

É um defeito interno do HMR do Turbopack: o cache incremental fica inconsistente
quando muitos arquivos mudam sob o servidor. Não é defeito da aplicação, e o
build de produção não é afetado.

```bash
pkill -f "next dev"
rm -rf .next
pnpm dev
```

Se voltar com frequência, rode o dev server sem Turbopack (`next dev`, sem a
flag) enquanto durar a sessão de edição pesada.
