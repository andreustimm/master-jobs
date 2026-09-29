---
status: pending
title: Ordenação semântica opcional
type: backend
complexity: high
---

# Tarefa 07: ordenação semântica opcional

## Decisões do dono

Preparado em 2026-09-28 (issue #223) para desbloquear esta tarefa. Detalhe,
opções de provedor com custo/latência/privacidade, armazenamento e plano de
testes/rollout completos em
[`_techspec-task07.md`](_techspec-task07.md#decisões-do-dono). Nenhuma caixa
abaixo foi marcada por um agente — só o dono decide.

| # | Decisão | Recomendação | Owner decide |
|---|---|---|---|
| D1 | Provedor de embedding padrão | OpenAI `text-embedding-3-small` (custo irrelevante no volume atual; adapter HTTP quase idêntico ao já cadastrado em `src/core/llm/registry.ts`); NVIDIA NIM como alternativa gratuita com a chave já configurada | [ ] |
| D2 | Orçamento diário de indexação | US$ 0,50/dia para começar (paga o backfill do catálogo aberto atual em menos de um dia com qualquer provedor pago da tabela) | [ ] |
| D3 | Armazenamento do vetor | pgvector (coluna `vector(dim)`), não array + cálculo em app | [ ] |
| D4 | `vector` disponível no Supabase de produção | Evidência forte por paridade de imagem + docs do Supabase, mas **não lida diretamente em produção nesta sessão** — rodar `select extname, extversion from pg_available_extensions where name = 'vector';` antes de começar | [ ] A confirmar pelo dono |
| D5 | Onde a indexação roda | GitHub Actions via `WorkflowDispatchPort` (mesmo padrão de `source_run`; a Vercel corta em fatias <25 s) | [ ] |

## Visão geral

Adicionar similaridade semântica como sinal de ordenação, nunca de filtro.
**Bloqueada** até o dono decidir o provedor de embedding padrão e o orçamento
diário de indexação (perguntas abertas do PRD), e até alguém ler no Supabase
de produção se a extensão `vector` está disponível — ver o bloco de decisões
acima e o detalhe em [`_techspec-task07.md`](_techspec-task07.md).

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_techspec-task07.md`](_techspec-task07.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- NÃO comece sem as decisões acima registradas na issue
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- Porta de embedding só com provedor escolhido e alternativa plausível (G04).
- Vetor guarda modelo e dimensão; vetor de outro modelo é ausência.
- O sinal semântico só reordena o conjunto da tarefa 05; nunca adiciona nem remove linha (A4).
- Sem vetor, a busca é a da tarefa 05, sem menção a semântica.
- Indexação explícita, retomável, com orçamento, fora da ingestão.
- Scorer intocado (G11).
</requirements>

## Subtarefas

- [ ] Registrar as decisões do dono (D1–D5 acima) na issue #223.
- [x] Spec complementar desta tarefa (tabela de vetores, porta, orçamento) —
  [`_techspec-task07.md`](_techspec-task07.md).
- [ ] Casos de teste atribuídos (implementação; a proposta de casos novos de
  orçamento/retomada está em
  [`_techspec-task07.md#plano-de-testes`](_techspec-task07.md#plano-de-testes)
  e ainda não entrou em `_tests.md`).

## Testes

- [ ] UT-019 — fallback sem vetor.
- [ ] UT-020 — vetor de outro modelo ignorado.
- [ ] IT-013 — conjunto filtrado idêntico com vetores.

Proposta a incorporar em `_tests.md` quando a tarefa for desbloqueada (ver
[`_techspec-task07.md#plano-de-testes`](_techspec-task07.md#plano-de-testes)):
UT-021 (orçamento), UT-022 (segredo do provedor), IT-014 (retomada
idempotente), IT-015 (troca de provedor/modelo), IT-016 (orçamento esgotado
nunca bloqueia a busca).

## Critérios de sucesso

- Desligar o provedor não muda nenhum resultado além da ordem.
