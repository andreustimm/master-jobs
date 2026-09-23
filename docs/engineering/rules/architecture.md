# Regras de arquitetura e runtime

Referência normativa do domínio de arquitetura. Resumo crítico em
[AGENTS.md](../../../AGENTS.md); índice e procedimento de conflito em
[README.md](README.md). O estado atual do sistema — camadas, fluxo e mapa de
arquivos — está em [architecture.md](../../architecture.md) e no
[mapa de contextos](../context-map.md); aqui fica só o que obriga.

---

<a id="g04"></a>
## G04 — Variação real entra por porta (regra 4)

**Obrigação.** O sistema é feito para receber módulos: fontes, filas,
provedores de LLM, armazenamento. Onde há troca previsível (provedor, serviço,
board), a variação é uma **porta** com adapter, nunca uma chamada direta
espalhada pelo código.

| Porta | Variação que ela absorve |
|---|---|
| `SourceAdapter` | cada board, ATS e career page |
| `QueuePort` | tabela hoje, Upstash quando for para a web (ADR 0009) |
| `LlmPort` | Anthropic, OpenAI, o que vier — BYOK |
| `SkillCatalogPort` · `CandidateSkillPort` · `TargetCorpusPort` | contexto de skills (ADR 0007) |

**Quando NÃO criar.** Só onde a variação é real. Porta com uma implementação e
nenhuma alternativa plausível é cerimônia — a
[ADR 0007](../../adr/0007-arquitetura-hexagonal-monolito-modular.md) rejeita
isso explicitamente.

**Estrutura de contexto novo** (espelhe `src/contexts/skills/`):

```
domain/     puro — tipos e regras
ports.ts    só as portas com variação real
app/        casos de uso, orquestração burra
infra/      o único lugar que conhece SQL ou HTTP
index.ts    composição por função, sem container
```

Injeção é composição de função. Container seria ilegal sob G06 (sintaxe
apagável). Antes de criar arquivo novo em `src/`, leia
[MIGRATION.md](../../../MIGRATION.md).

Origem: regra 4. Prova: `tests/architecture.test.ts` (fronteiras e imports dos
contextos).

<a id="g05"></a>
## G05 — Domínio puro; adapter burro

**Obrigação.** A lógica que decide fica em funções puras, sem banco, sem rede,
sem relógio. É o que torna `scoring/`, `skills/domain/` e `analytics/`
testáveis exaustivamente. Adapter é burro: busca, mapeia, devolve. O relógio é
injetável (`src/core/clock.ts`) só onde o tempo é decisão, não carimbo.

**Dívida conhecida (C22).** `score` e `freshness` ainda aceitam instante
implícito (`Date.now()` como default da assinatura legada). O alvo é tempo
explícito no núcleo, capturado na composição, provado com o mesmo `asOf` sob
relógios diferentes — tarefa [#204](https://github.com/andreustimm/master-jobs/issues/204).
Enquanto isso, código novo no domínio não acrescenta default de relógio.

Origem: regra 4. Prova: `tests/architecture.test.ts` (imports proibidos nos
domínios).

<a id="g06"></a>
## G06 — Só sintaxe TypeScript apagável (regra 5)

**Obrigação.** O runtime é o type stripping nativo do Node 24: sem `enum`, sem
parameter properties, sem `namespace`, sem decorators. `erasableSyntaxOnly:
true` no `tsconfig.json`. Se `pnpm jho` estourar
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, é isso.

**Versão suportada.** A fonte é `package.json` (`engines`) e `.nvmrc`; não
copie o número para outros documentos.

Origem: regra 5. Detalhes:
[ADR 0006](../../adr/0006-typescript-apagavel-sem-build-step.md),
[architecture.md](../../architecture.md) ("Node 24 e type stripping nativo").
Prova: `pnpm typecheck` e `tests/architecture.test.ts`.

<a id="g07"></a>
## G07 — Import relativo com extensão `.ts` explícita (regra 5)

**Obrigação.** Imports relativos carregam a extensão `.ts`. Sem build step, o
Node resolve o caminho literal.

Origem: regra 5. Prova: `tests/architecture.test.ts` (forma `from`; imports
dinâmicos e aspas simples são ampliação prevista em
[#204](https://github.com/andreustimm/master-jobs/issues/204)).

<a id="g65"></a>
## G65 — A UI é adaptador, não implementação paralela

**Obrigação.** Server Components e Server Actions chamam as mesmas APIs
públicas que a CLI chama. Nunca duplique query entre as superfícies — coloque-a
atrás da API pública do contexto proprietário.

**Resolve C15.** A transição do funil é centralizada no caso de uso
`setApplicationStatus` (contexto `pursuit`); UI e CLI (`jho track`) são dois
chamadores dele, e uma mudança de status feita no navegador cai em
`application_event` exatamente como uma feita no terminal. A frase antiga "a
única mutação da UI" não descreve o produto atual: há outras mutações
legítimas (conta, candidato, buscas salvas, perfil público), cada uma atrás do
seu contexto e da sua guarda (G39).

Origem: AGENTS ("Arquitetura", invariante da UI). Detalhes:
[architecture.md](../../architecture.md). Prova: `tests/architecture.test.ts`.

<a id="g66"></a>
## G66 — Idempotência e isolamento de falha

**Obrigação.** Tudo idempotente: rodar de novo nunca estraga nada. Erro de uma
fonte não derruba o sync — ele é registrado em `source.lastError` e as demais
seguem. Adapter só busca, mapeia e devolve.

Origem: AGENTS ("Convenções de código"). Prova: `tests/cov-ingest-run.test.ts`,
`tests/source-health.test.ts`.

<a id="g67"></a>
## G67 — Zod valida o que é editado à mão

**Obrigação.** Arquivo editado por pessoa (`profile.yaml`, `sources.yaml` e
outros de configuração manual) é validado por Zod na carga, com erro legível e
sem registrar segredo. Configuração é validada, nunca assumida.

Origem: AGENTS ("Convenções de código"). Detalhes:
[architecture.md](../../architecture.md) ("Configuração validada, nunca
assumida"). Prova: `tests/cov-sources-config.test.ts`, `pnpm jho profile`.

<a id="g78"></a>
## G78 — Composição de leitura respeita o pool

**Obrigação.** A composição de leitura de uma tela vive no módulo de dados da
tela; o fan-out de consultas simultâneas não passa do tamanho do pool menos uma
conexão, e o câmbio é lido uma vez e reutilizado. Nova composição entra no
inventário medido.

Origem: [operations.md](../../operations.md) (invariantes de produção e pool).
Prova: `tests/db-fan-out.test.ts` (pico real nas funções enumeradas; não é
benchmark de carga).

<a id="g82"></a>
## G82 — Comentário explica por quê; código sem cerimônia

**Obrigação.** Comentários explicam **por quê**, não o quê: decisões,
trade-offs e armadilhas ("Greenhouse HTML-escapa o content", "o primeiro item
do RemoteOK é aviso legal", "Jobgether anonimiza o empregador por design").
Adapters ficam simples. É critério de revisão (deslop, deep-review), não lint
automático.

Origem: AGENTS ("Convenções de código").
