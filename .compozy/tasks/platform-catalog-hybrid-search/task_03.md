---
status: pending
title: Telas de Plataformas e Execuções
type: frontend
complexity: medium
---

# Tarefa 03: telas de Plataformas e Execuções

## Visão geral

Dar ao admin a operação do catálogo e das execuções pela interface:
listar, cadastrar, sondar, habilitar, desabilitar, aposentar, Buscar agora,
Buscar em todas, Atualizar status e tentar de novo.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- Toda página MUST chamar `requirePage`; toda action MUST chamar `guard` antes de efeito (G39).
- Sessão emprestada MUST perder toda ação, inclusive de admin-alvo (G24).
- Texto MUST vir do dicionário; rotas novas MUST entrar em `tests/e2e/routes.mjs` no mesmo commit (G29).
- Tokens semânticos e 375 px sem estouro (G32, G35).
- Aposentar pede confirmação e explica que o histórico fica.
- Captura por termo aparece só como agregado, sem termo nem candidato (A3).
</requirements>

## Subtarefas

- [ ] `/admin/plataformas` e detalhe da fonte.
- [ ] `/admin/execucoes` e detalhe da execução, paginados.
- [ ] Actions com políticas no inventário de entradas.
- [ ] i18n pt-BR e en.
- [ ] QA de jornada conforme `docs/qa/README.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `app/admin/` (padrão de `app/admin/operacoes/page.tsx`)
- `src/contexts/auth/domain/policy.ts`
- `src/core/i18n/`
- `tests/e2e/routes.mjs`, `tests/support/entry-inventory.ts`

## Testes

- [ ] UT-009 — negação por papel e por impersonação.
- [ ] E2E-001 — cadastro, sondagem e captura de uma fonte.
- [ ] E2E-002 — negação por link direto.
- [ ] E2E-003 — execução "todas", falha parcial e nova tentativa.

## Critérios de sucesso

- O admin opera uma fonte do cadastro à execução sem terminal.
- Nenhuma outra sessão alcança configuração ou ação.
