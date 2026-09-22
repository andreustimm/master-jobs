# Latência das buscas

Nota de continuidade: nasce e morre com este slug (ADR 0011). O que sobrevive à
tarefa — diagnóstico, medidas, decisões — está em
[`docs/engineering/performance-buscas.md`](../../../docs/engineering/performance-buscas.md),
entregue em `dev` pela PR #175.

## Objetivo

As buscas (`/jobs`, `/`, `/searches`) estavam lentas e o sistema não tinha
nenhuma medida. A meta é reduzir a latência percebida **e** poder provar cada
ganho com número. A primeira entrega cortou a rede e as idas ao banco; o que resta
é o trabalho pesado sobre o acervo e a percepção de interatividade dos filtros.

## Estado em 2026-09-22

| Item | Estado |
|---|---|
| PR 1 — [#175](https://github.com/andreustimm/master-jobs/pull/175) | Em produção pela PR #178, mesclada em 22/09 às 13:39 UTC; CI e fumaça de produção verdes. |
| Verificação em produção | Deploy e fumaça confirmados; pendente medir `x-vercel-id` = `<borda>::gru1::…` e a primeira linha `perf` de `/jobs` com `JHO_PERF_LOG=1` |
| Tarefa 17 | Entregue: vigia em `/` e `/jobs`, teto nas funções de composição e QA de concorrência aprovado. Já em main. |
| Tarefa 13 | Em validação na branch `perf/filtro-salarial`; demais tarefas ainda pendentes. |

**Base das próximas branches.** As tarefas abaixo usam coisas que só existem com a
#175 (`pnpm perf:jobs`, `hasFullDescription`, `renderSession`, o cronômetro de
estágios). A #175 já foi mesclada: partir de `origin/dev` atualizado, em worktree própria.

## Linha de base para bater

`pnpm perf:jobs` (10 mil vagas, mediana de 3, PostgreSQL local sem rede — é o
**piso**; o custo real em produção soma um round-trip por estágio em série).

| Cenário | total ms | idas | estágios (ms) |
|---|---:|---:|---|
| padrão | 77 | 9 | prelude=1.3 board=35.6 facets=38.5 tail=1 |
| com termo | 192 | 9 | prelude=1.1 board=71.2 facets=117.8 tail=1.4 |
| com cluster | 50 | 9 | prelude=1.2 board=21.1 facets=26.7 tail=0.8 |
| faixa salarial | 371 | 10 | prelude=1.3 board=304.5 facets=39 tail=25.8 |
| ordenar por pagamento | 88 | 9 | prelude=1.1 board=45.9 facets=39.2 tail=1.2 |
| sem agrupar | 63 | 8 | prelude=1 board=43.5 facets=17.2 tail=1.2 |

Guarde o relatório antes de mexer (`JHO_PERF_OUT=antes.txt pnpm perf:jobs`) e
anexe antes e depois na PR. O console do vitest é capturado: sem `JHO_PERF_OUT`
você não vê a tabela.

## Tarefas

Ordem sugerida, e o que depende do quê. Cada uma é uma PR própria para `dev`.

| # | Tarefa | Depende de | Migration | QA de jornada |
|---|---|---|:---:|:---:|
| 13 | Normalização salarial compartilhada | — | não | não |
| 11 | Conjunto filtrado calculado uma vez | — | talvez (`group_key`) | não |
| 12 | Busca por termo indexada | confirmar `pg_trgm` no Supabase | **sim** | não |
| 17 ✅ | Régua de conexões por tela e `comVigia` em `/jobs` e `/` — entregue | — | não | QA de concorrência aprovado |
| 14 | Cache de facetas com TTL | 11 e 12, **e medir antes** | não | não |
| 15 | `loading.tsx` + `Suspense` em `/jobs` | 14 | não | sim |
| 6 | Overlay só na troca de rota | — | não | **sim** |
| 16 | Filtros que se aplicam sozinhos, `staleTimes` | 12 e 14 | não | **sim** |
| 18 | Sentry tracing com escrubagem | — | não | não |

