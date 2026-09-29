# Tech Spec complementar — Tarefa 07: ordenação semântica opcional

Complementa [`_techspec.md`](_techspec.md) e [`task_07.md`](task_07.md) só
para o residual de ordenação semântica (US-020, ADR-001 seção 5). Não altera
nada já especificado para as tarefas 01–06. **Só documentação** — nenhum
código de produto muda com este arquivo.

Leitura de 2026-09-28, feita para desbloquear a tarefa 07 (issue #223,
comentário de reconciliação): "bloqueada até o dono decidir provedor de
embedding padrão e orçamento diário de indexação, e até alguém confirmar se a
extensão `vector` está disponível no Supabase de produção". Este documento
reúne as opções, os números medidos e uma recomendação; **não decide** — as
caixas abaixo são do dono.

## Decisões do dono

| # | Decisão | Recomendação deste documento | Owner decide |
|---|---|---|---|
| D1 | Provedor de embedding padrão | **OpenAI `text-embedding-3-small`** — mais barato do grupo pago, adapter HTTP quase idêntico ao que já existe para `openai` em `src/core/llm/registry.ts`. Ver [Opções de provedor](#opções-de-provedor). Alternativa de custo zero: NVIDIA NIM (mesma `NVIDIA_API_KEY` já configurada), aceitável porque a indexação é assíncrona e não tem SLA de latência (ver nota ADR-001). | [ ] |
| D2 | Orçamento diário de indexação | Começar em **US$ 0,50/dia** (ou equivalente em chamadas, se o provedor escolhido for gratuito) — no volume medido (5.576 vagas abertas), isso paga o backfill inteiro em menos de um dia com qualquer provedor pago da tabela abaixo, com margem de 3–10×. Subir depois de medir uso real. | [ ] |
| D3 | Armazenamento do vetor | **pgvector** (coluna `vector(dim)` na mesma tabela do banco de produção), como o PRD e a ADR-001 já decidiram — não a tabela de array + cálculo em app. Ver [Armazenamento](#armazenamento). Depende de D4. | [ ] |
| D4 | Confirmação de `vector` no Supabase de produção | Evidência forte de que está disponível (ver [Confirmação da extensão](#confirmação-da-extensão-vector)), mas **não verificada nesta sessão diretamente em produção** (regra do pedido: não usar produção). Rodar o comando de uma linha abaixo antes de começar a implementação. | [ ] A confirmar pelo dono |
| D5 | Onde a indexação roda | **GitHub Actions**, pelo `WorkflowDispatchPort` já usado por `source_run` (mesmo motivo do sync: a Vercel corta em ~25 s por fatia, ADR 0025; indexar texto normalizado de milhares de vagas não cabe nisso). | [ ] |

## Escopo

- Ordenação semântica é **opcional** e só reordena o conjunto que a tarefa 05
  (relevância lexical + proximidade) já filtrou — nunca adiciona nem remove
  linha (A4, regra 12 do PRD). Continua valendo mesmo com vetor presente.
- **Não toca o scorer** (G11, regra 6): `job_score`, `SCORER_VERSION` e a
  rubrica ponderada ficam fora deste escopo. Bloqueador de elegibilidade
  nunca é revogado por similaridade.
- Fica **atrás de uma porta de embedding** (G04): domínio (comparação de
  vetores, decisão de ausência/staleness) puro, sem rede nem banco; adapter
  HTTP do provedor escolhido é o único lugar que fala com o mundo.
- Indexação é **explícita, retomável e orçada**, fora do caminho da ingestão
  (`jho jobs sync` nunca aciona embedding).
- Sem vetor — provedor desligado, orçamento zerado, modelo diferente do
  configurado, ou linha nunca indexada — a busca é exatamente a da tarefa 05,
  sem qualquer menção a "semântica" na explicação (UT-019, UT-015, regra 14
  do PRD: vetor ausente é neutro, nunca penalidade).

## Volume medido (local, não produção)

Medido nesta sessão com `pnpm jho stats` e uma consulta SQL diretas no
Postgres local (`docker compose -f docker-compose.local.yml exec db psql`),
que roda a mesma imagem `supabase/postgres:17.6.1.171` documentada em
[`local-postgres.md`](../../../docs/engineering/local-postgres.md) como par de
versão da produção (`17.6.1.166`). **Não é o volume de produção** — é o
snapshot local disponível nesta máquina, importado por
`pnpm db:import-local`.

| Métrica | Valor medido | Como |
|---|---|---|
| Vagas abertas pontuadas | 5.576 | `pnpm jho stats` |
| Vagas totais na tabela `job` (abertas + fechadas) | 9.060 | `select count(*) from production.job` |
| Tamanho médio de `description_text` | 5.348 caracteres | `select avg(length(description_text)) from production.job` |
| Extensão `vector` instalada localmente | `0.8.2` (Postgres 17.6) | `verify.sql` (ver [Confirmação](#confirmação-da-extensão-vector)) |

**Limite do que foi medido.** O `first_seen_at` de 9.057 das 9.060 linhas cai
na mesma semana (2026-09-14), porque este snapshot local vem de uma
importação em lote, não de ingestão orgânica contínua — **não há, nesta
máquina, uma taxa confiável de "vagas novas por dia/mês"** para extrapolar.
Por isso o orçamento abaixo é calculado sobre o **catálogo aberto atual**
(backfill único) e sobre **cenários de reindexação diária configuráveis**, não
sobre uma taxa mensal inventada. Quem executar a tarefa deve reler
`pnpm jho stats` no momento da implementação — o número muda.

Estimativa de tokens por vaga: `description_text` médio (5.348 caracteres) +
título/empresa/localização/skills (varia, ~250 caracteres) ≈ 5.600
caracteres ≈ **~1.400 tokens/vaga** (regra de bolso de ~4 caracteres/token;
não é contagem de tokenizer real — validar com o tokenizer do provedor
escolhido antes de fixar o orçamento em produção).

## Opções de provedor

Preços consultados em 2026-09-28 (fontes ao final da seção; provedor de
embedding é serviço externo, então revalidar antes de habilitar em produção —
preço e limite de free tier mudam sem aviso).

| Provedor | Modelo | Preço | Custo estimado / 1.000 vagas (~1,4M tok) | Custo estimado / backfill atual (5.576 vagas, ~7,8M tok) | Latência | Privacidade |
|---|---|---|---|---|---|---|
| **OpenAI** | `text-embedding-3-small` (1536 dim) | US$ 0,02 / 1M tok (batch: US$ 0,01 / 1M tok) | **US$ 0,028** (US$ 0,014 em batch) | **US$ 0,16** (US$ 0,08 em batch) | Tipicamente <300 ms; sem SLA de free tier | Texto de vaga pública (não é CV nem dado de candidato); chave BYOK, nunca logada (regra 16/G41) |
| **Voyage AI** | `voyage-3-lite`/`voyage-3.5-lite` | US$ 0,02 / 1M tok; a série `voyage-4` inclui **200M tokens grátis** no cadastro | **US$ 0,028** (dentro da franquia grátis da v4, na prática **US$ 0**) | **US$ 0,16** (idem, cabe na franquia) | Comparável à OpenAI | Mesmo perfil — texto público de vaga |
| **Cohere** | `embed-v4` | US$ 0,12 / 1M tok | **US$ 0,168** | **US$ 0,94** | Comparável | Mesmo perfil; suporta 128k tokens de contexto (não é vantagem aqui) |
| **NVIDIA NIM** | `nvidia/nv-embedqa-e5-v5` ou `llama-3.2-nv-embedqa-1b-v2` | **Gratuito** (free tier do NVIDIA Developer Program) | **US$ 0** | **US$ 0** | Rate limit ~40 req/min, **compartilhado** com os modelos de chat já cadastrados em `src/core/llm/registry.ts` (`NVIDIA_API_KEY`); sem SLA — aceitável porque a indexação é assíncrona e a ADR-001 já proíbe chamar um provedor de LLM/embedding dentro da requisição interativa de busca | Mesmo perfil de dado; chave já existe no `.env.example`, reaproveita o padrão BYOK/`redactKey` do `LlmPort` |
| **Ollama (modelo local)** | ex. `nomic-embed-text`, `bge-small` | Gratuito, custo é compute local | US$ 0 | US$ 0 | Sem rede — mas exige um processo Ollama rodando em algum host; **não roda na Vercel** (serverless, sem processo persistente) | Nada sai da máquina — melhor privacidade da lista, mas exige infra própria que hoje o projeto não tem em produção |
| **transformers.js** (Node) | modelo ONNX pequeno (ex. `all-MiniLM-L6-v2`) | Gratuito | US$ 0 | US$ 0 | Depende de CPU disponível no worker; carrega modelo (dezenas de MB) a cada cold start se rodar em função serverless | Nada sai da máquina, mas adiciona binário/WASM pesado ao runtime — pior ajuste ao princípio de "adapter magro" (G05) e ao Node 24 type-stripping (G06 não bloqueia dependência de runtime, mas o bundle e o cold start pesam) |

**Por que a recomendação (D1) é OpenAI, com NVIDIA NIM como alternativa de
custo zero, e não Cohere/Voyage/local:**

- No volume medido, a diferença de custo entre todos os provedores pagos é
  irrelevante (US$ 0,08 a US$ 0,94 para reindexar o catálogo aberto inteiro
  uma vez) — a decisão real não é preço, é **operacional**.
- OpenAI já tem adapter HTTP e padrão de chave no projeto
  (`src/core/llm/registry.ts`, `src/core/llm/providers.ts`): o `EmbeddingPort`
  novo reaproveita o mesmo cliente HTTP, só troca `/v1/chat/completions` por
  `/v1/embeddings` e o formato de resposta. Menor superfície nova.
  Voyage e Cohere são vendors novos (chave nova, endpoint novo, sem nenhum
  código hoje que já fale com eles).
  Voyage é competitivo em preço e a franquia grátis de 200M tokens da v4 é
  atraente, mas custa "mais um provedor BYOK a cadastrar" sem ganho medido
  sobre OpenAI neste volume.
- NVIDIA NIM é a opção de **custo zero mais simples de ligar hoje**: a chave
  já existe (`NVIDIA_API_KEY`), o padrão BYOK e `redactKey` já existem. O
  único risco é o rate limit de 40 req/min compartilhado com o chat — mas
  como a ADR-001 já proíbe chamar embedding dentro da requisição interativa
  de busca (ver nota abaixo), a indexação é um job assíncrono/lote que pode
  absorver um rate limit apertado com fila e retomada (é literalmente o
  requisito "indexação explícita, retomável, com orçamento").
- Ollama e transformers.js ficam fora da primeira leva porque exigem um
  processo local/servidor que o deploy de produção (Vercel + Supabase) não
  tem hoje — não há onde rodá-los sem criar infraestrutura nova, e o PRD
  explicitamente não exige modelo local na primeira fatia ("Requiring a
  single embedding vendor or shipping a local model in the first slice" está
  em Non-Goals). Continuam válidos para experimentação local/dev.

**Nota de arquitetura (ADR-001, "Implementation Notes"): "Do not call an LLM
in the interactive search request."** Isso significa que a consulta do
usuário não pode ser embedada de forma síncrona dentro do request de busca —
o PRD já descreve os dois lados (vaga e consulta) como "embedded
asynchronously". Quem implementar a tarefa 07 precisa decidir como servir a
ordem semântica sem bloquear a resposta (ex.: embedding da consulta em
segundo plano com reordenação que chega depois, ou cache de consultas
frequentes) — **decisão de implementação, fora do escopo deste documento**,
mas relevante para D1: como a chamada de embedding não está no caminho
crítico de latência da página, a variação de latência entre provedores
(inclusive o free tier da NVIDIA) pesa menos do que pesaria numa chamada
síncrona.

Fontes de preço (consultadas 2026-09-28, revalidar antes de orçar em
produção): [OpenAI — new embedding models](https://openai.com/index/new-embedding-models-and-api-updates/),
[Voyage AI pricing](https://docs.voyageai.com/docs/pricing),
[Cohere Embed v4 pricing](https://cloudprice.net/models/cohere-embed-4),
[NVIDIA NIM free tier](https://docs.avalai.ir/en/news/2025-11-22-nvidia-nim-platform-support-added?id=rate-limits).

## Armazenamento

**Recomendação (D3): pgvector**, coluna `vector(dim)` numa tabela própria de
embeddings (não uma tabela de array float + cálculo de cosseno em
JavaScript).

| | pgvector | Array + cálculo em app |
|---|---|---|
| Onde a similaridade é calculada | No banco, com operadores nativos (`<->`, `<=>`) | Na aplicação, depois de trazer os vetores candidatos pela rede |
| Consistência com o resto do ranking | Igual ao full-text e ao `pg_trgm` — tudo ordena dentro do mesmo SQL (ADR-001) | Cria um segundo caminho de ranking fora do banco, que a ADR-001 não prevê |
| Índice ANN (HNSW/IVFFlat) se um dia for preciso | Disponível nativamente | Não existe; teria que ser reconstruído à mão |
| Espaço no plano Free (500 MB) | Consome espaço junto com o resto do banco (ver cálculo abaixo) | Também consome espaço (é uma coluna a mais), sem ganho — só perde o índice nativo |
| Dependência de extensão | Sim — depende de D4 | Não |

Cálculo de espaço, com o volume medido: um vetor de 1536 dimensões (OpenAI
`text-embedding-3-small`) ocupa 1536 × 4 bytes = 6.144 bytes. Para as 9.060
linhas da tabela `job` local: **≈ 55,7 MB** de dado bruto de vetor, antes de
índice. Um índice HNSW tipicamente soma 1,5×–3× o tamanho dos dados —
estimar **80–170 MB** com índice, dentro do orçamento operacional de 400 MB
que [`supabase-opportunities.md`](../../../docs/engineering/supabase-opportunities.md)
já define como teto de ação (não é o limite do plano, é o teto operacional
proposto). **Não medi o espaço livre atual do banco de produção** — antes de
ligar a indexação em produção, o dono (ou quem executar a tarefa) precisa
conferir o tamanho atual do banco contra esse teto, porque outras tabelas já
disputam os mesmos 500 MB do Free.

Um modelo com menos dimensões (ex. NVIDIA `nv-embedqa-e5-v5`, 1024 dim, ou um
modelo de 384 dim como o exemplo já citado em `local-postgres.md`) reduz esse
espaço proporcionalmente — outro motivo para revisar D1 e D3 juntos.

### Confirmação da extensão `vector`

**Não verificado nesta sessão em produção** (o pedido explicitamente proibiu
usar produção). A evidência disponível é forte, mas indireta:

1. `vector 0.8.2` está instalado e ativo no Postgres local
   (`supabase/postgres:17.6.1.171`), confirmado agora com
   `docker compose -f docker-compose.local.yml exec -T db psql -U supabase_admin -d master_jobs_local -f /docker/verify.sql`.
2. [`local-postgres.md`](../../../docs/engineering/local-postgres.md) documenta
   essa imagem como o mesmo par de versão do Postgres gerenciado de produção
   (`17.6.1.166`), mantido deliberadamente para paridade de extensões.
3. A documentação pública do Supabase (pricing e docs de pgvector, consultada
   nesta sessão) afirma que `vector` vem incluído em **todos os planos,
   inclusive o Free** — sem custo de extensão adicional.

Isso é evidência de alta confiança, não uma leitura direta do projeto
`master-jobs` em produção. **Comando de uma linha para o dono confirmar**
(somente leitura, sem gravação, seguro de rodar):

```sql
select extname, extversion from pg_available_extensions where name = 'vector';
```

Ou, sem terminal: painel do Supabase → Database → Extensions → buscar
`vector`. Se vier vazio ou a extensão não puder ser habilitada no projeto
`master-jobs`, D3 muda para "array + cálculo em app" como plano B documentado
nesta seção, e D1/D2 continuam valendo (o cálculo de custo do provedor não
depende de onde o vetor é guardado).

## Orçamento diário e comportamento ao estourar

Padrão recomendado: reaproveitar o desenho já existente para cota diária por
plataforma (`term_capture`, `platform_quota` — tabela com `window_day`,
`status` incluindo um estado de espera por cota, retomada automática na
próxima janela), em vez de inventar um mecanismo novo (G04: variação real
entra por porta, mas o *padrão* de fila com orçamento diário já existe e não
precisa de uma segunda implementação).

- Um contador diário (em vagas indexadas, chamadas ao provedor, ou
  US$-equivalente — decisão de implementação) é checado antes de cada lote.
- **Estourou o orçamento do dia:** as vagas restantes ficam com status de
  espera (equivalente a `waiting_quota`) e são retomadas na janela seguinte,
  sem intervenção manual. Nada é perdido — é fila persistente, não memória.
- **Nunca desliga a busca.** O comportamento de "vetor ausente" já está
  especificado (regra 14 do PRD, UT-019/UT-020): vaga sem vetor atual —
  porque nunca foi indexada, porque o orçamento estourou, ou porque o modelo
  mudou — cai automaticamente na ordenação lexical/proximidade da tarefa 05,
  sem qualquer menção a "semântica" na explicação. **O orçamento diário só
  controla quantas vagas *novas ou alteradas* recebem vetor por dia; nunca
  controla se a busca funciona.**
- Onde a indexação roda (D5): GitHub Actions via `WorkflowDispatchPort`, o
  mesmo mecanismo já usado por `source_run` para rotinas longas — a Vercel
  corta em fatias de <25 s (ADR 0025) e indexar texto de milhares de vagas
  não cabe nisso. A tela de admin pede a rotina; o Actions executa.
- Métricas/observabilidade: registrar por execução — vagas indexadas, vagas
  em espera de orçamento, falhas por provedor, custo estimado do lote — sem
  guardar o texto da vaga nem a resposta bruta do provedor além do vetor e da
  metadata (modelo, dimensão, `job_id`, timestamps), consistente com o que
  `local-postgres.md` já recomenda para a tabela de embeddings.

## Plano de testes

Os três casos já atribuídos à tarefa 07 em [`_tests.md`](_tests.md)
continuam a base do contrato: **UT-019** (fallback sem vetor), **UT-020**
(vetor de outro modelo/dimensão é tratado como ausente) e **IT-013** (com
vetores presentes, o sinal semântico só reordena; conjunto filtrado idêntico
ao da busca sem vetor).

Este documento é só preparo de decisão — não adiciono IDs novos ao contrato
canônico agora, porque `_tests.md` é compartilhado por toda a iniciativa
#223 e a tarefa 07 continua bloqueada. Os casos abaixo são uma **proposta**
a incorporar em `_tests.md` (numeração seguinte, UT-021+/IT-014+) quando o
dono desbloquear a tarefa e alguém começar a implementação:

- **UT-021** (orçamento): a função pura que decide "processar, esperar cota
  ou pular" nunca deixa passar acima do teto diário configurado; teto
  atingido no meio do lote não interrompe o restante da fila, só marca como
  espera; teto zero equivale a provedor desligado.
- **UT-022** (segredo do provedor de embedding): a chave do provedor nunca
  aparece em erro, log ou linha persistida — mesmo padrão de `UT-003`
  (`secretRef`), aplicado à porta de embedding.
- **IT-014** (retomada): interromper a indexação no meio de um lote (processo
  morto, deploy) e retomar não duplica vetor nem perde vaga — mesma vaga
  processada duas vezes por engano produz um único vetor vigente (idempotência,
  G66).
- **IT-015** (troca de provedor/modelo): trocar o provedor ou modelo
  configurado não apaga vetores antigos, mas eles passam a contar como
  ausentes (reforça UT-020 em nível de integração) até a reindexação alcançá-los;
  a busca nunca quebra nesse meio-tempo.
- **IT-016** (orçamento nunca bloqueia busca): com o orçamento diário
  zerado (provedor "desligado" por cota), uma busca com termo continua
  devolvendo o mesmo conjunto e a mesma ordem da tarefa 05 — reforça IT-013
  no cenário de estouro, não só no cenário "sem vetor gerado ainda".
- **Arquitetura** (reforço, não caso novo): estender
  `tests/architecture.test.ts` para confirmar que nenhuma rota de busca
  interativa (`app/jobs` ou equivalente) importa o adapter HTTP do provedor
  de embedding diretamente — só a composição da indexação em lote pode; a
  leitura da consulta usa vetor já persistido, nunca chama o provedor dentro
  do request (ADR-001, "Do not call an LLM in the interactive search
  request").

## Plano de rollout (atrás de flag)

1. **Porta + admin only, desligado por padrão.** `EmbeddingPort` novo em
   `src/core/embedding/` (mesma forma de `src/core/llm/`: `port.ts`,
   `providers.ts`, `registry.ts`), com o provedor de D1 como primeiro
   adapter. Flag de ambiente `SEMANTIC_SEARCH_ENABLED` (convenção do projeto:
   `SUPABASE_CRAWL_ENABLED`, `JHO_AUTH_MODE`) — ausente ou `false` em todo
   ambiente até decisão explícita de ligar. Config de provedor/modelo/orçamento
   fica em tabela administrada (`embedding_provider`/`embedding_model`,
   espelhando `llm_provider`/`llm_model`), curável por `jho` sem deploy.
2. **Validação local.** Dev/staging remotos não fazem chamada de rede de
   ingestão (regra existente, ADR 0021) — a primeira indexação real só pode
   rodar contra o Postgres local, com amostra pequena, para validar
   idempotência, orçamento e fallback antes de qualquer chamada em produção.
3. **Revisão L2.** Toca schema (tabela de vetores + migration) e ranking de
   busca — entra no nível completo de revisão (regra 19/G53), mesmo não
   tocando o scorer.
4. **Smoke administrado em produção.** Com a flag ligada só para sessão
   admin, orçamento inicial baixo (D2) e lote pequeno (ex.: 50–100 vagas),
   confirmar vetor persistido, busca com e sem termo, e que desligar a flag
   volta exatamente à busca da tarefa 05 (critério de sucesso já definido em
   `task_07.md`: "desligar o provedor não muda nenhum resultado além da
   ordem").
5. **Expansão gradual.** Subir o orçamento e abrir para todas as sessões só
   depois de observar custo e taxa de erro reais por alguns dias — não expor
   para candidato/recrutador no primeiro deploy.

## Referências

- [PRD](_prd.md), seção "5. Optional semantic ordering" e "Open Questions".
- [ADR-001](adrs/adr-001.md) — hybrid search com fallback lexical.
- [`_scope-map.md`](_scope-map.md), seção 5.
- [`local-postgres.md`](../../../docs/engineering/local-postgres.md) — paridade
  de extensões com o Supabase gerenciado; seção "pgvector sem inflar o
  catálogo".
- [`supabase-opportunities.md`](../../../docs/engineering/supabase-opportunities.md) —
  orçamento de espaço do plano Free e decisão anterior de adiar pgvector até
  necessidade medida.
- [ADR 0025](../../../docs/adr/0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md) —
  por que rotina longa roda no GitHub Actions, não na Vercel.
- `src/core/llm/registry.ts`, `src/core/llm/providers.ts`, `src/core/llm/port.ts` —
  padrão BYOK a espelhar no `EmbeddingPort`.
