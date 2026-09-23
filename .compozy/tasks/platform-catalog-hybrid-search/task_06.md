---
status: pending
title: Análise estruturada da vaga
type: fullstack
complexity: high
---

# Tarefa 06: análise estruturada da vaga

## Visão geral

Pedir, pela tela da vaga, uma análise estruturada, versionada e presa à
evidência, processada fora da requisição por `LlmPort`. O `jho analyze`
atual, que usa o dossiê do candidato, continua como está.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- LEIA [`docs/prompts/system/`](../../../docs/prompts/system/README.md) antes de escrever o prompt
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- A entrada do prompt MUST conter só a vaga; nunca CV, perfil ou dossiê.
- `bindEvidence` MUST rebaixar para `unknown` todo trecho que não é substring do texto normalizado.
- Tentativa imutável; nova tentativa ligada; idempotência por índice parcial.
- Chave e corpo do provedor MUST nunca ser gravados (G41).
- Nada escreve em `application`, `job_score` nem `candidate`.
- Vaga ilegível responde como inexistente; custo e modelo só para admin.
</requirements>

## Subtarefas

- [ ] Migration de `job_analysis` com `onDelete` escrito.
- [ ] Esquema Zod, `bindEvidence` e prompt `job-structure.md` versionado.
- [ ] Fila em tabela e `jho analyze queue|run|status`.
- [ ] Ação e tela na vaga; visão de admin.
- [ ] Docs: `data-model.md`, `cli.md`, `docs/prompts/system/`.
- [ ] QA de jornada conforme `docs/qa/README.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `src/core/llm/` (`port.ts`, `analyze.ts`, `registry.ts`)
- `src/core/db/schema.ts`, `drizzle/postgres/`
- detalhe da vaga em `app/`
- `docs/prompts/system/`

## Testes

- [ ] UT-016 — vínculo de evidência, conflito e parcial.
- [ ] UT-017 — saída malformada sem coerção.
- [ ] UT-018 — entrada sem dado de candidato.
- [ ] IT-011 — fila, idempotência, cota e vaga alterada.
- [ ] IT-012 — permissões e ausência de escrita em decisões.
- [ ] E2E-006 — pedido, pendente, resultado e visão de admin.

## Critérios de sucesso

- Nenhum campo exibido como fato sem trecho que o sustente.
- Uma análise antiga continua legível depois de uma nova.
