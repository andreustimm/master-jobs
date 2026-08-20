# Backlog de remediação arquitetural

Fonte: [auditoria de 19/08/2026](../../.audits/architectural-analysis-2026-08-19.md).

Este é um backlog executável, não uma proposta de reescrever o sistema. A
estratégia é corrigir primeiro ownership e consistência, preservar o monólito
modular e só mover fronteiras quando o movimento remove uma dependência real.

## Estado imediato desta entrega

| Item | Estado |
|---|---|
| Tela/menu Comparar vaga, paste e upload | concluído |
| Score canônico e cobertura do CV | concluído |
| URLs manuais isoladas de vagas ATS | concluído |
| Freshness sem data neutro + scorer 1.3.0 | concluído |
| Guards privados derivados da sessão | concluído |
| `/api/export` valida cookie/sessão na rota | concluído |
| SSRF: IP/DNS/redirects em fetch externo | concluído |
| E2E autenticado de paste/upload/mobile | concluído |

## Progresso da remediação em 20/08/2026

| Tarefa | Estado | Evidência ou pendência |
|---|---|---|
| ARCH-001 | concluída | `application` e seus read models são escopados por `(candidateId, jobId)`; migration e testes usam dois candidatos. |
| ARCH-002 | concluída | `candidate_matching_profile` persiste política/hash por candidato; dois perfis pontuam a mesma vaga de forma independente. |
| ARCH-003 | concluída | Máquina de estados pura, transação de application/event, idempotência, rollback e concorrência cobertos. |
| ARCH-004 | concluída | Aceite de sugestão, candidatura e evento usam uma transação; replay, unmatched e rollback são testados. |
| ARCH-005 | concluída | Documento atual tem unicidade/transação e candidatura referencia ID com FK composta de ownership. |
| ARCH-006 | concluída | Board aplica predicado único antes de paginação; count/facets agregam em SQL e o teste cobre 5.005 vagas. |
| ARCH-007 | concluída | `observeRawJob` é o único caso de uso de sync, manual, import e mail; invalida scores de todos os candidatos quando o conteúdo muda. |
| ARCH-008 | concluída | `ScoringContext` fixa `asOf`, perfil e FX; hash/versão/expiração governam reprocessamento determinístico. |
| ARCH-009 | concluída | `MatchPolicy` e elegibilidade estruturada distinguem eligible/ineligible/unverifiable e validam todos os campos configuráveis. |
| ARCH-010 | concluída | Auth expõe API pública única; SQL/password/session ficam em adapters por portas e fitness tests bloqueiam imports internos. |
| ARCH-011 | concluída | `context-map.md` registra owners, 28 tabelas, APIs e dependências; teste deriva diretórios e contagem do schema. |
| ARCH-012 | concluída | Skills usa catálogo, matcher, portas e API pública únicos; o módulo legado foi removido. |
| ARCH-013 | concluída | UI/CLI consomem APIs públicas de Matching/Pursuit/Correspondence; o schema único fica documentado como composition root de FKs, sem renomear tabelas por estética. |
| ARCH-014 | concluída | Queue port, domínio, casos de uso e adapter Drizzle estão separados e protegidos por fitness test. |
| ARCH-015 | concluída | Kinds buscáveis são exaustivas e separadas de `manual`, com validação compile/runtime. |
| ARCH-016 | concluída | FX tem porta, providers, fallback e store separados no contexto `fx`. |
| ARCH-017 | concluída | `createManualComparison` orquestra validação, extração, observação e score; `ComparisonDetail` elimina parsing de `raw` na UI. |
| ARCH-018 | concluída | Domínio persiste códigos + parâmetros, elegibilidade estruturada e UI/CLI traduzem dinamicamente em pt-BR/en. |
| ARCH-019 | concluída | Renderer de relatório é puro, CLI possui filesystem e Correspondence ganhou API pública ao ser modificada. |
| ARCH-020 | concluída | Exports mortos, binding morto, diretórios vazios e casts inseguros foram removidos; parsers substituem casts de entrada. |
| ARCH-021 | concluída | Migration idempotente remove apenas sessões órfãs; `jho db check` e teste mantêm `foreign_key_check` limpo. |
| ARCH-022 | concluída | `proxy.ts` segue a convenção Next 16 e preserva a dupla barreira de autenticação. |
| ARCH-023 | concluída | `unpdf` permanece server-only/external e o build não reescreve seu `import.meta.resolve`. |
| ARCH-024 | concluída | `pnpm test:e2e` agora possui build, porta, processo e SQLite temporários; o modo externo é explícito. |

Todos os critérios foram encerrados; escolhas deliberadas (schema Drizzle
central e ausência de portas cerimoniais) estão registradas no mapa de
contextos e protegidas por fitness tests.

### Evidência final desta execução

- `pnpm check`: 53 arquivos e 613 testes aprovados;
- `pnpm db:generate`: 28 tabelas, sem drift;
- build de produção Next/Webpack concluída;
- E2E contra build e SQLite isolados: 50/50, incluindo paste, upload, score,
  cobertura do CV, autenticação, inglês e viewport de 375 px;
