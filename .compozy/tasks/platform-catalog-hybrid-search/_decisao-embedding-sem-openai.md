# Decisão: ordenação semântica sem OpenAI (issue #370)

Refs #370. Substitui, só para D1, a recomendação de OpenAI em
[`_techspec-task07.md`](_techspec-task07.md#decisões-do-dono) — o dono decidiu
em 29/09/2026 **não usar chave da OpenAI** para esta tarefa. As demais
decisões (D2 orçamento, D3 armazenamento, D4 confirmação de `vector`, D5 onde
a indexação roda) continuam como estão lá; este documento só refaz D1 (provedor)
com evidência nova e adiciona uma leitura de escopo (ver
["O que a reordenação semântica não resolve"](#o-que-a-reordenação-semântica-não-resolve-mesmo-com-o-melhor-provedor))
que pode mudar a prioridade da tarefa inteira. **Não decide** — as caixas
abaixo são do dono. Tarefa 07 continua bloqueada até isso.

## Decisões do dono

| # | Decisão | Recomendação deste documento | Owner decide |
|---|---|---|---|
| D1 | Provedor de embedding padrão, sem OpenAI | **Modelo local via `transformers.js`/ONNX** (`multilingual-e5-small`, quantizado), rodando no GitHub Actions do indexador (D5), como primeiro adapter do `EmbeddingPort`. NVIDIA NIM cadastrado como segundo adapter, documentado, não ligado por padrão — ver [Recomendação](#recomendação). | [ ] |
| D1b | Vale a pena construir a reordenação semântica agora, com qualquer provedor? | Ver [achado sobre o filtro whole-word](#o-que-a-reordenação-semântica-não-resolve-mesmo-com-o-melhor-provedor) antes de decidir D1: sob a arquitetura atual (ADR-001, regra 12 do PRD), a reordenação semântica **não pode trazer vaga que a consulta em pt-BR não encontrou primeiro por texto**. Se o problema real é "candidato busca em português e a vaga está em inglês", a correção mais barata é um dicionário de sinônimos bilíngue no parser da consulta (determinístico, sem provedor, sem vetor), não a tarefa 07 como está hoje. Recomendo revisitar isso antes de destravar D1/D2/D3/D5. | [ ] |
| D2 | Orçamento diário de indexação | Sem mudança — US$ 0,50/dia continua sem sentido como teto de **dinheiro** se o provedor escolhido é gratuito (NIM e modelo local custam US$ 0). Vira um teto de **tempo de execução** ou **vagas processadas por lote**, não de custo. Ver [Custo mensal](#custo-mensal). | [ ] |
| D3 | Armazenamento do vetor | Sem mudança: **pgvector**. Com o modelo local recomendado (384 dimensões, contra as 1536 do OpenAI), o espaço ocupado cai de ~56 MB para ~13–14 MB de dado bruto nas 9.060 vagas locais — ver [Espaço](#espaço-pgvector-recalculado-para-384-dimensões). | [ ] |
| D4 | `vector` no Supabase de produção | Sem mudança — ainda não confirmado em produção nesta sessão (regra do pedido: nada em produção). Comando de leitura em [`_techspec-task07.md`](_techspec-task07.md#confirmação-da-extensão-vector). | [ ] A confirmar pelo dono |
| D5 | Onde a indexação roda | Sem mudança: **GitHub Actions**. Confirmado nesta sessão que o repositório é público (`gh repo view` → `PUBLIC`), então minutos de Actions em runner padrão são gratuitos e ilimitados para este provedor — reforça D1 (nenhum provedor pago, nenhuma fatura de compute). | [ ] |

## Por que este documento existe

A tarefa 07 (`.compozy/tasks/platform-catalog-hybrid-search/task_07.md`)
ficou bloqueada em 28/09/2026 porque a recomendação original de D1
(`_techspec-task07.md`) era OpenAI `text-embedding-3-small`. Em 29/09/2026 o
dono separou essa decisão na issue #370 e vetou explicitamente OpenAI. Este
documento é só a comparação pedida — **nenhum código de produto muda aqui** —
entre NVIDIA NIM, modelo local (transformers.js/ONNX), melhoria lexical sem
vetor, e pgvector vs. sem armazenamento vetorial. As restrições que não mudam,
citadas na issue: a reordenação semântica só reordena, nunca filtra (A4,
regra 12); o scorer fica intocado (G11); e o orçamento de indexação precisa
de desligamento seguro (nunca bloqueia a busca).

**Volume de referência** (mesmo snapshot local citado em
`_techspec-task07.md`, reconferido nesta sessão via
`docker compose -f docker-compose.local.yml exec -T db psql`): 9.060 vagas na
tabela `job`, 5.576 abertas. Não é volume de produção.

## O que a reordenação semântica não resolve, mesmo com o melhor provedor

Antes de comparar provedores, um achado de arquitetura que pesa mais que
qualquer um deles.

O ADR-001 (emenda de 2026-09-18) e a regra 12 do PRD são explícitos: **o
filtro whole-word da consulta decide o conjunto**; full-text, trigrama e
vetor só reordenam ou populam um grupo separado — "nunca adicionam nem
removem [vaga] do conjunto filtrado". Isso está reforçado em
`_scope-map.md` linha 76 ("a busca sem vetor é completa por contrato") e é
testado por IT-013 (`_tests.md`).

Na prática: se um candidato busca **"engenheiro de inteligência artificial
aplicada"** (pt-BR) e a vaga está anunciada em inglês como **"AI Engineer"**,
sem nenhum termo em comum além de palavras genéricas, o filtro whole-word
**não devolve essa vaga** — e a reordenação semântica nunca chega a rodar
sobre ela, porque ela nunca entrou no conjunto. Confirmei isso lendo o
mecanismo (`nearMatchesQuery`/`queryCondition` em `src/core/db/repo.ts`, o
grupo de termos parecidos do task_05 também exige que a vaga passe pelos
filtros e só ajuda com grafia próxima via `pg_trgm`, não com sinônimo ou
tradução) — não executei a query, só confirmei a lógica.

Para confirmar que o modelo de embedding *entende* essa relação (mesmo que a
arquitetura hoje não deixe isso virar resultado), rodei um teste de
qualidade nesta sessão com o modelo local recomendado, sobre vagas reais do
catálogo local (ver [detalhe abaixo](#teste-de-qualidade-cross-lingual-pt-br--en)):
a consulta em português "vaga remota para engenheiro de inteligência
artificial aplicada" ficou **mais similar** a "Staff Applied AI Engineer" e
"AI Engineer" (cosseno 0,847 e 0,842) do que a "Head of Finance" (0,820) — o
modelo capta o sentido corretamente. Mas essa vaga só apareceria na tela hoje
se o texto dela também contivesse alguma palavra literal da consulta —
o que uma vaga em inglês normalmente não tem.

**Consequência para a decisão:** se o objetivo real por trás da #370/#223 é
"candidato busca em português e encontra vaga cujo anúncio está em inglês (ou
usa sinônimo)", a tarefa 07 como está especificada **não entrega isso**,
independente do provedor de embedding escolhido — porque ela só reordena
dentro do conjunto que o filtro léxico já decidiu. Resolver isso exigiria
mudar o próprio filtro da consulta (expandir com sinônimos/tradução antes do
whole-word, ou trocar o desenho para "vetor também amplia o conjunto" — que o
ADR-001 rejeitou deliberadamente como "Alternative 1", por risco de vaga
inelegível subir no ranking). Um dicionário de sinônimos bilíngue determinístico
no `parseQuery` (`src/core/term.ts`) é mais barato, mais seguro (sem vetor, sem
provedor, sem custo) e ataca esse problema específico direto na causa — ver
[opção (c)](#c-alternativa-sem-vetor-melhoria-lexical). Se o objetivo é mais
estreito — "entre vagas que já compartilham vocabulário com a consulta,
ordenar as mais relevantes primeiro, refinando o que o trigrama já faz" —, a
reordenação semântica ainda entrega valor, só que um valor mais modesto do que
"busca semântica" costuma prometer, e a escolha de provedor entre os três
abaixo passa a ser sobre custo/operação/privacidade, não sobre qual entende
melhor sinônimo cross-lingual (nenhum vai adiantar isso enquanto o filtro for
whole-word).

## (a) NVIDIA NIM

| | Detalhe |
|---|---|
| Modelos de embedding | `nvidia/nv-embedqa-e5-v5` (1024 dim) ou `llama-3.2-nv-embedqa-1b-v2`, documentados em `_techspec-task07.md` |
| Preço | Gratuito no free tier do NVIDIA Developer Program |
| Limite do plano gratuito | ~40 requisições/min, **compartilhado** com os modelos de chat já cadastrados (`src/core/llm/registry.ts`, slug `nvidia`) |
| Dimensão | 1024 (e5-v5) |
| pt-BR | Não testado nesta sessão (ver abaixo); modelo multilíngue por descrição do fabricante, sem benchmark próprio medido aqui |
| Onde roda | Chamada de rede a `integrate.api.nvidia.com`, de dentro do job do GitHub Actions (nunca no request interativo, ADR-001) |
| Privacidade | Texto da vaga (público, não é CV nem dado de candidato) sai da máquina para a NVIDIA a cada chamada |

**Chave já configurada localmente.** `NVIDIA_API_KEY` está cadastrada no
projeto e em uso real: o QA de 28/09/2026
(`docs/qa/reports/2026-09-28-qa-223-catch-up.md`) confirma um provedor NVIDIA
NIM (Kimi K2) configurado e testado para análise estruturada de vaga — a
única tentativa terminou em `provider_error`, o que é um dado sobre aquele
endpoint de chat, não sobre o endpoint de embedding (nunca testado).

**Por que não chamei o endpoint de embedding da NVIDIA nesta sessão.** O
pedido autorizava uma chamada de teste mínima "se houver chave local e custo
zero comprovado". A chave existe (confirmado acima) e o custo do free tier é
documentado como zero, mas ler o valor da chave exige abrir `.env`/`.env.local`
— e o harness desta sessão nega explicitamente leitura desses arquivos (`grep`
em `.env*` foi recusado duas vezes nesta sessão, incluindo uma vez sem nenhuma
outra ação junto). Não tentei contornar essa negação (ex.: escrever um script
que lê `process.env.NVIDIA_API_KEY` via o próprio código do projeto) porque
isso teria exigido escrever código de produto novo (`EmbeddingPort`) fora do
escopo — este documento é só decisão, "nenhum código de produto muda"
(mesma regra que `_techspec-task07.md` já declara). **Resultado: dimensão,
latência real e qualidade pt-BR/en do endpoint de embedding da NVIDIA NIM
continuam não verificados nesta sessão** — o que está na tabela acima vem só
da documentação pública/já citada em `_techspec-task07.md`.

**Risco operacional medido por raciocínio, não por teste:** a ~40 req/min
(se 1 vaga = 1 requisição), o backfill de 5.576 vagas abertas levaria **no
mínimo ~2h20** de execução serial só por limite de taxa — bem mais que o
modelo local (minutos, ver abaixo). Não sei se o endpoint aceita lote (várias
vagas por requisição), o que reduziria isso; não testei.

## (b) Modelo local (transformers.js/ONNX)

Benchmark real, rodado nesta sessão contra o **catálogo local** (não
produção): 120 vagas abertas reais, extraídas com
`docker compose -f docker-compose.local.yml exec -T db psql` (`title` +
`description_text`, sem nenhuma escrita, sem tocar produção), embutidas com
`@xenova/transformers` (npm, instalado **fora do repositório**, num projeto
descartável no scratchpad da sessão — não entrou em `package.json` nem em
`pnpm-lock.yaml` do master-jobs) e o modelo
`Xenova/multilingual-e5-small` (porta ONNX quantizada de
`intfloat/multilingual-e5-small`, 384 dimensões, suporta ~100 idiomas
incluindo português).

### Medição de desempenho

Máquina local (14 núcleos), sem GPU, execução serial, uma vaga por vez:

| Métrica | Valor medido |
|---|---|
| Amostra | 120 vagas reais (catálogo local aberto) |
| Tamanho do modelo (ONNX quantizado, int8) | 112,8 MB em disco |
| Cold start (carregar o modelo) | 6.517 ms (uma vez por processo) |
| Média por vaga | 65,7 ms |
| p50 por vaga | 64,2 ms |
| p95 por vaga | 98,2 ms |
| Extrapolado para 1.000 vagas (serial, sem cold start) | **65,7 s** |
| Extrapolado para 5.576 vagas — catálogo aberto local inteiro (serial) | **366 s (~6,1 min)** |

Isso é uma máquina de desenvolvedor, não um runner do GitHub Actions —
runners padrão (`ubuntu-latest`) têm 2 vCPU e tendem a ser mais lentos por
thread; o número real em CI deve ser maior, mas a ordem de grandeza (minutos,
não horas) deve se manter, e o processamento pode ser paralelizado em
lotes/workers dentro do job sem depender de rate limit de terceiro. Não medi
isso rodando de fato no Actions.

### Teste de qualidade cross-lingual (pt-BR → en)

Sobre a mesma amostra, com o prefixo `query:`/`passage:` que o e5 exige,
comparei 3 consultas em português contra 6 vagas reais (`AI Engineer`, `Staff
Applied AI Engineer`, `Head of Finance`, `Senior Python Engineer - LLM Code
Evaluation`, `Senior Engineer`, `Senior Data Engineer`) por similaridade de
cosseno:

| Consulta (pt-BR) | Top-1 (cosseno) | Vaga menos similar do grupo |
|---|---|---|
| "vaga remota para engenheiro de inteligência artificial aplicada" | Staff Applied AI Engineer (0,8473) | Head of Finance (0,8204) |
| "procuro posição de liderança em finanças e contabilidade" | Head of Finance (0,8138) | Senior Data Engineer (0,7669) |
| "engenheiro backend Python sênior remoto Brasil" | Senior Python Engineer - LLM Code Evaluation (0,8340) | Head of Finance (0,8131) |

Em todas as três consultas, o modelo ordenou corretamente a vaga mais
relacionada em primeiro — inclusive cross-lingual, sem nenhuma palavra em
comum entre a consulta em português e o texto da vaga em inglês. **Limite
honesto:** a faixa de similaridade é estreita (0,77–0,85 em todos os pares,
inclusive os "errados") — típico de `e5-small`: a direção do ranking está
certa, mas o score absoluto não separa bem "muito relacionado" de "nada
relacionado". Isso é consistente com o desenho já decidido (ADR-001): vetor
serve para **reordenar**, não para decidir corte/relevância absoluta — um
score que varia pouco é adequado para reordenar, arriscado para qualquer uso
que dependesse de um limiar fixo.

Script e amostra ficam no scratchpad da sessão (fora do repositório), não
comitados — reprodutível com o mesmo `psql` acima e
`npm install @xenova/transformers` num diretório qualquer.

### Custo de dependência (achado operacional, não só teórico)

`_techspec-task07.md` já apontava, por raciocínio, que um modelo local "pesa
mais" no adapter magro (G05) do que uma chamada HTTP. Medi isso agora:

- `npm install @xenova/transformers` sozinho baixa **390 MB** de
  `node_modules` (ONNX runtime nativo pré-compilado por plataforma,
  `sharp` para pré-processamento de imagem — não usado para texto,
  protobuf, etc.).
- `npm audit` nessa árvore reporta **5 vulnerabilidades (4 altas, 1
  crítica)**, todas em dependências transitivas (`protobufjs`, `sharp`/
  `libvips`) do `onnxruntime-web`/`onnx-proto`, não do código do próprio
  pacote.
- O sucessor oficial, `@huggingface/transformers`, tem a mesma forma de
  dependência (`sharp`, `onnxruntime-web`, `onnxruntime-node`) — o problema
  não é o pacote específico, é a categoria (runtime ONNX + pré-processamento
  de imagem que este produto não precisa).
- Nada disso tocaria o `EmbeddingPort` em si (que ficaria fino, como os
  outros adapters), mas o **adapter concreto** do modelo local carrega essa
  árvore de dependência inteira só para gerar um vetor de texto — o oposto do
  "adapter burro" que G04/G05 pedem. Isso pesa contra o modelo local **como
  runtime da aplicação principal**, mas pesa menos contra ele **isolado num
  job do GitHub Actions** dedicado à indexação, que não compartilha bundle,
  cold start nem superfície de ataque com o Next.js de produção — é
  exatamente esse isolamento que a recomendação de D1 depende.

## (c) Alternativa sem vetor (melhoria lexical)

O que já existe (não é teórico — está em produção via task_05, #214, e no
benchmark de `docs/engineering/performance-buscas.md`):

- **Filtro whole-word** (`~*` de palavra inteira) em título, empresa e
  descrição — é quem decide o conjunto hoje, e continua sendo quem decide
  mesmo depois de qualquer vetor (ADR-001 A4).
- **`pg_trgm`** já em produção em duas frentes: um índice de pré-filtro sobre
  a descrição (`job_description_trgm_idx`, medido em 34,9–35,1 ms contra
  143,9–160,7 ms sem índice, no acervo local real) e um grupo separado
  "termos parecidos" por `word_similarity()` sobre o título
  (`job_title_trgm_idx`, limiar 0,6 calibrado em fixture) — tolera erro de
  digitação e grafia próxima ("kubernets" → "Kubernetes Engineer").

O que foi avaliado e **descartado**, com motivo documentado em
`docs/engineering/performance-buscas.md` (medição de 22/09/2026), não nesta
sessão:

- **`tsvector`/`ts_rank`**: mudaria a semântica de casamento (radical,
  tokenização) para uma diferente do contrato whole-word atual — rejeitado,
  não por custo, por mudar o que "casar" significa.
- **`unaccent`**: "o contrato atual não dobra acento" — rejeitado porque o
  produto decidiu que acento importa para o casamento, não por limite
  técnico.

O que **não existe e é o candidato real de melhoria lexical**: um dicionário
de sinônimos/tradução determinístico no `parseQuery` (`src/core/term.ts`) —
ex.: "engenheiro" ↔ "engineer", "remoto" ↔ "remote", "dados" ↔ "data". Isso é
exatamente o tipo de variação que caberia numa porta pequena (lista
YAML/JSON curada, sem rede, sem LLM, sem custo, testável exaustivamente) e
ataca direto o problema cross-lingual que a seção anterior mostrou que o
vetor **não** resolve sob a arquitetura atual (porque o vetor não amplia o
conjunto filtrado, e um sinônimo no filtro sim).

**A alternativa lexical já atende o objetivo?** Depende de qual objetivo:

- Tolerar erro de digitação/grafia próxima: **sim**, já entregue (trigrama).
- Encontrar vaga com sinônimo ou em outro idioma que a consulta não usa
  literalmente: **não**, e um dicionário de sinônimos resolveria isso mais
  direto e mais barato do que qualquer embedding, sem os riscos de operação
  (provedor, chave, orçamento, drift de modelo) descritos nas outras opções.
- Refinar a ordem dentro de um conjunto que várias vagas já casam
  literalmente (ex.: 50 vagas contêm "engenheiro", qual é "mais sobre" o que
  o candidato quer): **parcialmente** — é a única lacuna real que sobra para
  o vetor, porque nem trigrama nem sinônimo reordenam por relevância
  semântica dentro de um conjunto já homogêneo lexicalmente.

## (d) pgvector vs. sem armazenamento vetorial

Sem mudança na recomendação de `_techspec-task07.md` (D3: pgvector, não
array + cálculo em app) — os motivos continuam válidos: cálculo dentro do
mesmo SQL que já ordena por full-text/trigrama (consistente com ADR-001),
índice ANN nativo se um dia for preciso, sem segundo caminho de ranking fora
do banco. O que muda com o provedor:

### Espaço (pgvector recalculado para 384 dimensões)

`_techspec-task07.md` calculou o espaço assumindo OpenAI (1536 dim): ~55,7 MB
brutos para as 9.060 vagas locais, 80–170 MB com índice HNSW. Com
`multilingual-e5-small` (384 dim, recomendação deste documento):

- 384 × 4 bytes = 1.536 bytes/vetor.
- 9.060 vagas × 1.536 bytes ≈ **13,9 MB** de dado bruto de vetor — um quarto
  do OpenAI.
- Com índice HNSW (1,5×–3×): estimar **21–42 MB** — dentro do teto
  operacional de 400 MB de `supabase-opportunities.md` com bem mais margem.
- NVIDIA `nv-embedqa-e5-v5` (1024 dim) ficaria no meio: 1024×4×9.060 ≈
  37,1 MB brutos, 56–111 MB com índice.

Nenhum destes números foi medido em produção — são cálculo sobre o volume
local, como no documento original.

### Sem armazenamento vetorial (opção "não fazer" para D3)

Se D4 (confirmação de `vector` em produção) vier negativa, a alternativa já
documentada em `_techspec-task07.md` é "array + cálculo em app" como plano B
— este documento não muda essa análise. Uma terceira opção, não escrita
antes: **não guardar vetor nenhum e não fazer reordenação semântica agora**,
ficando só com (c). Dado o achado da seção anterior (o vetor não amplia o
conjunto, só reordena dentro dele) e o princípio do produto ("o gargalo é a
decisão, não a descoberta" — `docs/product/vision.md`), essa é uma opção
legítima, não uma recusa de fazer o trabalho: adicionar embedding, provedor,
orçamento, retomada e um `EmbeddingPort` inteiro para "refinar a ordem dentro
de um conjunto que já casa literalmente" é bastante infraestrutura para o
ganho mais estreito que sobrou depois do achado acima.

## Custo mensal

| Opção | Custo de API | Custo de compute | Custo de storage (pgvector) |
|---|---|---|---|
| NVIDIA NIM | US$ 0 (free tier) | US$ 0 (GitHub Actions, repositório público) | ~56–111 MB (1024 dim) |
| Modelo local (transformers.js) | US$ 0 | US$ 0 (GitHub Actions, repositório público) | ~21–42 MB (384 dim) |
| Lexical melhorada (sinônimos) | US$ 0 | Desprezível (roda na mesma consulta SQL) | 0 (sem vetor) |
| Sem reordenação semântica agora | US$ 0 | US$ 0 | 0 |
| *(Descartado pelo dono)* OpenAI `text-embedding-3-small` | ~US$ 0,16 para reindexar o catálogo aberto local inteiro uma vez | US$ 0 | ~56–170 MB (1536 dim) |

Com repositório público confirmado nesta sessão (`gh repo view` →
`visibility: PUBLIC`), minutos de GitHub Actions em runner padrão são
gratuitos e ilimitados para qualquer uma das opções de compute — o "orçamento
diário" de D2 deixa de ser sobre dinheiro e passa a ser sobre **tempo de
execução por lote** ou **vagas processadas por dia**, o que já é o desenho
que `_techspec-task07.md` propõe (contador diário, fila com estado de espera
por cota).

## Privacidade

| Opção | Dado sai da máquina? |
|---|---|
| NVIDIA NIM | Sim — texto da vaga (público, sem PII de candidato) vai para `integrate.api.nvidia.com` a cada indexação |
| Modelo local (transformers.js) | Não — inferência inteira dentro do runner do GitHub Actions (ou da máquina que rodar o indexador); só o modelo (pesos públicos) entra, nada de dado da vaga sai |
| Lexical melhorada | Não — tudo dentro do Postgres |
| Sem reordenação semântica | Não se aplica |

Nenhuma opção lida com CV nem dado de candidato — o texto embutido é sempre
texto de vaga (público). Ainda assim, "nada sai da máquina" é a opção mais
protetora e a mais alinhada ao espírito da regra 1 (não adquirir/expor dado
por API não oficial) e da regra 16 (chave nunca vai para banco/log) —
modelo local elimina até a necessidade de gerir mais uma chave.

## Manutenção

| Opção | O que precisa ser mantido |
|---|---|
| NVIDIA NIM | Chave (`NVIDIA_API_KEY`, já existe), monitorar rate limit compartilhado com chat, revalidar free tier periodicamente (times de provedor mudam limite sem aviso, como o próprio `_techspec-task07.md` já alerta) |
| Modelo local | Fixar versão do modelo e do pacote (`transformers.js`/ONNX), revalidar `npm audit` da árvore de dependência periodicamente, cache do modelo (112,8 MB) no workflow do GitHub Actions para não baixar de novo em toda execução |
| Lexical melhorada | Curar e revisar a lista de sinônimos como qualquer outro arquivo editado à mão (G67 — validação Zod na carga, sem segredo) |
| Sem reordenação semântica | Nenhuma manutenção nova |

## Recomendação

1. **Não descartar a opção de não construir isso agora.** O achado da seção
   ["O que a reordenação semântica não resolve"](#o-que-a-reordenação-semântica-não-resolve-mesmo-com-o-melhor-provedor)
   é o ponto mais importante deste documento: sob a arquitetura já decidida
   (ADR-001), nenhum provedor de embedding faz a consulta em português achar
   uma vaga só em inglês — isso é o filtro da consulta, não o provedor. Se
   esse é o problema que motivou a #223/#370, um dicionário de sinônimos
   bilíngue em `src/core/term.ts` entrega mais, mais rápido, sem provedor, sem
   vetor, sem orçamento — e não fecha a porta para a tarefa 07 depois.
2. **Se o dono decidir seguir com a tarefa 07** (para o ganho mais estreito
   de reordenar dentro de um conjunto já lexicalmente casado): **modelo local
   (`transformers.js`/ONNX, `multilingual-e5-small`) rodando isolado no job
   de indexação do GitHub Actions**, não NVIDIA NIM como padrão. Motivos, em
   ordem:
   - Sem rate limit de terceiro — o backfill mede minutos, não horas (NIM em
     ~40 req/min levaria ≥2h20 só de espera, não testado se aceita lote).
   - Nada sai da máquina — mais protetor que qualquer API, sem chave nova
     para gerir.
   - Dimensão menor (384) custa um quarto do espaço de pgvector que o
     cálculo original (1536, OpenAI) previa — mais margem no teto de 400 MB.
   - O peso de dependência (390 MB, 5 vulnerabilidades transitivas) é real,
     mas fica **isolado no job de indexação**, que já é um processo separado
     do Next.js de produção — não entra no bundle interativo, não é chamado
     no request de busca (ADR-001 já proíbe isso para qualquer provedor).
   - NIM continua cadastrado como segundo adapter (a porta já prevê
     alternativa plausível, G04) — útil se o modelo local se mostrar lento
     ou de baixa qualidade em produção; a troca de provedor já está no plano
     de testes (IT-015).
3. **pgvector, não array + cálculo em app** (D3, sem mudança) — condicionado
   a D4 (confirmar `vector` em produção, ainda não lido nesta sessão).
4. **Antes de destravar D1–D5**, decidir D1b: revisitar com o dono se o
   objetivo é "refinar ordem" (tarefa 07 entrega isso) ou "achar vaga que a
   busca de hoje não acha" (tarefa 07 não entrega isso; sinônimo bilíngue
   entrega).

## O que não foi testado nesta sessão

Para não relatar mais do que foi verificado:

- **Chamada real ao endpoint de embedding da NVIDIA NIM** — não feita
  (acesso a `.env`/`.env.local` para ler a chave foi negado pelo harness
  desta sessão; ver [seção (a)](#a-nvidia-nim)). Latência, dimensão real
  devolvida e qualidade pt-BR/en desse endpoint continuam vindas só de
  documentação pública, não de teste próprio.
- **`bge-m3`** e outros modelos locais maiores — citados por especificação
  pública (BAAI, ~1024 dim, ~2,2 GB em fp32, contexto até 8192 tokens,
  cobertura de 100+ idiomas), não baixados nem medidos nesta sessão (peso e
  tempo de download tornariam o benchmark desproporcional ao escopo de um
  documento de decisão).
- **Tempo real de execução no GitHub Actions** — só medido na máquina local
  de 14 núcleos usada nesta sessão; o número em `ubuntu-latest` (2 vCPU) não
  foi medido.
- **Volume/latência de produção** — todo número de espaço/tempo aqui vem do
  catálogo local (9.060 vagas, 5.576 abertas), não de produção.

## Referências

- Issue [#370](https://github.com/andreustimm/master-jobs/issues/370),
  [#223](https://github.com/andreustimm/master-jobs/issues/223).
- [`task_07.md`](task_07.md), [`_techspec-task07.md`](_techspec-task07.md),
  [`_scope-map.md`](_scope-map.md), [`_tests.md`](_tests.md) (US-020,
  UT-019–020, IT-013).
- [ADR-001](adrs/adr-001.md) (hybrid search, emenda A4).
- [`_prd.md`](_prd.md), seção "5. Optional semantic ordering" e regras 12–16.
- `docs/engineering/performance-buscas.md` (medição de 22/09/2026 —
  `tsvector`/`unaccent` descartados; `pg_trgm` em produção).
- `docs/engineering/local-postgres.md`, `docs/engineering/supabase-opportunities.md`.
- `docs/product/vision.md` ("o gargalo é a decisão, não a descoberta").
- `docs/qa/reports/2026-09-28-qa-223-catch-up.md` (NVIDIA NIM em uso real
  para análise estruturada, evidência de chave configurada).
- `src/core/llm/registry.ts`, `src/core/db/repo.ts`, `src/core/term.ts`
  (mecanismo whole-word/trigrama atual).
- Modelo testado: [Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small)
  (porta ONNX de [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)).