**Por que 16 espera 12 e 14:** aplicar filtro a cada arrasto de slider sem
busca indexada e sem cache de facetas transforma cada movimento em cinco
varreduras do acervo.

### 13 — Normalização salarial compartilhada

Implementada na branch `perf/filtro-salarial`, em validação antes da PR.
Com 10 mil vagas, 29 moedas, três aquecimentos e dez amostras, a mediana da
faixa salarial caiu de 395,05 para 109,95 ms; ordenar por pagamento caiu de
96,75 para 89,15 ms. São tempos locais, sem rede.

A faixa compartilha uma CTE entre a consulta externa e a seleção do grupo;
ordenar sem faixa usa uma junção lateral. O SQL total da tela com faixa caiu
de 183.062 para 48.326 bytes e de 1.169 para 301 parâmetros. Os seis resultados
de referência são idênticos antes/depois, incluindo ordem e valores.
Evidência e reprodução em `docs/engineering/performance-buscas.md`.

### 11 — Conjunto filtrado calculado uma vez

- `canonicalOfGroup` (`repo.ts`, ~linhas 413–433) roda dentro de
  `boardConditions` em: lista, contagem, três facetas e `countHiddenByPayRange`.
  São 5 a 6 varreduras do acervo por requisição, cada uma com `row_number()`.
- Direção: `count(*) over()` na lista (elimina a contagem separada), fundir as
  três facetas, e avaliar materializar `group_key`/`is_canonical` no ingest
  (migration — ver a skill `drizzle-safe-migrations`).
- Pronto quando: as `idas` e o `facets`/`board` do `perf:jobs` caem, e os totais
  exibidos na tela continuam idênticos (há teste de que o chip conta o mesmo que
  o rodapé).

### 12 — Busca por termo indexada

- `repo.ts` (~linhas 500–506): regex `~*` sobre título, empresa e
  `coalesce(job_page.text, description_text)`. **Medido:** 160–175 ms por
  consulta, cinco consultas por requisição.
- `src/core/term.ts` (~linhas 60–71): o padrão `[ -]?` entre letras impede a
  extração de trigramas (INFERIDO). Repense a semântica de "palavra inteira"
  antes de escolher `pg_trgm` ou `tsvector`.
- **Confirmar antes:** `pg_trgm` e `unaccent` no plano Supabase do projeto
  (`select name from pg_available_extensions`, só leitura; não foi conferido).
- Migration: suspende a promoção automática (`dev` → `staging`) enquanto a
  diferença em `drizzle/` existir. Decida se é aditiva. ADR se restringir o
  futuro. Atualize `docs/data-model.md`.

### 17 — Régua de conexões por tela — concluída

O commit `b04ed5e` extraiu a composição de `/`, `/jobs` e `/searches` para
funções exercitadas por `tests/db-fan-out.test.ts`, com teto `POOL - 1`.
O vigia cobre autenticação e leitura em `/` e `/jobs`. O E2E percorre pedidos
concorrentes e o cenário `JOBS-concurrent-heavy-screens` tem QA `pass` no
[relatório de 21/09](../../../docs/qa/reports/2026-09-21-execucao-concorrencia.md).
Esse commit já está em `main`; não reimplementar a tarefa a partir da nota antiga.

### 14 — Cache de facetas

- As facetas só dependem de `minFit`, `cluster`, `term`, `sources`, `workMode`,
  `track` e `groupRepeats` — não de `page`, `size`, `sort`, `dense`, `pay` nem
  `company`. Paginar ou ordenar refaz três varreduras à toa.
- Direção: `unstable_cache` (ou mapa com TTL no processo) com chave
  `candidateId` + filtros + `SCORER_VERSION`, TTL ~60 s, e `revalidateTag(tag,
  'max')` nas ações que hoje só chamam `revalidatePath`. O sync e o score rodam
  **fora** do processo do Next: só o TTL os cobre.