- `jobs list`, `skills --help` e `pipeline` executados simultaneamente sem
  escrita implícita nem lock após tornar a resolução do candidato read-only;
- migrations 0011–0020 validadas em cópia do banco real e aplicadas após
  backup recuperável `data/jobs.db.pre-architecture-20260820-0807`;
- rescore 1.3.0 concluído nas 5.992 vagas abertas, todas com `profile_hash` e
  razões estruturadas; `jho db check` terminou sem violações.

## Regras de execução

- Cada tarefa termina com testes de caracterização e `pnpm check` verde.
- Mudança de schema usa migration aditiva, backfill verificado e rollback
  documentado; nunca `push` destrutivo em produção.
- Mudança no score exige bump de `SCORER_VERSION` e rescore completo.
- `application` continua inalcançável pela ingestão.
- Não criar container, broker ou porta sem variação concreta.
- `AGENTS.md` e `CLAUDE.md` permanecem espelhados.

## P0 — isolamento e consistência do agregado

### ARCH-001 — Escopar Pursuit por candidato

Objetivo: tornar candidatura e histórico pertencentes ao candidato, não à vaga
global.

Aceite:

- `application.candidateId` obrigatório e FK;
- unicidade composta `(candidateId, jobId)`;
- repos, UI, export, cockpit, pipeline, referrals, analytics e mail recebem ou
  derivam o candidato;
- CLI resolve explicitamente o candidato padrão;
- backfill preserva todas as candidaturas existentes;
- testes com dois owners provam isolamento de leitura e escrita.

### ARCH-002 — Escopar Matching por candidato

Objetivo: representar score como relação candidato–vaga.

Aceite:

- identidade inclui `candidateId`, `jobId` e versão/calibração necessária;
- board, detail, compare e cockpit consultam apenas o score do candidato;
- rescore/backfill preservam a geração atual;
- dois perfis produzem scores independentes para a mesma vaga;
- contrato decide o que permanece em `profile.yaml` e o que é persistido.

### ARCH-003 — Implementar agregado/máquina de estados de Pursuit

Dependência: ARCH-001.

Aceite:

- transições legais são função pura e exaustivamente testada;
- reabertura após rejeição/arquivamento é uma decisão explícita;
- application e event são gravados na mesma transação;
- semântica de `appliedAt` é documentada;
- testes cobrem rollback, concorrência e idempotência.

## P1 — correção de casos de uso e fronteiras

### ARCH-004 — Aceitar sugestão de e-mail atomicamente

Dependência: ARCH-003. Um application service muda Correspondence e Pursuit na
mesma unidade; ausência de match não pode terminar como “aceita”; reexecução é
idempotente e falha faz rollback integral.

### ARCH-005 — Fortalecer documentos do candidato

Dependência: ARCH-001. A troca do documento atual é transacional; constraint
garante um atual por candidato/tipo; candidatura referencia
`candidateDocumentId`, não label; migration/backfill e concorrência têm testes.

### ARCH-006 — Reescrever Board como read model SQL correto

Dependência recomendada: ARCH-001/002. Status e demais filtros ocorrem antes de
pagina/offset; count/facets usam agregação SQL sem teto de 5.000; o mesmo
predicado é compartilhado; testes exercitam mais de 5.000 linhas, `unfiled`,
status e offsets.

### ARCH-007 — Unificar observação/upsert de vaga

Um caso de uso retorna `inserted | unchanged | changed | reopened`; sync,
manual, arquivo e mail usam o contrato; company, `applyUrl` e invalidação de
score deixam de divergir; cada canal ganha teste de caracterização.

### ARCH-008 — Tornar o score temporalmente determinístico

`ScoringContext` recebe `asOf`, perfil e FX; regras não chamam `Date.now()`;
há política de expiração/reprocessamento de freshness; relógio fixo prova
reprodutibilidade; bump de versão se o resultado mudar.

### ARCH-009 — Implementar MatchPolicy/elegibilidade estruturada

Dependências: ARCH-002/008. Todo campo configurável é consumido ou removido;
resultado distingue `eligible | ineligible | unverifiable`; ausência permanece
neutra; Zod valida pisos/targets/referências; testes cobrem autorização de
trabalho, sponsorship, região, timezone e contrato.

### ARCH-010 — Fechar a fronteira hexagonal de Auth

UI importa somente API pública; SQL/Drizzle ficam em infra; resolver sessão é
somente leitura; sync de candidato vira comando explícito; duração de sessão
tem uma fonte; fitness test proíbe imports de `auth/infra` fora do contexto.

### ARCH-011 — Rebaselinar migração e documentação

Publicar matriz por contexto com aggregate owner, tabelas, API e dependências;
dar um único estado a `MIGRATION.md`; atualizar architecture/data-model/
AGENTS/CLAUDE para 28 tabelas, UI e auth atuais; automatizar versões/inventários
estáveis.

### ARCH-012 — Concluir o strangler de Skills

Catálogo, auditoria e demanda passam pela API do contexto; um matcher define
normalização/boundary; tipos têm fonte única; pesos são usados ou removidos;
`src/core/skills.ts` é apagado só depois da migração integral.

## P2 — modularidade e contratos

