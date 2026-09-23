---
status: pending
title: Relevância, aspas, localização, explicação e proximidade
type: fullstack
complexity: medium
---

# Tarefa 05: relevância, aspas, localização, explicação e proximidade

## Visão geral

Ordenar por relevância quando há consulta, aceitar frase entre aspas, estender
o filtro whole-word à localização, explicar por que cada resultado apareceu e
mostrar um grupo separado de termos parecidos. O filtro whole-word continua
sendo o único juiz do conjunto (adenda A4).

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- Conjunto e contagem MUST ser os mesmos com `sort=relevance` e `sort=fit`; sem casamento em localização, idênticos aos de antes da tarefa.
- `parseQuery`, `compareByRelevance` e a explicação MUST ser puros.
- `job_title_trgm_idx` entra em migration aditiva própria.
- Grupo de proximidade MUST ser separado, rotulado, limitado e só com vagas que passam nos filtros exatos.
- Reaproveitar `pg_trgm` (migration `0012`) e os índices `job_description_trgm_idx` e `job_page_text_trgm_idx` (migration `0013`, #214); o único índice novo é o do título.
- Estado na URL; sem JS de cliente novo; texto do dicionário.
- Scorer intocado (G08, G11).
</requirements>

## Subtarefas

- [ ] Análise da consulta e ordenação.
- [ ] Localização no filtro e explicação por campo.
- [ ] Grupo de termos parecidos com limiar calibrado na fixture.
- [ ] Docs: `docs/product/` (contrato de URL) e `docs/data-model.md` (índice do título).
- [ ] QA de jornada conforme `docs/qa/README.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `src/core/term.ts`, `src/core/db/repo.ts`
- `app/jobs/`, `app/filter-state.ts`
- `src/core/i18n/`

## Testes

- [ ] UT-013 — análise da consulta.
- [ ] UT-014 — ordenação determinística.
- [ ] UT-015 — explicação honesta.
- [ ] IT-009 — conjunto idêntico com relevância.
- [ ] IT-010 — grupo de proximidade e plano de consulta.
- [ ] E2E-005 — busca com filtros, relevância e grupo separado.

## Critérios de sucesso

- Nenhuma vaga entra ou sai do resultado principal por causa da ordenação.
- Cada resultado diz onde o termo casou.