- **Sem `cacheComponents`** e **sem Redis** — decisões registradas em
  `performance-buscas.md`. Lógica em `src/contexts/matching/app` (regra 4).
- Só faça depois de medir com o log por estágio em produção.

### 6, 15, 16 — Percepção (mexe na interface)

- **Overlay (6):** `TransitionLink` e `TransitionGetForm` chamam
  `transitionStore.begin()` sem atraso; toda navegação abre um overlay opaco de
  ~440 ms (`TRANSITION_MIN_MS` 180 + `SPLASH_FADE_MS` 260) com o shell `inert`.
  Opções: não abrir quando o `pathname` não muda e usar `useLinkStatus` /
  `data-pending` na lista, ou atrasar o overlay até ~250 ms. Manter `offline` e
  `prolonged`.
- **Cuidado:** `tests/e2e/ui.mjs` tem 28 referências ao overlay e **76** somando
  `observeNavigation` e `data-phase` — o `contextualPhases` assume overlay em
  **toda** navegação. Cinco arquivos de teste (`navigation-transition`,
  `pwa-transition`, `cov-transition-store-ambiente`, `navigation-adapters`,
  `pwa-chrome`), `docs/qa/reports/2026-08-23-task-02-loading-transicoes.md` e
  `BUG-20260824-canonical-route-splash`. A regra 20 exige QA de jornada.
- **Desenho proposto para o 6 — transição "suave"** (dimensionado em
  2026-09-21, **nenhum código escrito**; a worktree `perf-overlay-filtros` foi
  criada, ficou vazia e pode ser descartada):
  1. `NavigationTransition` (`src/core/pwa/transition.ts`) ganha `soft: boolean`;
     o evento `start` a carrega; `prolonged` e `offline` a zeram (**promovem** a
     transição ao overlay atual, preservando o tratamento de demora e de falta
     de rede).
  2. `store.begin` decide `soft` comparando o `pathname` do destino com o da URL
     atual: só mudou filtro, ordem, página ou densidade → suave.
  3. `NavigationTransition` (`app/navigation-transition.tsx`): overlay e `inert`
     só quando `!soft`. Suave vira `aria-busy` e um atributo no
     `#application-shell`, e uma regra CSS em `app/globals.css` escurece o
     conteúdo (`opacity`, sem cor nem tamanho novos — regra 10). O shell segue
     interativo, e um novo clique começa outra geração: vence o último.
  4. As fases (`loading` → `leaving` → `reset`) continuam iguais no store: só a
     apresentação muda. O `NavigationCommitObserver` também cai aqui, sem exceção.
  5. Testes: os três de unidade acima e, sobretudo, o E2E. Navegação de filtro,
     ordem e página passa a afirmar o estado suave; navegação entre rotas mantém
     as asserções de overlay. **Rode o E2E com a máquina livre e em série** —
     `docs/qa/README.md` mede que a suíte reprova por carga.
  6. QA: `qa-report` targeted e `qa-execution`; os cenários de transição em
     `docs/qa/` voltam a `untested`.
  Ganho esperado: ~440 ms a menos em cada clique de filtro, independente do
  servidor.
- **`loading.tsx` (15):** o teste `navigation-adapters` afirma que
  `app/loading.tsx` **não existe**; ponha em `app/jobs/`. Ele também liga o
  prefetch até a fronteira em rota dinâmica: teste.
- **Filtros (16):** `Slider.Root` do Base UI tem `onValueCommitted`;
  `requestSubmit()` com debounce de ~300 ms; `q` com ~400 ms e mínimo de 3
  caracteres; a URL segue como fonte da verdade. Texto de interface vem do
  dicionário (regra 9) e cor só por token (regra 10).

### 18 — Sentry tracing