### ARCH-013 — Modularizar CLI, schema e read models por vertical

Dependências: ARCH-011 e migrations anteriores. Root da CLI compõe módulos de
comando; comandos não fazem SQL; schemas separam-se por contexto e são
reexportados; Board/Cockpit/Pursuit deixam o repositório genérico; nenhuma
tabela é renomeada por estética.

### ARCH-014 — Separar Queue port, adapter e casos de uso

Status/porta são puros; não importam Drizzle/schema; adapter vai para infra;
fitness test detecta contratos de porta sem depender do nome do arquivo.

### ARCH-015 — Tornar o registry de fontes exaustivo

Separar `FetchableSourceKind` de fontes manuais; registry usa
`satisfies Record<FetchableSourceKind, SourceAdapter>`; config não aceita kind
sem adapter; testes compile/runtime percorrem todas as kinds.

### ARCH-016 — Extrair `FxRateProvider`

Porta pura, adapters Frankfurter/ER separados, application service controla
fallback, cache/store não pertence ao provider e fixtures cobrem indisponibilidade
parcial.

### ARCH-017 — Criar application service/read model da comparação

`createManualComparison` concentra validação, extração, observação e scoring;
`ComparisonDetail` tipado elimina parsing de `raw` e double cast na UI; página
é dividida em formulário, score, cobertura e proveniência; continua usando o
scorer canônico.

### ARCH-018 — Tipar i18n e persistir códigos de razão

`TranslationKey` é calculada em compile time; domínio retorna código + params,
não prosa; UI traduz reasons/blockers; migration/rescore cobre dados existentes;
E2E cobre estados dinâmicos em pt-BR/en.

## P3 — simplificação final

### ARCH-019 — Extrair renderers puros e migrar contextos oportunisticamente

Relatórios recebem DTO e retornam texto; CLI cuida do filesystem;
Correspondence/Positioning ganham API pública quando forem modificados; não
criar event bus/container/porta cerimonial.

### ARCH-020 — Remover dead code e escapes de tipo

Após nova busca de consumidores: remover seis exports, binding morto e
diretórios vazios; criar parsers/guards para Commander/status/source/category;
eliminar `as never`/double casts sem mudança comportamental; suíte permanece
verde.

### ARCH-021 — Reparar órfãos históricos de Auth

A cópia do banco real continha 28 violações de FK de Auth: 10 sessões e 18
eventos apontando para usuários removidos. A migration 0014 elimina somente as
sessões inválidas e preserva o audit trail, anulando `auth_event.user_id` como
prevê o `ON DELETE SET NULL`; `foreign_key_check` fica limpo. Esta limpeza não
foi misturada com migrations de Pursuit.

### ARCH-022 — Migrar o middleware para a convenção Proxy do Next

O build Next 16.3.1 conclui, mas avisa que `middleware.ts` está deprecated.
Migrar pela documentação instalada da versão, preservar exatamente os redirects
e headers de segurança e provar cookie ausente/forjado, callback público e bind
local no E2E.

Estado: concluída em 20/08/2026 pela migração literal recomendada pelo Next
16.3.1 (`middleware.ts` → `proxy.ts`, export `middleware` → `proxy`, mantendo
`config.matcher`).

### ARCH-023 — Isolar a extração PDF do bundle Webpack

O build conclui com warning de `unpdf` por acesso direto a `import.meta` no
trace `pdf.ts → candidate/actions.ts`. Manter a extração server-only atrás da
fronteira de documento, eliminar o warning sem trocar por dependência nativa e
provar import de CV e upload de vaga PDF.

Estado: concluída em 20/08/2026 com `unpdf` em `serverExternalPackages`, opção
estável recomendada pela documentação instalada do Next 16 para dependência
server-only que não deve ser transformada pelo bundler. Os testes de documento
continuam exercitando PDF real/inválido e o build deixou de emitir o warning.

### ARCH-024 — Tornar o harness E2E isolado por omissão

Hoje `pnpm test:e2e` presume um servidor aberto e, sem variáveis, prepara o
banco real; isso produziu `SQLITE_BUSY` durante a verificação. O harness deve
criar SQLite temporário, iniciar a build/servidor em porta livre, aguardar por
condição e encerrar tudo mesmo em falha. Um modo explícito pode continuar
apontando para servidor externo.

Estado: concluída em 20/08/2026. `tests/e2e/run-isolated.mjs` copia apenas o
necessário, exclui dados e arquivos de ambiente, aloca porta livre, prepara a
base temporária, aguarda o servidor por condição e encerra/remove os recursos
em `finally`. `test:e2e:external` preserva o modo deliberadamente externo.

## Ordem de ataque

```text
ARCH-001 → ARCH-003 → ARCH-004
    └────→ ARCH-005
ARCH-002 → ARCH-006 → ARCH-008 → ARCH-009
ARCH-007, ARCH-010, ARCH-012 podem avançar em paralelo
depois: ARCH-011 → ARCH-013…018 → ARCH-019/020
```

Não iniciar ARCH-013 antes de ownership/atomicidade: mover arquivos enquanto o
modelo ainda não expressa o agregado apenas espalha o retrabalho.
