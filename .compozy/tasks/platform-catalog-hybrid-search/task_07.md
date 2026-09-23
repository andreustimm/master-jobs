---
status: pending
title: Ordenação semântica opcional
type: backend
complexity: high
---

# Tarefa 07: ordenação semântica opcional

## Visão geral

Adicionar similaridade semântica como sinal de ordenação, nunca de filtro.
**Bloqueada** até o dono decidir o provedor de embedding padrão e o orçamento
diário de indexação (perguntas abertas do PRD), e até alguém ler no Supabase
de produção se a extensão `vector` está disponível.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
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

- [ ] Registrar as decisões do dono e a leitura da extensão.
- [ ] Spec complementar desta tarefa (tabela de vetores, porta, orçamento).
- [ ] Casos de teste atribuídos.

## Testes

- [ ] UT-019 — fallback sem vetor.
- [ ] UT-020 — vetor de outro modelo ignorado.
- [ ] IT-013 — conjunto filtrado idêntico com vetores.

## Critérios de sucesso

- Desligar o provedor não muda nenhum resultado além da ordem.