- `tracesSampleRate` é 0 porque a transação carrega a URL com a query string, isto
  é, os filtros da pessoa. Ligar exige `beforeSendTransaction` e
  `beforeSendSpan` reaproveitando `scrubEvent`/`redactPath` de
  `src/core/observability.ts`, e teste de que nada vaza.
- **Não confirmado:** a quota de spans do plano Developer (o "5M" veio de resumo
  de página de preços) e se `instrumentPostgresJsSql` existe no `@sentry/nextjs`.
  Memória do projeto: `sentry-configurado-so-servidor`.

## Como validar

Prefixe **todo** comando de shell com `rtk` (Codex e OpenCode). Node 24.19.

```bash
rtk pnpm check              # changelogs, tracker de QA, typecheck, testes com cobertura
rtk pnpm test:e2e           # browser real isolado — obrigatório se tocar página, layout ou sessão
rtk pnpm perf:jobs          # antes e depois, com JHO_PERF_OUT
```

Suítes pesadas em sequência, uma por vez (a máquina reprova por memória, não por
regressão: `Worker exited unexpectedly` sem nenhum `×`).

## Regras do repositório que mais mordem aqui

- **18** — worktree a partir de `dev`, branch `<tipo>/<slug>`, PR para `dev`.
- **19** — `deep-review` antes de pedir revisão; `SHIP` ou a decisão escrita na PR.
- **20** — mudança visível atualiza e percorre o QA vivo (`docs/qa/`); refactor
  puro declara "sem mudança visível".
- **21** — commit releaseável leva os três changelogs em `## [Unreleased]`.
  **Acrescente**, não substitua: a memória `changelog-corrida-com-promocao`
  registra a entrada que sumiu quando outra PR reescreveu o bloco.
- **23** — `docs/` atualizado (`data-model.md` se schema, `operations.md` se
  invariante) ou uma linha na PR dizendo por quê.
- **4, 5, 9, 10** — módulo novo entra por porta só onde há variação real; sintaxe
  TypeScript apagável (sem `enum`); texto de UI do dicionário; cor por token.
- **Dado faltante pontua neutro** e o scorer só muda com bump de `SCORER_VERSION`
  (não deve ser preciso aqui).

## Armadilhas já pagas

- **Régua por função aprova a tela que estoura.** Conte consultas e picos por
  **requisição**.
- **Número local é piso.** Sem rede a ida custa quase nada; o custo real é
  `estágios em série × round-trip`.
- **`rtk` esconde erro de ferramenta:** rode `tsc --noEmit` para um arquivo de
  log e leia o log bruto.
- **`Server-Timing` não serve a páginas**; a medição em produção é o log JSON por
  estágio (`registrarTempo`).
- **Mude a região e o teste juntos:** `tests/function-region.test.ts` trava
  `vercel.json` contra o host do pooler de produção.

## Pendências fora de código

- O plano da Vercel é Hobby, restrito a uso pessoal e não comercial; o
  repositório tem papel de recrutador. Confirmar o plano em uso.
- Disponibilidade de `pg_trgm`/`unaccent` e de "Query Performance" no plano
  Supabase.

## Retomada de 22/09/2026

O usuário autorizou concluir todas as tarefas de performance e as pendências
B-11/O-01/O-02/O-03 da tabela de continuidade. O-01 está retomada por esse pedido.
Não criar conta Upstash nem introduzir Redis: o usuário confirmou a continuidade
do cache local com TTL. A promoção para produção mantém o gate humano.

Em 22/09, o usuário acrescentou a definição e aplicação de SLA/SLO e métricas
de governança. A continuidade operacional registra esse escopo; a documentação
durável ficará em `docs/engineering/`. Sem criar serviços pagos ou contas novas.

A tarefa 13 preserva os contratos de remuneração, ordem, agrupamento, autorização
e paginação; só troca o plano de consulta. Sem mudança visível de comportamento,
portanto QA de jornada não se aplica a essa tarefa. `pnpm check`, E2E e revisão
profunda continuam obrigatórios antes da PR.
