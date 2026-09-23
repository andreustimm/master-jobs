---
status: pending
title: Eventos de verificação e disponibilidade na vaga
type: backend
complexity: medium
---

# Tarefa 04: eventos de verificação e disponibilidade na vaga

## Visão geral

Guardar cada veredito em `job_check_event`, unificar os dois caminhos de
verificação em `recordVerdict()` e mostrar na vaga a disponibilidade com a
última checagem.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- Só 404/410 fecham (G26); o teste existente não pode ser enfraquecido.
- Evento e estado da vaga MUST mudar na mesma transação.
- `currentAvailability` MUST ser pura e decidir por `checked_at` e `id`.
- `jho jobs verify` MUST passar por `recordVerdict()`.
- Motivo diferente de `closed`/`unknown` só com evidência de adapter; hoje nenhum adapter produz.
- A tela MUST dizer "desconhecida" sem checagem e "vencida" além da janela.
</requirements>

## Subtarefas

- [ ] Migration de `job_check_event` com `onDelete` escrito.
- [ ] `currentAvailability` e motivo.
- [ ] Caminho único de veredito.
- [ ] Disponibilidade no detalhe da vaga, com i18n.
- [ ] Docs: `data-model.md`, `operations.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `src/core/ingest/verify.ts`, `verify-queue.ts`, `lifecycle.ts`, `probe.ts`
- `src/core/db/schema.ts`, `drizzle/postgres/`
- detalhe da vaga em `app/`

## Testes

- [ ] UT-010 — disponibilidade, ordem, vencimento e ausência.
- [ ] UT-011 — motivo só com 404/410.
- [ ] IT-007 — evento transacional e reabertura preservando histórico.
- [ ] IT-008 — caminho único e execução de verificação.
- [ ] E2E-004 — disponibilidade na tela da vaga.

## Critérios de sucesso

- Uma reabertura não apaga o fechamento anterior.
- Não existe mais caminho que fecha vaga sem registrar o veredito.
