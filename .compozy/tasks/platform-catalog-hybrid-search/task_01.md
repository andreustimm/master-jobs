---
status: pending
title: Catálogo no banco, importação única e divergência
type: backend
complexity: medium
---

# Tarefa 01: catálogo no banco, importação única e divergência

## Visão geral

Fazer do banco a fonte da verdade do catálogo sem quebrar ambiente vazio nem
fixture: linha gerida não é sobrescrita pelo YAML, a importação é explícita e
a divergência é visível.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- `source` ganha `retired_at`, `origin`, `config_revision`, `secret_ref` e `managed_at`, em migration aditiva.
- Validação de escrita e capacidades MUST ser funções puras em `src/contexts/sourcing/domain/`.
- `parseSourcesConfig()` MUST devolver a entrada desabilitada com `enabled: false`; quem chama `loadSources()` filtra explicitamente.
- `ensureSources()` MUST espelhar o YAML inteiro (inclusive `enabled: false`) só em linha não gerida, e desabilitar a linha não gerida que saiu do YAML.
- O sync MUST selecionar fontes do banco (`enabled`, não aposentada, kind com adapter de sync e handle diferente de `~terms`).
- `secret_ref` MUST aceitar só nome de variável; o valor nunca é gravado nem ecoado (G41).
- `jho sources import` MUST simular por padrão; `jho sources diff` nunca grava.
</requirements>

## Subtarefas

- [ ] Migration e colunas com `docs/data-model.md` atualizado.
- [ ] `capabilitiesOf`, `validateCatalogWrite`, `planCatalogImport`.
- [ ] Dois regimes de `ensureSources()` e seleção do sync pelo banco.
- [ ] Comandos `sources import` e `sources diff` com `docs/cli.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `src/core/db/schema.ts`, `drizzle/postgres/`
- `src/core/ingest/run.ts` (`ensureSources`, seleção de fontes)
- `src/core/sources/config.ts`, `src/core/sources/registry.ts`
- `src/contexts/sourcing/`
- `src/cli.ts`

## Testes

- [ ] UT-001 — capacidades por kind e classificação da sondagem.
- [ ] UT-002 — validação de escrita.
- [ ] UT-003 — referência de segredo.
- [ ] UT-004 — plano de importação.
- [ ] IT-001 — escrita no catálogo no PostgreSQL.
- [ ] IT-002 — regimes, importação, divergência e sondagem sem gravação.

## Critérios de sucesso

- Uma edição gravada no banco sobrevive ao sync seguinte.
- Banco vazio continua inicializando pelo YAML.
- Nenhuma candidatura é tocada (G02).
