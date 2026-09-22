# Latência das buscas — diagnóstico, medição e plano

Levantado em 2026-09-21, a partir de "as buscas estão lentas e não temos nenhuma
observabilidade". Quatro leituras independentes (consultas e índices, renderização
e cache, infraestrutura, ferramentas gratuitas) foram cruzadas aqui. **Cada
afirmação diz se foi MEDIDA ou INFERIDA** — a lentidão era uma sensação sem
número, e a primeira entrega foi justamente poder medi-la.

> Este documento diz **como é agora**. O que mudou em cada versão está nos
> changelogs; o que ainda falta está na seção [Plano](#plano).

## Como medir

Três camadas, da mais barata para a mais fiel. Nenhuma substitui a outra.

| Camada | Comando ou sinal | O que responde | Limite |
|---|---|---|---|
| **Piso local** | `pnpm perf:jobs` | Quanto o servidor gasta sobre o banco em 6 cenários (padrão, termo, cluster, faixa salarial, ordenar por pagamento, sem agrupar), 10 mil vagas, e **quantas idas ao banco** cada um faz. Hermético: Postgres em Docker, fora do `pnpm check`. `JHO_PERF_OUT=arquivo` guarda o relatório; `JHO_PERF_JOBS=N` muda o corpus; `JHO_PERF_RUNS=N` e `JHO_PERF_WARMUPS=N` controlam as repetições (inteiros positivos, padrões 3 e 1); `JHO_PERF_JSON=arquivo` guarda amostras, volume de SQL/parâmetros, resultados de referência e plano de execução | Sem rede. Não mede React nem o navegador |
| **Produção, por estágio** | Linha JSON `{"perf":"/jobs","totalMs":…,"region":"gru1","stages":{…}}` no log da função | Onde uma requisição real gasta o tempo: `auth`, `prelude`, `board`, `facets`, `tail` (e `cockpit` em `/`) | Sai só se a leitura passa de 1 s, ou sempre com `JHO_PERF_LOG=1`. Log da Vercel na Hobby dura 1 h |
| **Região** | Cabeçalho `x-vercel-id` da resposta | Onde a função rodou. `<borda>::gru1::…` é o certo (o primeiro trecho é a borda de quem pediu, só o segundo é a função); `<borda>::iad1::…` é a função longe do banco | Só diz a região, não o custo |

A linha de log leva só número, nome de estágio, rota **sem query string** e
região. Nunca valor de filtro, identidade ou id de candidato — a URL carrega o
filtro da pessoa, e é por isso que o Sentry roda sem tracing (ver
[Sentry](#sentry-e-o-que-fica-de-fora)).

**`Server-Timing` não serve aqui.** Server Components não escrevem cabeçalho de
resposta (a documentação do Next não tem API para isso), e o `proxy.ts` roda
antes da renderização, sem saber quanto ela vai custar. Vale para rota de API,
que não é onde a lentidão está.

## Diagnóstico

O tempo vem de três camadas somadas. **Falta de índice não é uma delas**: um scan
em `job` custa ~2 ms, porque 61% das vagas estão abertas.

### 1. Rede: a função estava longe do banco

- **MEDIDO:** funções da Vercel em `iad1` (Virgínia, `vercel.json`); banco
  Supabase em `sa-east-1` (São Paulo, `supabase projects list` e o host do
  pooler em `scripts/migration/production-target.ts`). O `x-vercel-id` de
  produção era `gru1::iad1::…`: borda em São Paulo, função na Virgínia, banco em
  São Paulo.
- **INFERIDO:** cada ida pagava ~110–130 ms de round-trip. Não foi medido, porque
  só se mede de dentro da função — o log por estágio existe para isso.
- `docs/engineering/deploy.md` dizia `aws-us-east-1`. Era sobra do Turso.

### 2. Aplicação: cascata, sessão triplicada, nada em cache

- **MEDIDO (`pnpm perf:jobs`):** `/jobs` fazia de 10 a 12 consultas por
  requisição. Só o prelúdio já eram 5 ou 6 esperas em série: trilhas, as
  **mesmas** trilhas para o escopo (e de novo para o cluster), termos salvos,
  câmbio em duas consultas.
- `currentSession()` rodava 3× por carga (layout, `SessionBadge`, página), cada
  uma com `getCandidate()` + `resolveSession()` — e `getCandidate()` só serve ao
  modo aberto, que não existe em produção.
- Nenhum cache (`unstable_cache`, `'use cache'`, `cache()` do React), nenhum
  `loading.tsx`, `Suspense` só no observador de navegação.
- O teto de conexões (`POOL - 1` = 2 por leitura) é o que empurra tudo para série.
  Ver `docs/operations.md` → Troubleshooting.

### 3. Banco: o mesmo trabalho pesado repetido por requisição

Números do PostgreSQL local com 9 mil vagas, sem rede — o **piso**.

| Achado | Evidência | Estado |
|---|---|---|
| Varreduras repetidas por requisição (`canonicalOfGroup`) | Lista e total compartilham a seleção; as facetas usam outra leitura com dimensões independentes; o aviso salarial mantém sua própria semântica | **MEDIDO**, corrigido na tarefa 11 |
| Busca por termo: regex `~*` sobre título, empresa e descrição, que nenhum índice atende diretamente | 160–175 ms por consulta × 5 consultas; só `sum(length(description_text))` leva 116 ms | **MEDIDO**, pré-filtro trigrama em revisão (#214, seção abaixo). O padrão `[ -]?` de `term.ts` de fato impede a extração de trigramas: **MEDIDO**, o índice direto devolveu 8.863 de 9.060 linhas |
| `length(descricao) >= 200` calculado em todas as linhas antes do `LIMIT`, para a UI só testar `< 200` | 103 ms → 26 ms com `substr` (mesmo resultado em 199/200/201, acento, emoji, vazio, nulo) | **MEDIDO**, corrigido |
| Faixa salarial: `paySql` interpolada repetidamente | Na tela completa com 29 moedas, 183 KB de SQL e 1.169 parâmetros; normalização compartilhada reduziu para 48 KB e 301 | **MEDIDO**, corrigido; comparação abaixo |
| Estimativa errada do planner em `coalesce(fit,0) >= n` sobre `LEFT JOIN` | estimou 2 linhas, vieram 1.568 | **MEDIDO**, aberto |
| `/searches`: N+1 de `countNewJobs` (até 20 termos) e `listTracks` duplicado | leitura do código, consultas leves por índice | INFERIDO, custo é round-trip |

Paginação por `OFFSET` **não** é o problema (top-N heapsort de 107 kB), e o
agrupamento em JS custa 18 ms no pior caso (50 linhas × 42 publicações).

### 4. Percepção: o overlay custa mais que o servidor

`TransitionLink` e `TransitionGetForm` chamam `transitionStore.begin()` sem
atraso. Toda navegação — inclusive mudar só um chip de filtro — abre um overlay
opaco de tela cheia: **180 ms mínimos** (`TRANSITION_MIN_MS`) mais **260 ms** de
esmaecimento (`SPLASH_FADE_MS`), com o shell `inert`. ~440 ms fixos, mesmo se o
servidor responder na hora. **MEDIDO no código; não cronometrado no navegador.**

**Mudança da #220 (em revisão para `dev`):** na mesma tela o overlay não abre mais. O store decide
por `isSameScreenNavigation` (mesmo `pathname`, query diferente) e marca a
geração como `soft`; a apresentação vira `aria-busy` e
`data-navigation="soft"` no `#application-shell`, com o `<main>` esmaecido por
CSS depois de 120 ms. O ciclo do store é o mesmo (mínimo, `leaving`, `reset`):
o ganho é a tela continuar visível e operável, não um fim mais cedo. Encerrar
no commit foi tentado e reprovado pelo E2E de modalidade: no voltar/avançar o
roteador confirma a URL antes de o conteúdo da entrada chegar, e o shell
anunciava pronto sobre a lista anterior por até alguns segundos. Na saída o
conteúdo volta à opacidade plena e `aria-busy` só cai no `reset`. Demora
(`prolonged`) e falta de rede (`offline`) zeram `soft` e promovem ao overlay.
Troca de rota continua igual.

## Baseline: antes e depois da primeira entrega

`pnpm perf:jobs`, 10 mil vagas, mediana de 3 execuções, mesma máquina. Coluna
**idas** = consultas por requisição.

| Cenário | idas antes | idas depois |
|---|---:|---:|
| padrão | 11 | 9 |
| com termo | 11 | 9 |
| com cluster | 12 | 9 |
| faixa salarial | 12 | 10 |
| ordenar por pagamento | 11 | 9 |
| sem agrupar | 10 | 8 |

O **tempo local não muda** (77–81 ms no padrão antes e depois): sem rede, a ida
custa quase nada. O ganho está nas idas em **série** — o prelúdio de `/jobs`
passou de 5–6 esperas para 1 — e cada uma custa um round-trip de verdade em
produção. Por isso a régua nova está em `tests/db-fan-out.test.ts`, que **conta**
consultas, e não em tempo.

## Normalização salarial — medição de 22/09/2026

O filtro salarial usa uma relação com uma remuneração normalizada por vaga
aberta. A consulta externa e a escolha da publicação do grupo compartilham essa
relação: a faixa não expande cotações e regras de período em cada comparação.
Quando só há ordenação ou exibição salarial, uma junção lateral procura a cotação
nas linhas participantes, evitando calcular o acervo inteiro sem necessidade.
Sem controle salarial, a consulta continua sem essa relação.

A mediana usa a média das duas amostras centrais quando há um número par de
execuções. Os estágios da tabela ilustram uma execução real: a amostra central
superior, que pode diferir da mediana do total.

Mesma máquina e corpus sintético de 10 mil vagas, três aquecimentos e dez
amostras por cenário. Medianas locais, sem rede; não são tempos de produção.

| Cenário | Antes | Depois | SQL total antes → depois | Parâmetros antes → depois |
|---|---:|---:|---:|---:|
| Faixa salarial | 395,05 ms | 109,95 ms | 183.062 → 48.326 bytes | 1.169 → 301 |
| Ordenar por pagamento | 96,75 ms | 89,15 ms | 54.797 → 35.580 bytes | 345 → 221 |

A comparação dos seis cenários preservou linha a linha os resultados, ordem,
valores, estados salariais, grupos, contagens e facetas. Os testes de contrato
comparam também todos os períodos ao normalizador TypeScript e verificam a
publicação elegível de um grupo quando a primeira fica fora da faixa.
A aritmética e o arredondamento não mudam; a consulta passa a reutilizá-los.

Para reproduzir a evidência estruturada:

```bash
rtk proxy env JHO_PERF_RUNS=10 JHO_PERF_WARMUPS=3 JHO_PERF_OUT=antes.txt JHO_PERF_JSON=antes.json pnpm perf:jobs
```

O JSON contém somente o corpus sintético do benchmark: amostras por estágio,
volume total de SQL/parâmetros, resultados de referência e `EXPLAIN (ANALYZE,
BUFFERS, FORMAT JSON)` da maior consulta de cada cenário. O plano é colhido no
aquecimento, fora das amostras cronometradas. Os resultados de referência devem
coincidir antes/depois; uma diferença impede declarar a otimização equivalente.

## Lista e facetas compartilhadas — medição de 22/09/2026

Contadores, clusters e fontes compartilham os filtros comuns em uma consulta.
Cada dimensão continua ignorando apenas o próprio filtro: selecionar uma fonte
não apaga as outras opções, e selecionar um cluster não apaga os demais.
A fonte integra a chave de agrupamento; o cluster pode variar entre publicações
do mesmo grupo. Por isso a leitura conserva dois representantes: o menor id
entre todas as elegíveis e o menor id entre as que passam pelo cluster escolhido.
As vagas anônimas continuam separadas, e o score e as candidaturas continuam
restritos à pessoa e à trilha da sessão.

A tela usa `listBoardPage`: total por janela sobre ids elegíveis e dados completos
somente depois do limite da página. Uma página além do fim, ou de tamanho zero,
não tem linha para carregar o total; nesses casos a contagem separada conserva o
rodapé correto. Os demais consumidores de `listBoard` não calculam a janela.
A lista continua usando os mesmos filtros e desempates.

A largura da janela importa: carregar descrições nela fez o cenário sem agrupar
escrever 967 blocos temporários no benchmark. Restringir a janela a ids e chaves
de ordenação zerou esses blocos; o plano final da página levou 8,47 ms. Não houve
migration, coluna materializada, cache nem mudança de semântica nesta entrega.

Três aquecimentos e dez amostras sobre o mesmo corpus de 10 mil vagas.
Medianas locais, sem rede; os seis resultados completos e seus hashes coincidem.

| Cenário | Total antes → depois | Facetas antes → depois | Consultas antes → depois |
|---|---:|---:|---:|
| Padrão | 75,20 → 59,35 ms | 37,75 → 23,50 ms | 9 → 6 |
| Com termo | 184,40 → 127,90 ms | 110,70 → 54,60 ms | 9 → 6 |
| Com cluster | 50,50 → 49,25 ms | 28,05 → 23,80 ms | 9 → 6 |
| Faixa salarial | 111,40 → 94,65 ms | 39,50 → 23,55 ms | 10 → 7 |
| Ordenar por pagamento | 86,05 → 70,45 ms | 38,25 → 22,65 ms | 9 → 6 |
| Sem agrupar | 65,20 → 33,55 ms | 18,60 → 18,05 ms | 8 → 5 |

`tests/board-facets.test.ts` cobre dimensões combinadas, a troca da publicação
representante, fontes distintas do mesmo tipo, empregador anônimo, cluster
nulo, arquivamento, candidatura alheia e conjunto vazio. A régua de consultas
exige uma única ida para todas as facetas e outra para página com total, além
da leitura das irmãs quando há agrupamento; o limite por tela continua valendo.
Os testes de paginação comparam a API nova à lista e à contagem independentes,
inclusive páginas além do fim, tamanho zero e grupos.

Com `JHO_PERF_PLANS=1` e `JHO_PERF_JSON`, o benchmark guarda também os planos de
todas as consultas, na ordem de envio. Eles são coletados no aquecimento, fora
das amostras. Sem essa opção permanece somente o plano da maior consulta.

## Busca por termo indexada — medição de 22/09/2026

A semântica não muda: o `~*` de palavra inteira de `termRegexSql` continua
sendo quem decide, em título, empresa e `coalesce(job_page.text,
description_text)`. O que entra é um **pré-filtro** que só descarta vaga que
nunca casaria (#214).

**Por que não um índice direto.** O `pg_trgm` aceita `~*`, mas precisa de
trigramas garantidos no padrão, e `[ -]?` entre cada letra não deixa nenhum:
com `gin_trgm_ops` sobre `description_text`, a busca por `java` leu 8.863 das
9.060 linhas pelo índice e as descartou na reconferência — mais lento que a
varredura. `tsvector` mudaria a semântica (radical, tokenização), e `unaccent`
não serve: o contrato atual não dobra acento.

**O pré-filtro.** Se o padrão casa, o texto sem espaço e sem hífen contém a
chave do termo (`tech-lead` → `techlead`). O índice é sobre essa forma, e a
consulta pergunta `ilike '%chave%'` a ele; `~*` e `ilike` concordam sobre caixa
nas letras ASCII, então o pré-filtro só vale para chaves ASCII com três letras
ou dígitos seguidos. Termo com acento, `C++`, `CI/CD` ou `go` seguem só com o
`~*`, como antes. Os candidatos vêm num `array(...)`: um InitPlan, calculado
uma vez por consulta. As duas alternativas medidas pioraram — `in (...)` dentro
do `or` vira subplano reconstruído duas vezes por ocorrência, e a semijunção
fora do `or` mudou a estimativa e levou o agrupamento a um laço aninhado de
3,4 s no benchmark.

**Acervo local real** (cópia com 9.060 vagas, 5.576 abertas; índices criados e
desfeitos dentro de uma transação; predicado isolado, `EXPLAIN ANALYZE`):

| Termo | Antes | Depois | Buffers antes → depois | Linhas |
|---|---:|---:|---:|---:|
| `typescript` | 160,7 ms | 35,1 ms | 18.103 → 2.998 | 276 = 276 |
| `java` | 143,9 ms | 34,9 ms | 17.891 → 3.234 | 201 = 201 |

Antes: `Seq Scan` em `job` com o `~*` sobre a descrição de toda vaga aberta —
descomprimir o texto domina (só `length(description_text)` nas abertas leva
117 ms). Depois: `Bitmap Index Scan` em `job_description_trgm_idx` (350 e 389
candidatos), reconferência com perdas na própria expressão e o `~*` só nas
linhas que passaram. O índice ocupa 19 MB, para uma tabela de 62 MB.

**Benchmark sintético** (`pnpm perf:jobs`, 10 mil vagas, três aquecimentos, dez
amostras, mesma máquina; os seis resultados completos coincidem por hash):

| Cenário | Antes | Depois | board | facets |
|---|---:|---:|---:|---:|
| Com termo | 129 ms | 155 ms | 72,9 → 89,7 | 53,3 → 64,2 |

O sintético **piora**, e a razão é a fixture, não a produção: suas descrições
são 40 hashes MD5 (≈1,3 KB, abaixo do limiar do TOAST, sem compressão) e o
termo `laravel` aparece em uma de cada sete. Sem descompressão o `~*` é barato,
e com 1.286 candidatos a reconferência e o `= any` linear custam mais do que
economizam. No acervo real as descrições são longas e comprimidas e o termo
buscado é seletivo — o caso para o qual o índice existe. **Nenhum destes números
é tempo de produção;** o ganho lá só se afirma com a medição de #221 depois do
deploy.

**Disponibilidade da extensão.** No PostgreSQL local de trabalho (imagem
`supabase/postgres:17.6.1.171`), `pg_available_extensions` lista `pg_trgm` 1.6
e `unaccent` 1.1, nenhuma instalada. No Supabase de produção **não foi
consultado** por este trabalho. Para confirmar, só leitura, no SQL Editor do
projeto:

```sql
select name, default_version, installed_version
from pg_available_extensions where name in ('pg_trgm', 'unaccent');
select extname, extversion, extnamespace::regnamespace from pg_extension;
```

O caminho recomendado é habilitar `pg_trgm` pelo painel (Database →
Extensions, schema `extensions`) antes de rodar `migrate.yml`; aí a `0010` não
faz nada. Se a migration a criar, ela vai para o primeiro schema do
`search_path` da role de migração, e o índice de `0011` resolve
`gin_trgm_ops` pelo mesmo `search_path`.

## Plano

| Fase | Item | Ganho × esforço | Onde |
|---|---|---|---|
| 1 ✅ | Função em `gru1`, ao lado do banco (`tests/function-region.test.ts` trava o par) | alto × mínimo | `vercel.json` |
| 1 ✅ | Sessão resolvida uma vez por requisição; `getCandidate()` só no modo aberto | alto × baixo | `app/auth.ts` |
| 1 ✅ | `description` mínima sem descomprimir o texto | alto × baixo | `repo.ts` |
| 1 ✅ | Prelúdio de `/jobs`: trilhas ∥ câmbio, sem `listTracks` duplicado, câmbio em 1 consulta | alto × baixo | `jobs-data.ts` |
| 1 ✅ | Medição: baseline local e log por estágio | habilita o resto | `perf:jobs`, `registrarTempo` |
| PR 2 | Overlay só na troca de rota (#220, em revisão); filtros que se aplicam sozinhos (#218) | alto × médio | fase 3 |
| 2 ✅ | Seleção compartilhada para lista e total, facetas fundidas | alto × médio | `repo.ts` |
| 2 🟡 | Busca por termo indexada: pré-filtro `pg_trgm`, `~*` inalterado (#214, em revisão) | alto com termo seletivo × médio | migration `0010`/`0011` |
| 2 ✅ | Normalização salarial compartilhada, sem repetir cotações a cada uso | alto com faixa | `repo.ts` |
| 2 | Cache de facetas com TTL — **só depois de medir** | médio × médio | `matching/app` |
| 3 | `loading.tsx` + `Suspense` em `/jobs` | só rende após o cache de facetas | `app/jobs/` |
| ✅ | Régua de conexões por **tela**, `comVigia` em `/jobs` e `/` | entregue e exercitado no QA de concorrência | testes |

### Decisões

- **Sem `cacheComponents`.** Exigiria tirar `force-dynamic` de todas as páginas e
  reintroduz o risco de dado velho que `next.config.ts` recusou de propósito. O
  sync e o score rodam **fora** do processo do Next, então só um TTL curto os
  cobriria.
- **Sem Redis agora.** Um usuário, instância reaproveitada pelo Fluid Compute:
  `React.cache` mais um mapa com TTL no processo bastam. Upstash entra atrás de
  um `CachePort` **quando** existir o segundo backend (regra 4 e ADR 0007 — porta
  com uma implementação só é cerimônia) e a medição mostrar hit rate baixo.
- **Memo do câmbio adiado.** Com a função em `gru1` cada ida custa poucos ms; o
  ganho é ≤ 1 round-trip. Medir com o log por estágio antes de decidir.
- **`renderSession` × `currentSession`.** Só renderização usa a sessão em cache.
  Ação e `guard*` leem sempre fresco: impersonação e troca de senha mudam a
  sessão **no meio** da requisição, e autorizar com o valor de antes seria a
  decisão errada.

## Sentry e o que fica de fora

`tracesSampleRate` está em 0 de propósito: uma transação carrega a URL com a
query string, isto é, os filtros da pessoa. Ligá-lo exige `beforeSendTransaction`
e `beforeSendSpan` reaproveitando `scrubEvent`/`redactPath`, e um teste de que
nada sai. Confirmar antes: a quota de spans do plano Developer (o "5M" veio de
resumo de página de preços) e se `instrumentPostgresJsSql` existe no
`@sentry/nextjs` (a documentação achada é de Deno e Cloudflare). Não foi feito
nesta entrega.

Ferramentas gratuitas avaliadas (limites consultados em 2026-09-21; confirme no
painel antes de depender de um número):

| Ferramenta | Veredito |
|---|---|
| `pg_stat_statements` + Supabase Reports | **Usar.** Consultas reais de produção, sem PII fora do Supabase. Reports guardam 24 h no Free |
| Vercel Observability e runtime logs | Usar o que há. Hobby: logs por 1 h, sem histórico |
| Sentry (já instalado) | Tracing depois, com a escrubagem acima |
| Better Stack (uptime) | Barato e sem PII, se quiser alarme externo |
| OpenTelemetry → Grafana Cloud ou Axiom | Só se o Sentry não bastar; conflita com o OTel do Sentry |
| Speed Insights, Web Analytics | Baixo valor para um usuário, e gravam a URL. Não habilitados no código |
| PostHog | Descartar: SDK de browser quebra a CSP `connect-src 'self'` e envia URL |
| SigNoz Cloud | Descartar: sem plano gratuito permanente |
| Upstash Redis (500 mil comandos/mês) | Só na condição da seção Decisões |

**Não confirmado:** `pg_trgm` e `unaccent` no Supabase de produção (consulta
de leitura em [Busca por termo indexada](#busca-por-termo-indexada--medição-de-22092026));
se "Query
Performance" existe no Free; o plano real da Vercel — o Hobby é restrito a uso
pessoal não comercial, e o repositório tem papel de recrutador.

## Armadilhas que já custaram caro

- **A régua medida por função aprova a tela que estoura.** O teto de conexões é
  por requisição; quem compõe leituras no corpo do Server Component escapa da
  régua. Ver `docs/operations.md`.
- **O número local é piso.** 77 ms no padrão contra um banco sem rede não diz
  nada sobre produção. O custo real é `estágios em série × RTT`.
- **Trocar a região sem trocar o teste.** Função em `iad1` com banco em
  `sa-east-1` não dá erro nenhum: só devolve 1 s a mais em silêncio.
  `tests/function-region.test.ts` existe por isso.
- **O overlay tem 28 referências no E2E** e cenários de QA vivos
  (`docs/qa/reports/2026-08-23-task-02-loading-transicoes.md`,
  `BUG-20260824-canonical-route-splash`). Mexer nele é trabalho de PR própria, com
  QA de jornada.
