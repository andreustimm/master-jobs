---
status: pending
title: Histórico de execução e captura de uma fonte
type: backend
complexity: high
---

# Tarefa 02: histórico de execução e captura de uma fonte

## Visão geral

Registrar toda captura e verificação em `source_run`, com escopo, ator,
retrato da configuração, contagens e erro limitado, e permitir capturar uma
fonte só. Quem executa continua atrás da `WorkflowDispatchPort`.

<critical>
- LEIA [`_scope-map.md`](_scope-map.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md) e [`_tests.md`](_tests.md) antes de começar
- DETALHE DE IMPLEMENTAÇÃO fica na Tech Spec — não duplique aqui
- TESTES OBRIGATÓRIOS — implemente todo caso atribuído em ## Testes
</critical>

<requirements>
- `source_run` MUST ter índice único parcial da chave de idempotência nos estados ativos.
- Linha terminal MUST ser imutável; contagem ausente MUST ficar nula.
- Máquina de estados, chave e lease MUST ser funções puras em `src/contexts/operations/domain/`.
- O limitador MUST reservar o slot antes do `await` (G13).
- `syncOne()` MUST gravar a execução-filha com a completude declarada e continuar sem escrever em `application`.
- A porta de dispatch MUST aceitar rotina, fonte e execução; sem credencial, a execução fica `queued` com motivo.
- Captura por termo continua em `term_capture` (A2/A3), sem migrar.
</requirements>

## Subtarefas

- [ ] Migration de `source_run` com `onDelete` escrito.
- [ ] Domínio de execução e redação de erro.
- [ ] `jho jobs sync --source` e `jho jobs verify --source` com `--run`.
- [ ] Parâmetros no dispatch e no workflow.
- [ ] Docs: `data-model.md`, `cli.md`, `operations.md`, `sources.md`.
- [ ] Casos de teste atribuídos.

## Arquivos relevantes

- `src/core/db/schema.ts`, `drizzle/postgres/`
- `src/core/ingest/run.ts`
- `src/contexts/operations/` (`ports.ts`, `domain/`, `infra/github-dispatch.ts`)
- `.github/workflows/`
- `src/cli.ts`

## Testes

- [ ] UT-005 — chave de idempotência e recusa de fonte inativa.
- [ ] UT-006 — transições e contagem desconhecida.
- [ ] UT-007 — lease e interrupção.
- [ ] UT-008 — limitador com reserva síncrona.
- [ ] UT-012 — redação e limite de erro e evidência.
- [ ] IT-003 — idempotência concorrente e imutabilidade.
- [ ] IT-004 — execução-filha gravada pelo sync.
- [ ] IT-005 — execução "todas", nova tentativa e interrupção.
- [ ] IT-006 — dispatch sem credencial e erro redigido.

## Critérios de sucesso

- Dois cliques em Buscar agora produzem uma execução.
- Uma execução antiga explica, sozinha, o que capturou e com qual configuração.
